import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials
} from "discord.js";
import {
  handleBridgeDmMessage,
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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

startBridgeService(client);

client.once(Events.ClientReady, readyClient => {
  console.log(`${readyClient.user.tag} connected to Discord.`);
  console.log(`Prefix commands are ready. Prefix: ${PREFIX}`);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!message.guild) {
    await handleBridgeDmMessage(message).catch(error => {
      console.error("DM bridge error:", error);
    });
    return;
  }
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
      await message.reply({
        embeds: [new EmbedBuilder()
          .setColor(Number.parseInt(process.env.BRIDGE_COLOR || "7C3AED", 16))
          .setAuthor({ name: "Lunaris Craft • Lunaris Bridge" })
          .setTitle("Command Center")
          .setDescription("Official wallet, store, and automated delivery commands.")
          .addFields(
            {
              name: "Customer Commands",
              value: [
                "`?wallet` — View your private wallet",
                "`?store` — Open the private store",
                "`?link MinecraftName` — Link delivery account"
              ].join("\n")
            },
            {
              name: "Staff Panels",
              value: [
                "`?bridgepanel topup` — Post wallet panel",
                "`?bridgepanel store` — Post store panel"
              ].join("\n")
            },
            {
              name: "Product Management",
              value: [
                "`?addproduct (name) (description) (Rank or Keys) (price)`",
                "`?removeproduct (name or ID)`",
                "`?products` — List configured products"
              ].join("\n")
            },
            {
              name: "Wallet Administration",
              value: [
                "`?approve LB-REFERENCE RECEIPT-ID` — Emergency approval",
                "`?credit @member 500 reason` — Manual credit"
              ].join("\n")
            }
          )
          .setFooter({ text: "Powered by Devy Network" })
          .setTimestamp()]
      });
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
