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
const CATALOG_FILE = "./catalog.json";
const COLOR = Number.parseInt(process.env.BRIDGE_COLOR || "7C3AED", 16);
const BRAND = "Lunaris Bridge";
const FOOTER = "Powered by Lunaris";
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
    createdAt: new Date().toISOString()
  };
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

function embed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: FOOTER });
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

function topupPanel() {
  return {
    embeds: [embed(
      `💸 ${BRAND} • Top up`,
      [
        "Add store credit to your wallet, then use it to buy from the store.",
        "",
        "**GCash:** send from your own number.",
        "**Bank → GCash:** transfer the exact amount using a supported bank.",
        "",
        "Credit is added after the payment is matched or approved."
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
      `🌙 Welcome to ${BRAND}`,
      `Purchase Minecraft packages and Discord perks using your Lunaris wallet.\n\n` +
      `**Minecraft server:** \`${process.env.MINECRAFT_SERVER_ADDRESS || "Coming soon"}\``
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
    "💳 Your wallet",
    `**Balance: ${php(user.balanceCentavos)}**\n` +
    `Minecraft: ${user.minecraftName ? `\`${user.minecraftName}\`` : "Not linked"}\n\n` +
    "Top up your wallet, then spend it in the store."
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

export async function handleBridgeCommand(message, command, args) {
  if (!["bridgepanel", "wallet", "store", "link", "approve", "credit"].includes(command)) {
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
      await message.reply(walletView(message.author.id));
      return true;
    }

    if (command === "store") {
      await message.reply(storePanel());
      return true;
    }

    if (command === "link") {
      const username = args[0] || "";
      if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
        throw new Error("Use `?link YourMinecraftName`.");
      }
      await runTransaction(data => {
        getUser(data, message.author.id).minecraftName = username;
      });
      await message.reply(`✅ Minecraft account linked to \`${username}\`.`);
      return true;
    }

    if (!isStaff(message.member)) throw new Error("Only bridge staff can use this command.");

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
          status: "pending",
          createdAt: new Date().toISOString()
        };
      });
      await interaction.reply({
        embeds: [embed(
          "✅ Top-up ready",
          `Send **${php(amount)}** to **${process.env.GCASH_RECEIVER_NUMBER || "GCash number not configured"}**.\n\n` +
          `${process.env.PAYMENT_INSTRUCTIONS || "Keep your receipt until staff confirms the payment."}\n\n` +
          `Reference: \`${reference}\`\nExpected sender: \`${phone}\``
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
            value: needsMinecraft ? (user.minecraftName || "Use `?link username` first") : "Not required",
            inline: true
          }
        )],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`lb_buy_${product.id}`)
            .setLabel(user.balanceCentavos >= product.priceCentavos ? "Buy now" : "Insufficient balance")
            .setStyle(ButtonStyle.Success)
            .setDisabled(user.balanceCentavos < product.priceCentavos || (needsMinecraft && !user.minecraftName)),
          new ButtonBuilder()
            .setCustomId("lb_store")
            .setLabel("Back to store")
            .setStyle(ButtonStyle.Secondary)
        )]
      });
      return true;
    }
    if (id.startsWith("lb_buy_")) {
      await purchase(interaction, id.slice("lb_buy_".length));
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

async function purchase(interaction, productId) {
  const catalog = loadJson(CATALOG_FILE);
  const product = catalog.products.find(item => item.id === productId && item.enabled);
  if (!product) throw new Error("Product is unavailable.");
  await interaction.deferReply({ ephemeral: true });
  const orderId = `LBO-${crypto.randomUUID()}`;
  const order = await runTransaction(data => {
    const user = getUser(data, interaction.user.id);
    if (product.deliveries.some(item => item.type === "minecraft_command") && !user.minecraftName) {
      throw new Error("Link your Minecraft account with `?link username` first.");
    }
    addLedger(data, interaction.user.id, -product.priceCentavos,
      `Purchase: ${product.name}`, `order:${orderId}`);
    data.orders[orderId] = {
      userId: interaction.user.id,
      productId: product.id,
      amountCentavos: product.priceCentavos,
      minecraftName: user.minecraftName,
      status: "processing",
      createdAt: new Date().toISOString()
    };
    return { minecraftName: user.minecraftName };
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
    if (payment.status === "cancelled") throw new Error("This payment was cancelled.");
    const balance = addLedger(data, payment.userId, payment.amountCentavos,
      `Top-up ${providerReference}`, `payment:${reference}`, actorId);
    payment.status = "credited";
    payment.providerReference ??= providerReference;
    payment.creditedAt ??= new Date().toISOString();
    return {
      userId: payment.userId,
      amountCentavos: payment.amountCentavos,
      balanceCentavos: balance
    };
  });
}

async function notify(client, userId, message) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (user) await user.send(`${FOOTER}\n\n${message}`).catch(() => {});
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
