import {
  Client,
  Events,
  GatewayIntentBits
} from "discord.js";
import {
  handleBridgeCommand,
  handleBridgeInteraction,
  startBridgeService
} from "./bridge.js";

const token = process.env.DISCORD_TOKEN;
const PREFIX = "?";

if (!token) {
  console.error("Missing DISCORD_TOKEN. Add it in Railway Variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

startBridgeService(client);

client.once(Events.ClientReady, readyClient => {
  console.log(`${readyClient.user.tag} connected to Discord.`);
  console.log(`Prefix commands are ready. Prefix: ${PREFIX}`);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/);
  const command = args.shift()?.toLowerCase();

  if (!command) return;

  try {
    const handled = await handleBridgeCommand(message, command, args);
    if (!handled && command === "help") {
      await message.reply([
        "**Lunaris Bridge Commands**",
        "`?wallet` - Check your wallet",
        "`?store` - Browse the store",
        "`?link MinecraftName` - Link Minecraft",
        "",
        "**Staff**",
        "`?bridgepanel topup` - Post top-up panel",
        "`?bridgepanel store` - Post store panel",
        "`?approve LB-REFERENCE RECEIPT-ID` - Approve payment",
        "`?credit @member 500 reason` - Credit a wallet"
      ].join("\n"));
    }
  } catch (error) {
    console.error("Command error:", error);
    await message.reply("An unexpected command error occurred.").catch(() => {});
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
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
