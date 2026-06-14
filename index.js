import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";
import {
  handleBridgeInteraction,
  handleBridgeSlashCommand,
  startBridgeService
} from "./bridge.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const PREFIX = "?";

if (!token) {
  console.error("Missing DISCORD_TOKEN. Add it in Railway Variables.");
  process.exit(1);
}

if (!clientId) {
  console.error("Missing DISCORD_CLIENT_ID. Add the Discord application ID in Railway Variables.");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("wallet")
    .setDescription("View your Lunaris wallet and recent activity"),
  new SlashCommandBuilder()
    .setName("store")
    .setDescription("Browse the Lunaris store"),
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Minecraft username")
    .addStringOption(option =>
      option.setName("username")
        .setDescription("Your exact Minecraft username")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post a permanent customer panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName("type")
        .setDescription("Panel to post")
        .setRequired(true)
        .addChoices(
          { name: "Store", value: "store" },
          { name: "Top up", value: "topup" }
        )
    ),
  new SlashCommandBuilder()
    .setName("payment")
    .setDescription("Approve a pending wallet top-up")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName("reference")
        .setDescription("The LB payment reference")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("provider_reference")
        .setDescription("Receipt or payment-provider reference")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("credit")
    .setDescription("Manually credit a customer wallet")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(option =>
      option.setName("customer")
        .setDescription("Customer to credit")
        .setRequired(true)
    )
    .addNumberOption(option =>
      option.setName("amount")
        .setDescription("Amount in PHP")
        .setMinValue(1)
        .setMaxValue(1000000)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Audit reason")
        .setMaxLength(200)
        .setRequired(true)
    )
].map(command => command.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

startBridgeService(client);

client.once(Events.ClientReady, async readyClient => {
  try {
    const rest = new REST({ version: "10" }).setToken(token);
    const guildId = process.env.DISCORD_GUILD_ID;
    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);
    await rest.put(route, { body: commands });
    console.log(
      `${readyClient.user.tag} is online. Registered ${commands.length} ` +
      `${guildId ? "guild" : "global"} commands.`
    );
  } catch (error) {
    console.error("Failed to register Discord commands:", error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (await handleBridgeSlashCommand(interaction)) return;
    await handleBridgeInteraction(interaction);
  } catch (error) {
    console.error("Interaction error:", error);
    if (!interaction.isRepliable()) return;
    const payload = { content: "An unexpected error occurred.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on(Events.Error, error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

client.login(token).catch(error => {
  console.error("Discord login failed. Check DISCORD_TOKEN:", error);
  process.exit(1);
});
