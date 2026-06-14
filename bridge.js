import fs from "fs";
import http from "http";
import crypto from "crypto";
import path from "path";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { Rcon } from "rcon-client";

const DATA_FILE = process.env.BRIDGE_DATA_FILE || "./data/bridge.json";
const CATALOG_FILE = process.env.BRIDGE_CATALOG_FILE || "./data/catalog.json";
const CATALOG_SEED_FILE = "./catalog.json";
const COLOR = Number.parseInt(process.env.BRIDGE_COLOR || "7C3AED", 16);
const BRAND = "Lunaris Bridge";
const SERVER_NAME = "Lunaris Craft";
const FOOTER = "Powered by Devy Network";
const REVIEWER_ID = process.env.PAYMENT_REVIEWER_ID || "806032916353515560";
const RECEIPT_USER_ID = process.env.PURCHASE_RECEIPT_USER_ID || REVIEWER_ID;
let transactionQueue = Promise.resolve();
let webServerStarted = false;

function ensureDataFile() {
  if (fs.existsSync(DATA_FILE)) return;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    users: {},
    payments: {},
    orders: {},
    ledger: []
  }, null, 2));
}

ensureDataFile();

function ensureCatalogFile() {
  if (fs.existsSync(CATALOG_FILE)) return;
  fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
  fs.copyFileSync(CATALOG_SEED_FILE, CATALOG_FILE);
}

ensureCatalogFile();

function enforceStoreCategories() {
  const catalog = loadJson(CATALOG_FILE);
  catalog.categories = [
    {
      id: "ranks",
      name: "Ranks",
      emoji: "👑",
      description: "Permanent Lunaris Craft ranks"
    },
    {
      id: "keys",
      name: "Keys",
      emoji: "🗝️",
      description: "Crate keys delivered automatically"
    }
  ];
  catalog.products = Array.isArray(catalog.products)
    ? catalog.products.filter(product => ["ranks", "keys"].includes(product.categoryId))
    : [];
  saveCatalog(catalog);
}

enforceStoreCategories();

function loadJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function validateCatalog() {
  const catalog = loadJson(CATALOG_FILE);
  if (!Array.isArray(catalog.categories) || catalog.categories.length < 1 ||
      catalog.categories.length > 25) {
    throw new Error("catalog.json must contain 1-25 categories.");
  }
  if (!Array.isArray(catalog.products)) {
    throw new Error("catalog.json products must be an array.");
  }

  const categoryIds = new Set();
  for (const category of catalog.categories) {
    if (!/^[a-z0-9-]+$/.test(category.id) || categoryIds.has(category.id)) {
      throw new Error(`Invalid or duplicate category ID: ${category.id}`);
    }
    categoryIds.add(category.id);
  }

  const productIds = new Set();
  for (const product of catalog.products) {
    if (!/^[a-z0-9-]+$/.test(product.id) || productIds.has(product.id)) {
      throw new Error(`Invalid or duplicate product ID: ${product.id}`);
    }
    if (!categoryIds.has(product.categoryId)) {
      throw new Error(`Product ${product.id} references a missing category.`);
    }
    if (!Number.isSafeInteger(product.priceCentavos) || product.priceCentavos <= 0) {
      throw new Error(`Product ${product.id} has an invalid priceCentavos.`);
    }
    if (!Array.isArray(product.deliveries) || product.deliveries.length < 1) {
      throw new Error(`Product ${product.id} needs at least one delivery.`);
    }
    for (const delivery of product.deliveries) {
      if (delivery.type === "minecraft_command") {
        if (typeof delivery.command !== "string" || !delivery.command.includes("{minecraft}")) {
          throw new Error(`Product ${product.id} has an invalid Minecraft command.`);
        }
      } else if (delivery.type === "discord_role") {
        if (!/^\d{17,20}$/.test(delivery.roleId)) {
          throw new Error(`Product ${product.id} has an invalid Discord role ID.`);
        }
      } else {
        throw new Error(`Product ${product.id} has an unsupported delivery type.`);
      }
    }
    productIds.add(product.id);
  }
}

validateCatalog();

function saveData(data) {
  const temporary = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
  fs.renameSync(temporary, DATA_FILE);
}

function runTransaction(callback) {
  const operation = transactionQueue.then(() => {
    const data = loadJson(DATA_FILE);
    const result = callback(data);
    saveData(data);
    return result;
  });
  transactionQueue = operation.catch(() => {});
  return operation;
}

function getUser(data, userId) {
  data.users[userId] ??= {
    balanceCentavos: 0,
    minecraftName: null,
    minecraftEdition: null,
    createdAt: new Date().toISOString()
  };
  data.users[userId].minecraftEdition ??= null;
  return data.users[userId];
}

function php(centavos) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(centavos / 100);
}

function parseAmount(value) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) {
    throw new Error("Enter a valid PHP amount, such as 500 or 500.00.");
  }
  const amount = Math.round(Number(value) * 100);
  if (amount < 100) throw new Error("The minimum amount is ₱1.00.");
  return amount;
}

function normalizeEdition(value) {
  const edition = String(value || "").trim().toLowerCase();
  if (["java", "j"].includes(edition)) return "java";
  if (["bedrock", "bedrock edition", "be", "bed", "mcpe", "pe"].includes(edition)) return "bedrock";
  throw new Error("Edition must be Java or Bedrock.");
}

function normalizeMinecraftName(edition, rawName) {
  const name = String(rawName || "").trim();
  if (edition === "java") {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      throw new Error("Java IGN must be 3-16 letters, numbers, or underscores.");
    }
    return name;
  }
  const cleaned = name.startsWith(".") ? name : `.${name}`;
  if (!/^\.[A-Za-z0-9_]{3,16}$/.test(cleaned)) {
    throw new Error("Bedrock IGN must start with a dot, for example `.Steve123`.");
  }
  return cleaned;
}

function formatDate(value = new Date().toISOString()) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.RECEIPT_TIME_ZONE || "Asia/Manila"
  }).format(new Date(value));
}

function receiptNumber(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function embed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: `${SERVER_NAME} • ${BRAND}` })
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

function gcashStyleReceipt(payment, reference, title = "GCash Payment Receipt") {
  const statusLabel = {
    pending: "Pending screenshot",
    proof_submitted: "Proof submitted",
    credited: "Paid and credited",
    denied: "Denied",
    review_unavailable: "Reviewer unavailable"
  }[payment.status] || payment.status || "Pending";

  return embed(title, "Lunaris Craft wallet top-up payment record.")
    .addFields(
      { name: "Amount", value: `**${php(payment.amountCentavos)}**`, inline: true },
      { name: "Status", value: statusLabel, inline: true },
      { name: "Reference No.", value: `\`${reference}\``, inline: true },
      { name: "Paid By", value: `<@${payment.userId}>\n\`${payment.userId}\``, inline: true },
      { name: "Sender Number", value: `\`${payment.phone}\``, inline: true },
      { name: "Receiver", value: `\`${process.env.GCASH_RECEIVER_NUMBER || "Not configured"}\``, inline: true },
      { name: "Transaction Date", value: formatDate(payment.createdAt), inline: true },
      { name: "Receipt ID", value: `\`${payment.receiptId || reference}\``, inline: true }
    );
}

function purchaseReceipt(order, product, balanceCentavos) {
  return embed("Lunaris Purchase Receipt", "Official automated Minecraft delivery receipt.")
    .addFields(
      { name: "Order ID", value: `\`${order.id}\``, inline: true },
      { name: "Receipt ID", value: `\`${order.receiptId}\``, inline: true },
      { name: "Status", value: order.status, inline: true },
      { name: "Item", value: product.name, inline: true },
      { name: "Amount Paid", value: `**${php(order.amountCentavos)}**`, inline: true },
      { name: "Wallet Balance", value: php(balanceCentavos), inline: true },
      { name: "Customer", value: `<@${order.userId}>\n\`${order.userId}\``, inline: true },
      {
        name: "Minecraft",
        value: `${order.minecraftEdition || "N/A"} - \`${order.minecraftName || "N/A"}\``,
        inline: true
      },
      { name: "Date", value: formatDate(order.createdAt), inline: true }
    );
}

function walletComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("lb_wallet")
      .setLabel("Check balance")
      .setEmoji("💳")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("lb_topup")
      .setLabel("Top up")
      .setEmoji("💸")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("lb_store")
      .setLabel("Open store")
      .setEmoji("🛒")
      .setStyle(ButtonStyle.Primary)
  )];
}

function legacyTopupPanel() {
  return {
    embeds: [embed(
      "💸 Secure Wallet Top-up",
      [
        `Add credit to your **${SERVER_NAME}** wallet and use it in the official store.`,
        "",
        "• Enter your amount and sending GCash number.",
        "• Send the exact amount using the displayed instructions.",
        "• A payment reviewer receives the request automatically.",
        "• You receive a DM as soon as it is confirmed or denied.",
        "",
        "No screenshot submission is required."
      ].join("\n")
    )],
    components: walletComponents()
  };
}

function topupPanel() {
  return {
    embeds: [embed(
      "Secure Wallet Top-up",
      [
        `Add credit to your **${SERVER_NAME}** wallet and use it in the official store.`,
        "",
        "- Enter your amount and sending GCash number.",
        "- Send the exact amount using the displayed instructions.",
        "- DM the screenshot receipt to this bot after sending payment.",
        "- The payment reviewer receives the request and screenshot automatically.",
        "- You receive a receipt DM as soon as it is confirmed or denied.",
        "",
        "Use the exact amount and keep the receipt visible in the screenshot."
      ].join("\n")
    )],
    components: walletComponents()
  };
}

function storePanel() {
  const catalog = loadJson(CATALOG_FILE);
  const menu = new StringSelectMenuBuilder()
    .setCustomId("lb_category")
    .setPlaceholder("Pick a category...")
    .addOptions(catalog.categories.slice(0, 25).map(category => ({
      label: category.name,
      value: category.id,
      description: category.description,
      emoji: category.emoji
    })));

  return {
    embeds: [embed(
      `🌙 ${SERVER_NAME} Store`,
      `Welcome to the official **${SERVER_NAME}** store.\n\n` +
      "Select a category below to browse ranks and keys. Purchases use your secure Lunaris wallet and are delivered automatically.\n\n" +
      `**Server Address**\n\`${process.env.MINECRAFT_SERVER_ADDRESS || "Coming soon"}\``
    )],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

function walletView(userId) {
  const data = loadJson(DATA_FILE);
  const user = data.users[userId] || { balanceCentavos: 0, minecraftName: null };
  const recent = data.ledger
    .filter(entry => entry.userId === userId)
    .slice(-5)
    .reverse();
  const card = embed(
    "💳 Lunaris Wallet",
    `Your secure ${SERVER_NAME} account balance and delivery profile.`
  ).addFields(
    { name: "Available Balance", value: `**${php(user.balanceCentavos)}**`, inline: true },
    {
      name: "Minecraft Account",
      value: user.minecraftName ? `\`${user.minecraftName}\`` : "Not linked",
      inline: true
    },
    { name: "Account Status", value: "Active", inline: true }
  );
  if (recent.length) {
    card.addFields({
      name: "Recent activity",
      value: recent.map(entry =>
        `${entry.deltaCentavos >= 0 ? "+" : ""}${php(entry.deltaCentavos)} • ${entry.note}`
      ).join("\n")
    });
  }
  return { embeds: [card], components: walletComponents() };
}

function isStaff(member) {
  const roleId = process.env.BRIDGE_ADMIN_ROLE_ID;
  return member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    (roleId && member?.roles?.cache?.has(roleId));
}

function addLedger(data, userId, deltaCentavos, note, reference, actorId = null) {
  if (data.ledger.some(entry => entry.reference === reference)) {
    return getUser(data, userId).balanceCentavos;
  }
  const user = getUser(data, userId);
  const next = user.balanceCentavos + deltaCentavos;
  if (next < 0) throw new Error("Insufficient wallet balance.");
  user.balanceCentavos = next;
  data.ledger.push({
    id: crypto.randomUUID(),
    userId,
    deltaCentavos,
    balanceAfterCentavos: next,
    note,
    reference,
    actorId,
    createdAt: new Date().toISOString()
  });
  return next;
}

function saveCatalog(catalog) {
  const temporary = `${CATALOG_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(catalog, null, 2));
  fs.renameSync(temporary, CATALOG_FILE);
}

function parenthesizedArguments(content) {
  return [...content.matchAll(/\(([^()]*)\)/g)].map(match => match[1].trim());
}

function productId(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function sendPrivateCommandResult(message, payload) {
  await message.author.send(payload);
  const notice = await message.reply("I sent the private result to your DMs.");
  setTimeout(() => notice.delete().catch(() => {}), 5000);
  await message.delete().catch(() => {});
}

function latestOpenPaymentForUser(data, userId, preferredReference = null) {
  const entries = Object.entries(data.payments || {})
    .filter(([reference, payment]) =>
      payment.userId === userId &&
      ["pending", "proof_submitted"].includes(payment.status) &&
      (!preferredReference || reference === preferredReference)
    )
    .sort((a, b) => new Date(b[1].createdAt) - new Date(a[1].createdAt));
  return entries[0] || null;
}

function reviewButtons(reference) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lb_review_confirm_${reference}`)
      .setLabel("Confirm Payment")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`lb_review_deny_${reference}`)
      .setLabel("Deny Payment")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Danger)
  );
}

async function sendPaymentReview(client, reference, payment) {
  const reviewer = await client.users.fetch(REVIEWER_ID).catch(() => null);
  if (!reviewer) {
    await runTransaction(data => {
      if (data.payments[reference]) data.payments[reference].status = "review_unavailable";
    });
    throw new Error("The payment reviewer could not be reached. Please contact staff.");
  }
  const card = gcashStyleReceipt(payment, reference, "Payment Review Required")
    .setDescription("A customer submitted a GCash screenshot for wallet credit review.");
  if (payment.proofUrl) card.setImage(payment.proofUrl);
  await reviewer.send({
    embeds: [card.addFields({
      name: "Reviewer Action",
      value: "Verify the screenshot and GCash record, then confirm or deny below."
    })],
    components: [reviewButtons(reference)]
  });
}

async function sendReceiptToReviewer(client, card) {
  const reviewer = await client.users.fetch(RECEIPT_USER_ID).catch(() => null);
  if (reviewer) await reviewer.send({ embeds: [card] }).catch(() => {});
}

export async function handleBridgeDmMessage(message) {
  const attachment = message.attachments.find(file =>
    file.contentType?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name || file.url)
  );
  if (!attachment) {
    await message.reply(
      "Send your GCash screenshot receipt here after creating a top-up. If you have multiple requests, include the LB reference."
    );
    return true;
  }

  const suppliedReference = message.content.match(/\bLB-[A-F0-9]{8}\b/i)?.[0]?.toUpperCase() || null;
  const result = await runTransaction(data => {
    const found = latestOpenPaymentForUser(data, message.author.id, suppliedReference);
    if (!found) {
      throw new Error(suppliedReference
        ? "I could not find that open payment reference."
        : "You do not have an open top-up. Create one from the wallet panel first.");
    }
    const [reference, payment] = found;
    payment.status = "proof_submitted";
    payment.proofUrl = attachment.url;
    payment.proofName = attachment.name || "gcash-receipt";
    payment.proofMessageId = message.id;
    payment.proofSubmittedAt = new Date().toISOString();
    return { reference, payment: { ...payment } };
  });

  await sendPaymentReview(message.client, result.reference, result.payment);
  const receipt = gcashStyleReceipt(result.payment, result.reference, "GCash Receipt Submitted");
  if (result.payment.proofUrl) receipt.setImage(result.payment.proofUrl);
  await message.reply({
    embeds: [receipt.addFields({
      name: "Next Step",
      value: `Your proof was sent to <@${REVIEWER_ID}>. You will receive a receipt update when it is approved or denied.`
    })]
  });
  await audit(message.client,
    `Payment proof submitted: \`${result.reference}\`, user <@${message.author.id}>.`);
  return true;
}

export async function handleBridgeCommand(message, command, args) {
  if (![
    "bridgepanel", "wallet", "store", "link", "profile", "orders", "payments",
    "approve", "credit", "order", "addproduct", "removeproduct", "products"
  ].includes(command)) {
    return false;
  }

  try {
    if (command === "bridgepanel") {
      if (!isStaff(message.member)) throw new Error("Only staff can post bridge panels.");
      const type = (args[0] || "topup").toLowerCase();
      await message.channel.send(type === "store" ? storePanel() : topupPanel());
      await message.delete().catch(() => {});
      return true;
    }

    if (command === "wallet") {
      await sendPrivateCommandResult(message, walletView(message.author.id));
      return true;
    }

    if (command === "store") {
      await sendPrivateCommandResult(message, storePanel());
      return true;
    }

    if (command === "link") {
      const edition = args.length > 1 ? normalizeEdition(args[0]) : "java";
      const username = normalizeMinecraftName(edition, args.length > 1 ? args[1] : args[0]);
      await runTransaction(data => {
        const user = getUser(data, message.author.id);
        user.minecraftName = username;
        user.minecraftEdition = edition;
      });
      await sendPrivateCommandResult(message, {
        embeds: [embed(
          "Minecraft Account Linked",
          `Your ${edition} delivery account is now linked to \`${username}\`.\n\nBedrock names must start with a dot, for example \`.Steve123\`.`
        )]
      });
      return true;
    }

    if (command === "profile") {
      const data = loadJson(DATA_FILE);
      const user = data.users[message.author.id] || { balanceCentavos: 0, minecraftName: null, minecraftEdition: null };
      await sendPrivateCommandResult(message, {
        embeds: [embed("Delivery Profile", "Your wallet and Minecraft delivery settings.")
          .addFields(
            { name: "Wallet", value: php(user.balanceCentavos || 0), inline: true },
            { name: "Edition", value: user.minecraftEdition || "Not set", inline: true },
            { name: "IGN", value: user.minecraftName ? `\`${user.minecraftName}\`` : "Not set", inline: true },
            { name: "Bedrock Rule", value: "Bedrock names must begin with a dot, such as `.Steve123`." }
          )]
      });
      return true;
    }

    if (command === "orders") {
      const data = loadJson(DATA_FILE);
      const orders = Object.values(data.orders || {})
        .filter(order => order.userId === message.author.id)
        .slice(-10)
        .reverse();
      await sendPrivateCommandResult(message, {
        embeds: [embed(
          "Recent Orders",
          orders.map(order =>
            `\`${order.id || "legacy-order"}\` - ${php(order.amountCentavos)} - ${order.status} - ${formatDate(order.createdAt)}`
          ).join("\n") || "You do not have any orders yet."
        )]
      });
      return true;
    }

    if (command === "payments") {
      const data = loadJson(DATA_FILE);
      const payments = Object.entries(data.payments || {})
        .filter(([, payment]) => payment.userId === message.author.id)
        .slice(-10)
        .reverse();
      await sendPrivateCommandResult(message, {
        embeds: [embed(
          "Recent Top-ups",
          payments.map(([reference, payment]) =>
            `\`${reference}\` - ${php(payment.amountCentavos)} - ${payment.status} - ${formatDate(payment.createdAt)}`
          ).join("\n") || "You do not have any top-up requests yet."
        )]
      });
      return true;
    }

    if (!isStaff(message.member)) throw new Error("Only bridge staff can use this command.");

    if (command === "addproduct") {
      const fields = parenthesizedArguments(message.content);
      if (fields.length !== 4) {
        throw new Error("Use `?addproduct (name) (description) (Rank or Keys) (price)`.");
      }
      const [name, description, rawType, rawPrice] = fields;
      const type = rawType.toLowerCase();
      if (!["rank", "ranks", "key", "keys"].includes(type)) {
        throw new Error("Product type must be `Rank` or `Keys`.");
      }
      if (!name || name.length > 80 || !description || description.length > 300) {
        throw new Error("Name must be 1-80 characters and description 1-300 characters.");
      }
      const id = productId(name);
      if (!id) throw new Error("The product name cannot create a valid product ID.");
      const priceCentavos = parseAmount(rawPrice);
      const categoryId = type.startsWith("rank") ? "ranks" : "keys";
      const catalog = loadJson(CATALOG_FILE);
      if (catalog.products.some(item => item.id === id ||
          item.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("A product with that name or ID already exists.");
      }
      const commandTemplate = categoryId === "ranks"
        ? `lp user {minecraft} parent add ${id}`
        : `crate key give {minecraft} ${id} 1`;
      catalog.products.push({
        id,
        categoryId,
        name,
        description,
        priceCentavos,
        enabled: true,
        deliveries: [{ type: "minecraft_command", command: commandTemplate }]
      });
      saveCatalog(catalog);
      await message.reply({
        embeds: [embed("Product Added", `**${name}** is now available in **${categoryId === "ranks" ? "Ranks" : "Keys"}**.`)
          .addFields(
            { name: "Product ID", value: `\`${id}\``, inline: true },
            { name: "Price", value: php(priceCentavos), inline: true },
            { name: "Automatic Delivery", value: `\`${commandTemplate}\`` }
          )]
      });
      return true;
    }

    if (command === "removeproduct") {
      const fields = parenthesizedArguments(message.content);
      const query = (fields[0] || args.join(" ")).trim().toLowerCase();
      if (!query) throw new Error("Use `?removeproduct (product name or ID)`.");
      const catalog = loadJson(CATALOG_FILE);
      const index = catalog.products.findIndex(item =>
        item.id.toLowerCase() === query || item.name.toLowerCase() === query
      );
      if (index < 0) throw new Error("Product not found.");
      const [removed] = catalog.products.splice(index, 1);
      saveCatalog(catalog);
      await message.reply({
        embeds: [embed("Product Removed", `**${removed.name}** was removed from the ${SERVER_NAME} store.`)]
      });
      return true;
    }

    if (command === "products") {
      const catalog = loadJson(CATALOG_FILE);
      await message.reply({
        embeds: [embed(
          "Store Product Directory",
          catalog.products.map(item =>
            `**${item.name}** • \`${item.id}\` • ${php(item.priceCentavos)} • ${item.categoryId}`
          ).join("\n") || "No products are currently configured."
        )]
      });
      return true;
    }

    if (command === "approve") {
      const reference = (args[0] || "").toUpperCase();
      const providerReference = args[1] || `staff-${message.id}`;
      const result = await approvePayment(reference, providerReference, message.author.id);
      await message.reply(
        `✅ Credited <@${result.userId}> ${php(result.amountCentavos)}. ` +
        `New balance: ${php(result.balanceCentavos)}.`
      );
      await notify(message.client, result.userId,
        `Your ${php(result.amountCentavos)} top-up was approved. ` +
        `New balance: ${php(result.balanceCentavos)}.`);
      return true;
    }

    if (command === "order") {
      const orderId = args[0] || "";
      if (!orderId) throw new Error("Use `?order LBO-ID`.");
      const data = loadJson(DATA_FILE);
      const order = data.orders[orderId];
      if (!order) throw new Error("Order not found.");
      const catalog = loadJson(CATALOG_FILE);
      const product = catalog.products.find(item => item.id === order.productId) || {
        name: order.productId || "Unknown product"
      };
      await message.reply({
        embeds: [purchaseReceipt({ ...order, id: orderId }, product, data.users[order.userId]?.balanceCentavos || 0)]
      });
      return true;
    }

    const target = message.mentions.users.first();
    if (!target) throw new Error("Use `?credit @member amount reason`.");
    const amountIndex = args.findIndex(value => /^\d/.test(value));
    if (amountIndex < 0) throw new Error("Include the amount in PHP.");
    const amount = parseAmount(args[amountIndex]);
    const reason = args.slice(amountIndex + 1).join(" ") || "Manual staff credit";
    const balance = await runTransaction(data =>
      addLedger(data, target.id, amount, reason, `manual:${message.id}`, message.author.id)
    );
    await message.reply(`✅ Credited ${target} ${php(amount)}. New balance: ${php(balance)}.`);
    return true;
  } catch (error) {
    await message.reply(`❌ ${error.message}`);
    return true;
  }
}

export async function handleBridgeSlashCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  const command = interaction.commandName;
  if (!["wallet", "store", "link", "panel", "payment", "credit"].includes(command)) {
    return false;
  }

  try {
    if (command === "wallet") {
      await interaction.reply({ ...walletView(interaction.user.id), ephemeral: true });
      return true;
    }

    if (command === "store") {
      await interaction.reply({ ...storePanel(), ephemeral: true });
      return true;
    }

    if (command === "link") {
      const username = interaction.options.getString("username", true);
      if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
        throw new Error("Minecraft usernames must be 3-16 letters, numbers, or underscores.");
      }
      await runTransaction(data => {
        getUser(data, interaction.user.id).minecraftName = username;
      });
      await interaction.reply({
        content: `Minecraft account linked to \`${username}\`.`,
        ephemeral: true
      });
      return true;
    }

    const member = await interaction.guild?.members.fetch(interaction.user.id);
    if (!member || !isStaff(member)) {
      throw new Error("Only Lunaris Bridge staff can use this command.");
    }

    if (command === "panel") {
      if (!interaction.channel?.isSendable()) throw new Error("I cannot post in this channel.");
      const type = interaction.options.getString("type", true);
      await interaction.channel.send(type === "store" ? storePanel() : topupPanel());
      await interaction.reply({
        content: `${type === "store" ? "Store" : "Top-up"} panel posted.`,
        ephemeral: true
      });
      await audit(interaction.client, `Panel posted: ${type} by <@${interaction.user.id}>.`);
      return true;
    }

    if (command === "payment") {
      const reference = interaction.options.getString("reference", true).toUpperCase();
      const providerReference = interaction.options.getString("provider_reference", true);
      const result = await approvePayment(reference, providerReference, interaction.user.id);
      await interaction.reply({
        content: `Credited <@${result.userId}> ${php(result.amountCentavos)}. ` +
          `New balance: ${php(result.balanceCentavos)}.`,
        ephemeral: true
      });
      await notify(interaction.client, result.userId,
        `Your ${php(result.amountCentavos)} top-up was approved. ` +
        `New balance: ${php(result.balanceCentavos)}.`);
      await audit(interaction.client,
        `Payment approved: \`${reference}\` by <@${interaction.user.id}>.`);
      return true;
    }

    const target = interaction.options.getUser("customer", true);
    const amount = Math.round(interaction.options.getNumber("amount", true) * 100);
    const reason = interaction.options.getString("reason", true);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid credit amount.");
    const balance = await runTransaction(data =>
      addLedger(data, target.id, amount, reason, `manual:${interaction.id}`, interaction.user.id)
    );
    await interaction.reply({
      content: `Credited ${target} ${php(amount)}. New balance: ${php(balance)}.`,
      ephemeral: true
    });
    await notify(interaction.client, target.id,
      `Your wallet was credited ${php(amount)}. Reason: ${reason}`);
    await audit(interaction.client,
      `Manual credit: ${target} received ${php(amount)} by <@${interaction.user.id}>. ${reason}`);
    return true;
  } catch (error) {
    const payload = {
      content: `Error: ${error instanceof Error ? error.message : "Unexpected error."}`,
      ephemeral: true
    };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
    return true;
  }
}

export async function handleBridgeInteraction(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("lb_")) return false;

  try {
    if (id.startsWith("lb_review_confirm_") || id.startsWith("lb_review_deny_")) {
      if (interaction.user.id !== REVIEWER_ID) {
        throw new Error("This payment decision is assigned to another reviewer.");
      }
      const confirm = id.startsWith("lb_review_confirm_");
      const reference = id.replace(confirm ? "lb_review_confirm_" : "lb_review_deny_", "");

      if (confirm) {
        const result = await approvePayment(reference, `review-${interaction.id}`, interaction.user.id);
        await interaction.update({
          embeds: [embed("Payment Confirmed", `The wallet was credited successfully.`).addFields(
            { name: "Reference", value: `\`${reference}\``, inline: true },
            { name: "Amount", value: php(result.amountCentavos), inline: true },
            { name: "Customer", value: `<@${result.userId}>`, inline: true },
            { name: "New Balance", value: php(result.balanceCentavos), inline: true }
          )],
          components: []
        });
        await notifyEmbed(interaction.client, result.userId,
          gcashStyleReceipt(result.payment, reference, "Top-up Confirmed")
            .addFields({ name: "New Wallet Balance", value: php(result.balanceCentavos), inline: true }));
        await audit(interaction.client,
          `Payment confirmed: \`${reference}\` by <@${interaction.user.id}>.`);
      } else {
        const payment = await runTransaction(data => {
          const record = data.payments[reference];
          if (!record) throw new Error("Payment reference not found.");
          if (record.status === "credited") throw new Error("This payment is already credited.");
          if (record.status === "denied") return record;
          record.status = "denied";
          record.reviewedBy = interaction.user.id;
          record.reviewedAt = new Date().toISOString();
          return record;
        });
        await interaction.update({
          embeds: [embed("Payment Denied", "The top-up request was closed without changing the wallet.")
            .addFields(
              { name: "Reference", value: `\`${reference}\``, inline: true },
              { name: "Amount", value: php(payment.amountCentavos), inline: true },
              { name: "Customer", value: `<@${payment.userId}>`, inline: true }
            )],
          components: []
        });
        await notifyEmbed(interaction.client, payment.userId,
          gcashStyleReceipt(payment, reference, "Top-up Not Confirmed")
            .setDescription("Your top-up could not be confirmed and no wallet credit was added."));
        await audit(interaction.client,
          `Payment denied: \`${reference}\` by <@${interaction.user.id}>.`);
      }
      return true;
    }

    if (id === "lb_wallet") {
      await respond(interaction, walletView(interaction.user.id));
      return true;
    }
    if (id === "lb_store") {
      await respond(interaction, storePanel());
      return true;
    }
    if (id === "lb_topup") {
      const modal = new ModalBuilder()
        .setCustomId("lb_topup_submit")
        .setTitle("Top up your account")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("amount")
              .setLabel("Amount in PHP")
              .setPlaceholder("e.g. 500")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("phone")
              .setLabel("GCash phone number")
              .setPlaceholder("e.g. 09171234567")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      await interaction.showModal(modal);
      return true;
    }
    if (id === "lb_topup_submit") {
      const amount = parseAmount(interaction.fields.getTextInputValue("amount").trim());
      const phone = interaction.fields.getTextInputValue("phone").replace(/\s+/g, "");
      if (!/^(09|\+639)\d{9}$/.test(phone)) throw new Error("Enter a valid Philippine mobile number.");
      const reference = `LB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      await runTransaction(data => {
        getUser(data, interaction.user.id);
        data.payments[reference] = {
          userId: interaction.user.id,
          amountCentavos: amount,
          phone,
          receiptId: receiptNumber("GCR"),
          status: "pending",
          createdAt: new Date().toISOString()
        };
      });

      const reviewer = await interaction.client.users.fetch(REVIEWER_ID).catch(() => null);
      if (!reviewer) {
        await runTransaction(data => {
          data.payments[reference].status = "review_unavailable";
        });
        throw new Error("The payment reviewer could not be reached. Please contact staff.");
      }
      const reviewRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`lb_review_confirm_${reference}`)
          .setLabel("Confirm Payment")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`lb_review_deny_${reference}`)
          .setLabel("Deny Payment")
          .setEmoji("✖️")
          .setStyle(ButtonStyle.Danger)
      );
      await reviewer.send({
        embeds: [embed("Payment Review Required", "A customer submitted a new Lunaris Craft top-up request.")
          .addFields(
            { name: "Customer", value: `<@${interaction.user.id}>\n\`${interaction.user.id}\``, inline: true },
            { name: "Amount", value: `**${php(amount)}**`, inline: true },
            { name: "Sender Number", value: `\`${phone}\``, inline: true },
            { name: "Reference", value: `\`${reference}\`` },
            {
              name: "Review",
              value: "Verify that the exact payment arrived, then select Confirm or Deny below."
            }
          )],
        components: [reviewRow]
      });

      await interaction.reply({
        embeds: [embed(
          "Top-up Request Submitted",
          "Your secure payment request is ready. After sending GCash, DM the screenshot receipt to this bot."
        ).addFields(
          { name: "Exact Amount", value: `**${php(amount)}**`, inline: true },
          {
            name: "Send To",
            value: `\`${process.env.GCASH_RECEIVER_NUMBER || "Not configured"}\``,
            inline: true
          },
          { name: "Your Sender Number", value: `\`${phone}\``, inline: true },
          { name: "Payment Reference", value: `\`${reference}\`` },
          {
            name: "Next Step",
            value: process.env.PAYMENT_INSTRUCTIONS ||
              `Send the exact amount, then DM this bot your screenshot. Include reference ${reference} if you have multiple top-ups.`
          }
        )],
        ephemeral: true
      });
      await audit(interaction.client,
        `Top-up created: \`${reference}\`, ${php(amount)}, user <@${interaction.user.id}>.`);
      return true;
    }
    if (id === "lb_category") {
      const catalog = loadJson(CATALOG_FILE);
      const categoryId = interaction.values[0];
      const category = catalog.categories.find(item => item.id === categoryId);
      const products = catalog.products.filter(item => item.categoryId === categoryId && item.enabled);
      if (!category) throw new Error("Category not found.");
      const menu = products.length
        ? new StringSelectMenuBuilder()
          .setCustomId("lb_product")
          .setPlaceholder("Choose a product...")
          .addOptions(products.slice(0, 25).map(product => ({
            label: product.name,
            value: product.id,
            description: `${php(product.priceCentavos)} • ${product.description}`.slice(0, 100)
          })))
        : null;
      await interaction.update({
        embeds: [embed(
          `${category.emoji || "🛒"} ${category.name}`,
          products.map(product =>
            `**${product.name}** • ${php(product.priceCentavos)}\n${product.description}`
          ).join("\n\n") || "No products are available."
        )],
        components: menu ? [new ActionRowBuilder().addComponents(menu)] : []
      });
      return true;
    }
    if (id === "lb_product") {
      const catalog = loadJson(CATALOG_FILE);
      const product = catalog.products.find(item => item.id === interaction.values[0] && item.enabled);
      if (!product) throw new Error("Product is unavailable.");
      const data = loadJson(DATA_FILE);
      const user = data.users[interaction.user.id] || { balanceCentavos: 0, minecraftName: null };
      const needsMinecraft = product.deliveries.some(item => item.type === "minecraft_command");
      await interaction.update({
        embeds: [embed(product.name, product.description).addFields(
          { name: "Price", value: php(product.priceCentavos), inline: true },
          { name: "Wallet", value: php(user.balanceCentavos), inline: true },
          {
            name: "Minecraft",
            value: needsMinecraft
              ? `${user.minecraftEdition || "Not set"} ${user.minecraftName ? `- \`${user.minecraftName}\`` : "- will be asked at checkout"}`
              : "Not required",
            inline: true
          }
        )],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`lb_buy_${product.id}`)
            .setLabel(user.balanceCentavos >= product.priceCentavos ? "Buy now" : "Insufficient balance")
            .setStyle(ButtonStyle.Success)
            .setDisabled(user.balanceCentavos < product.priceCentavos),
          new ButtonBuilder()
            .setCustomId("lb_store")
            .setLabel("Back to store")
            .setStyle(ButtonStyle.Secondary)
        )]
      });
      return true;
    }
    if (id.startsWith("lb_buy_")) {
      const productId = id.slice("lb_buy_".length);
      const catalog = loadJson(CATALOG_FILE);
      const product = catalog.products.find(item => item.id === productId && item.enabled);
      if (!product) throw new Error("Product is unavailable.");
      const needsMinecraft = product.deliveries.some(item => item.type === "minecraft_command");
      if (!needsMinecraft) {
        await purchase(interaction, productId, null, null);
        return true;
      }
      const data = loadJson(DATA_FILE);
      const user = data.users[interaction.user.id] || {};
      const modal = new ModalBuilder()
        .setCustomId(`lb_checkout_${productId}`)
        .setTitle("Minecraft Delivery")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("edition")
              .setLabel("Java or Bedrock?")
              .setPlaceholder("Java or Bedrock")
              .setValue(user.minecraftEdition || "")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("ign")
              .setLabel("Minecraft IGN")
              .setPlaceholder("Java: Steve123 | Bedrock: .Steve123")
              .setValue(user.minecraftName || "")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      await interaction.showModal(modal);
      return true;
    }
    if (id.startsWith("lb_checkout_")) {
      const productId = id.slice("lb_checkout_".length);
      const edition = normalizeEdition(interaction.fields.getTextInputValue("edition"));
      const minecraftName = normalizeMinecraftName(edition, interaction.fields.getTextInputValue("ign"));
      await purchase(interaction, productId, edition, minecraftName);
      return true;
    }
  } catch (error) {
    const payload = { content: `❌ ${error.message}`, ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
    return true;
  }

  return false;
}

async function purchase(interaction, productId, requestedEdition = null, requestedMinecraftName = null) {
  const catalog = loadJson(CATALOG_FILE);
  const product = catalog.products.find(item => item.id === productId && item.enabled);
  if (!product) throw new Error("Product is unavailable.");
  await interaction.deferReply({ ephemeral: true });
  const orderId = `LBO-${crypto.randomUUID()}`;
  const order = await runTransaction(data => {
    const user = getUser(data, interaction.user.id);
    const needsMinecraft = product.deliveries.some(item => item.type === "minecraft_command");
    if (needsMinecraft) {
      user.minecraftEdition = requestedEdition || user.minecraftEdition;
      user.minecraftName = requestedMinecraftName || user.minecraftName;
    }
    if (needsMinecraft && (!user.minecraftName || !user.minecraftEdition)) {
      throw new Error("Enter your Java or Bedrock IGN before buying.");
    }
    const balanceAfter = addLedger(data, interaction.user.id, -product.priceCentavos,
      `Purchase: ${product.name}`, `order:${orderId}`);
    const receiptId = receiptNumber("LCR");
    data.orders[orderId] = {
      id: orderId,
      userId: interaction.user.id,
      productId: product.id,
      amountCentavos: product.priceCentavos,
      minecraftName: user.minecraftName,
      minecraftEdition: user.minecraftEdition,
      receiptId,
      status: "processing",
      createdAt: new Date().toISOString()
    };
    return {
      ...data.orders[orderId],
      balanceCentavos: balanceAfter
    };
  });

  let externalDeliveryStarted = false;
  try {
    for (const delivery of product.deliveries) {
      if (delivery.type === "minecraft_command") {
        externalDeliveryStarted = true;
        await sendRcon(delivery.command.replaceAll("{minecraft}", order.minecraftName));
      } else if (delivery.type === "discord_role") {
        if (!/^\d{17,20}$/.test(delivery.roleId)) throw new Error("Invalid product role ID.");
        const member = await interaction.guild.members.fetch(interaction.user.id);
        externalDeliveryStarted = true;
        await member.roles.add(delivery.roleId, `${BRAND} order ${orderId}`);
      }
    }
    await runTransaction(data => {
      data.orders[orderId].status = "completed";
      data.orders[orderId].completedAt = new Date().toISOString();
    });
    await interaction.editReply({
      embeds: [embed(
        "✅ Purchase delivered",
        `**${product.name}** was delivered successfully.\n\nOrder: \`${orderId}\``
      )]
    });
    order.status = "completed";
    await interaction.editReply({
      embeds: [purchaseReceipt(order, product, order.balanceCentavos)]
    });
    await notifyEmbed(interaction.client, interaction.user.id,
      purchaseReceipt(order, product, order.balanceCentavos));
    await sendReceiptToReviewer(interaction.client,
      purchaseReceipt(order, product, order.balanceCentavos));
    await audit(interaction.client,
      `Order completed: \`${orderId}\`, ${product.name}, user <@${interaction.user.id}>.`);
  } catch (error) {
    await runTransaction(data => {
      const record = data.orders[orderId];
      record.status = externalDeliveryStarted ? "manual_review" : "refunded";
      record.error = error.message;
      if (!externalDeliveryStarted) {
        addLedger(data, interaction.user.id, product.priceCentavos,
          `Refund: ${product.name}`, `refund:${orderId}`);
      }
    });
    await interaction.editReply(
      externalDeliveryStarted
        ? `⚠️ Delivery could not be confirmed. Order \`${orderId}\` needs staff review; no automatic retry was made.`
        : `❌ Delivery failed before it started. ${php(product.priceCentavos)} was refunded.`
    );
    await audit(interaction.client,
      `Order ${externalDeliveryStarted ? "needs review" : "refunded"}: \`${orderId}\`. ${error.message}`);
  }
}

async function sendRcon(command) {
  if (!process.env.RCON_PASSWORD) throw new Error("Minecraft RCON is not configured.");
  const rcon = await Rcon.connect({
    host: process.env.RCON_HOST || "127.0.0.1",
    port: Number(process.env.RCON_PORT || 25575),
    password: process.env.RCON_PASSWORD
  });
  try {
    await rcon.send(command);
  } finally {
    await rcon.end().catch(() => {});
  }
}

async function approvePayment(reference, providerReference, actorId) {
  return runTransaction(data => {
    const payment = data.payments[reference];
    if (!payment) throw new Error("Payment reference not found.");
    if (["cancelled", "denied", "review_unavailable"].includes(payment.status)) {
      throw new Error("This payment cannot be credited.");
    }
    const balance = addLedger(data, payment.userId, payment.amountCentavos,
      `Top-up ${providerReference}`, `payment:${reference}`, actorId);
    payment.status = "credited";
    payment.providerReference ??= providerReference;
    payment.creditedAt ??= new Date().toISOString();
    return {
      userId: payment.userId,
      amountCentavos: payment.amountCentavos,
      balanceCentavos: balance,
      payment: { ...payment }
    };
  });
}

async function notify(client, userId, message) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (user) await user.send(`${FOOTER}\n\n${message}`).catch(() => {});
}

async function notifyEmbed(client, userId, card) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (user) await user.send({ embeds: [card] }).catch(() => {});
}

async function audit(client, message) {
  const channelId = process.env.BRIDGE_AUDIT_CHANNEL_ID;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isSendable()) await channel.send(message).catch(() => {});
}

async function respond(interaction, payload) {
  if (interaction.message?.interaction || interaction.message) {
    await interaction.reply({ ...payload, ephemeral: true });
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

export function startBridgeService(client) {
  if (webServerStarted) return;
  webServerStarted = true;
  const port = Number(process.env.PORT || 8787);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;

  http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: BRAND }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/webhooks/payments" || !secret) {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > 65536) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", async () => {
      try {
        const raw = Buffer.concat(chunks);
        const supplied = String(request.headers["x-lunaris-signature"] || "").replace(/^sha256=/, "");
        const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
        if (supplied.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
          throw new Error("Invalid signature.");
        }
        const event = JSON.parse(raw.toString("utf8"));
        if (event.event !== "payment.completed") throw new Error("Unsupported event.");
        const data = loadJson(DATA_FILE);
        const payment = data.payments[event.paymentReference];
        if (!payment || payment.amountCentavos !== event.amountCentavos) {
          throw new Error("Payment does not match.");
        }
        const result = await approvePayment(
          event.paymentReference,
          event.providerReference,
          "payment-webhook"
        );
        await notify(client, result.userId,
          `Your wallet was credited ${php(result.amountCentavos)}. ` +
          `New balance: ${php(result.balanceCentavos)}.`);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      } catch (error) {
        console.error("Bridge webhook error:", error);
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false }));
      }
    });
  }).listen(port, "0.0.0.0", () => {
    console.log(`${BRAND} service listening on port ${port}`);
  });
}
