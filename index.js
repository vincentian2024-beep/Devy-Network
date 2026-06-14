import fs from "fs";

import {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder
} from "discord.js";

import { pingCommand } from "./commands/ping.js";
import { addAutoRole } from "./systems/autorole.js";
import { handleAI } from "./systems/ai.js";
import { ticketPanelCommand } from "./commands/ticketpanel.js";
import { handleTicketModal } from "./systems/ticket.js";
import { suggestionPanelCommand } from "./commands/suggestionpanel.js";
import { createSuggestion } from "./systems/suggestions.js";

import {
  handleJoinToCreate,
  handleVCButtons
} from "./systems/jointocreate.js";

import {
  vcPanelCommand
} from "./commands/vcpanel.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const PREFIX = "?";

// CHANGE THIS TO YOUR WELCOME CHANNEL ID
const WELCOME_CHANNEL = "1514594312166314145";
const TICKET_CATEGORY = "1514630022336348251";
const STAFF_ROLE_ID = "1514923759109406870";
const TICKET_LOGS = "1515246807477649468";
const MEDIA_CHANNEL = "1514956225937149972";
const SUGGESTION_CHANNEL = "1515149890924052540";
const JTC_CHANNEL = "1514875884975423518";
const VC_CATEGORY = "1514630686630346945";

client.once("ready", () => {
  console.log(`${client.user.tag} is online!`);
});

client.on(
  "voiceStateUpdate",
  async (oldState, newState) => {
    await handleJoinToCreate(
      oldState,
      newState
    );
  }
);

client.on("guildMemberAdd", async (member) => {
  await addAutoRole(member);

  const channel =
    member.guild.channels.cache.get(
      WELCOME_CHANNEL
    );

  if (!channel) return;

  channel.send(
    `🌙 Welcome to **Lunaris Craft**, ${member}!`
  );
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  
  const aiHandled = await handleAI(message);

  if (
  message.channel.id === MEDIA_CHANNEL &&
  message.attachments.size > 0
) {
  try {
    await message.startThread({
      name: ` ${message.author.username}'s Threads`,
      autoArchiveDuration: 1440
    });
  } catch (err) {
    console.error(err);
  }
}

if (aiHandled) return;
  
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  // ?testwelcome @user
  if (command === "testwelcome") {
    if (
      !message.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      return message.reply("❌ You need Administrator permission.");
    }

    const user = message.mentions.users.first();

    if (!user) {
      return message.reply("Usage: `?testwelcome @user`");
    }

    const channel = message.guild.channels.cache.get(WELCOME_CHANNEL);

    if (!channel) {
      return message.reply("❌ Welcome channel not found.");
    }

    channel.send(`🌙 Welcome to **Lunaris Craft**, <@${user.id}>!`);
  }

  if (command === "ping") {
  return pingCommand(message);
}
  
  if (command === "ticketpanel") {
  return ticketPanelCommand(message);
}
  if (command === "suggestionpanel") {
  return suggestionPanelCommand(message);
}
  if (command === "vcpanel") {
  return vcPanelCommand(message);
}
});

client.on("interactionCreate", async (interaction) => {

  if (
  interaction.isButton() &&
  interaction.customId === "suggest_upvote"
) {
  const data =
    JSON.parse(
      fs.readFileSync(
        "./data/suggestions.json",
        "utf8"
      )
    );

  const suggestion =
    data[interaction.message.id];

  if (!suggestion)
    return interaction.reply({
      content:
        "Suggestion data missing.",
      ephemeral: true
    });

  suggestion.downvotes =
    suggestion.downvotes.filter(
      id =>
        id !== interaction.user.id
    );

  if (
    !suggestion.upvotes.includes(
      interaction.user.id
    )
  ) {
    suggestion.upvotes.push(
      interaction.user.id
    );
  }

  fs.writeFileSync(
    "./data/suggestions.json",
    JSON.stringify(
      data,
      null,
      2
    )
  );

  const embed =
    EmbedBuilder.from(
      interaction.message.embeds[0]
    );

  embed.spliceFields(
    3,
    1,
    {
      name: "📈 Votes",
      value:
        `👍 ${suggestion.upvotes.length} | 👎 ${suggestion.downvotes.length}`
    }
  );

    if (
  interaction.isButton() &&
  interaction.customId === "suggest_downvote"
) {
  const data =
    JSON.parse(
      fs.readFileSync(
        "./data/suggestions.json",
        "utf8"
      )
    );

  const suggestion =
    data[interaction.message.id];

  if (!suggestion)
    return interaction.reply({
      content:
        "Suggestion data missing.",
      ephemeral: true
    });

  suggestion.upvotes =
    suggestion.upvotes.filter(
      id =>
        id !== interaction.user.id
    );

  if (
    !suggestion.downvotes.includes(
      interaction.user.id
    )
  ) {
    suggestion.downvotes.push(
      interaction.user.id
    );
  }

  fs.writeFileSync(
    "./data/suggestions.json",
    JSON.stringify(
      data,
      null,
      2
    )
  );

  const embed =
    EmbedBuilder.from(
      interaction.message.embeds[0]
    );

  embed.spliceFields(
    3,
    1,
    {
      name: "📈 Votes",
      value:
        `👍 ${suggestion.upvotes.length} | 👎 ${suggestion.downvotes.length}`
    }
  );

  const row1 =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("suggest_upvote")
          .setLabel(
            `👍 ${suggestion.upvotes.length}`
          )
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("suggest_downvote")
          .setLabel(
            `👎 ${suggestion.downvotes.length}`
          )
          .setStyle(ButtonStyle.Danger)
      );

  const row2 =
    interaction.message.components[1];

  return interaction.update({
    embeds: [embed],
    components: [row1, row2]
  });
}

  const row1 =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "suggest_upvote"
          )
          .setLabel(
            `👍 ${suggestion.upvotes.length}`
          )
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            "suggest_downvote"
          )
          .setLabel(
            `👎 ${suggestion.downvotes.length}`
          )
          .setStyle(
            ButtonStyle.Danger
          )
      );

  const row2 =
    interaction.message.components[1];

  return interaction.update({
    embeds: [embed],
    components: [row1, row2]
  });
}
  if (
  interaction.isButton() &&
  interaction.customId === "resolve_ticket"
) {
  if (
    !interaction.member.roles.cache.has(STAFF_ROLE_ID)
  ) {
    return interaction.reply({
      content: "❌ Only staff can resolve tickets.",
      ephemeral: true
    });
  }

  const logChannel =
    interaction.guild.channels.cache.get(
      TICKET_LOGS
    );

  const messages =
    await interaction.channel.messages.fetch({
      limit: 100
    });

  const transcript = messages
    .reverse()
    .map(
      msg =>
        `[${msg.createdAt.toLocaleString()}] ${msg.author.tag}: ${msg.content || "[Attachment]"}`
    )
    .join("\n");

  const transcriptFile =
    new AttachmentBuilder(
      Buffer.from(transcript, "utf8"),
      {
        name: `${interaction.channel.name}-transcript.txt`
      }
    );

  if (logChannel) {
    await logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#22c55e")
          .setTitle("📁 Ticket Resolved")
          .addFields(
            {
              name: "🎫 Ticket",
              value: interaction.channel.name,
              inline: true
            },
            {
              name: "✅ Resolved By",
              value: `${interaction.user}`,
              inline: true
            }
          )
          .setTimestamp()
      ],
      files: [transcriptFile]
    });
  }
    
      await interaction.reply({
    content: `✅ Ticket resolved by ${interaction.user}\n🗑️ Deleting in 10 seconds...`
  });

  setTimeout(async () => {
    try {
      await interaction.channel.delete();
    } catch (err) {
      console.error(err);
    }
  }, 10000);

  return;
}

  if (
  interaction.isButton() &&
  interaction.customId === "claim_ticket"
) {
  if (
    !interaction.member.roles.cache.has(STAFF_ROLE_ID)
  ) {
    return interaction.reply({
      content: "❌ Only staff can claim tickets.",
      ephemeral: true
    });
  }

  if (interaction.channel.topic) {
    return interaction.reply({
      content: "❌ This ticket is already claimed.",
      ephemeral: true
    });
  }

  await interaction.channel.setTopic(interaction.user.id);

  const messages = await interaction.channel.messages.fetch({
    limit: 20
  });

  const ticketMessage = messages.find(
    m =>
      m.author.id === interaction.client.user.id &&
      m.embeds.length > 0
  );

  if (ticketMessage) {
    const embed = EmbedBuilder.from(
      ticketMessage.embeds[0]
    );

    const staffField = embed.data.fields.find(
      field => field.name === "📌 STAFF INFORMATION"
    );

    if (staffField) {
      staffField.value =
        `**Claimed By:** ${interaction.user}\n` +
        `**Status:** In Progress`;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("claim_ticket")
        .setLabel(`Claimed by ${interaction.user.username}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),

      new ButtonBuilder()
        .setCustomId("resolve_ticket")
        .setLabel("Resolve Ticket")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Close Ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

    await ticketMessage.edit({
      embeds: [embed],
      components: [row]
    });
  }

  await interaction.reply({
    content: `📌 Ticket claimed by ${interaction.user}`
  });

  return;
}

if (
  interaction.isButton() &&
  interaction.customId === "close_ticket"
) {
  await interaction.reply({
    content: "🔒 Closing ticket in 5 seconds...",
    ephemeral: false
  });

  setTimeout(async () => {
    try {
      await interaction.channel.delete();
    } catch (err) {
      console.error(err);
    }
  }, 5000);

  return;
}

  if (
  interaction.isModalSubmit() &&
  interaction.customId === "suggestion_modal"
) {
  const suggestion =
    interaction.fields.getTextInputValue(
      "suggestion"
    );

  const reason =
    interaction.fields.getTextInputValue(
      "reason"
    );

  const channel =
    interaction.guild.channels.cache.get(
      SUGGESTION_CHANNEL
    );

  const suggestionData =
    await createSuggestion(
      interaction,
      suggestion,
      reason
    );

  const msg = await channel.send(
  suggestionData
);

const suggestions =
  JSON.parse(
    fs.readFileSync(
      "./data/suggestions.json",
      "utf8"
    )
  );

suggestions[msg.id] = {
  upvotes: [],
  downvotes: []
};

fs.writeFileSync(
  "./data/suggestions.json",
  JSON.stringify(
    suggestions,
    null,
    2
  )
);

  await msg.startThread({
    name: `🌙 Discussion`,
    autoArchiveDuration: 1440
  });

  await interaction.reply({
    content:
      "✅ Suggestion submitted successfully.",
    ephemeral: true
  });

    const panelData =
  JSON.parse(
    fs.readFileSync(
      "./data/panel.json",
      "utf8"
    )
  );

try {
  const oldPanel =
    await channel.messages.fetch(
      panelData.messageId
    );

  await oldPanel.delete();
} catch {}

const panelEmbed =
  new EmbedBuilder()
    .setColor("#a855f7")
    .setTitle(
      "💡 Lunaris Suggestions"
    )
    .setDescription(
      "Have an idea for Lunaris Craft?\n\nClick the button below to submit a suggestion."
    )
    .setFooter({
      text:
        "Lunaris Craft Suggestion System"
    });

const panelRow =
  new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          "open_suggestion"
        )
        .setLabel(
          "Submit Suggestion"
        )
        .setEmoji("📨")
        .setStyle(
          ButtonStyle.Primary
        )
    );

const newPanel =
  await channel.send({
    embeds: [panelEmbed],
    components: [panelRow]
  });

fs.writeFileSync(
  "./data/panel.json",
  JSON.stringify(
    {
      messageId: newPanel.id
    },
    null,
    2
  )
);

  return;
}

if (interaction.isModalSubmit()) {
  return handleTicketModal(interaction);
}

  if (!interaction.isButton()) return;
  
  if (
  interaction.isButton() &&
  interaction.customId === "open_suggestion"
) {
  const modal = new ModalBuilder()
    .setCustomId("suggestion_modal")
    .setTitle("Lunaris Suggestion");

  const suggestion =
    new TextInputBuilder()
      .setCustomId("suggestion")
      .setLabel("Your Suggestion")
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(true);

  const reason =
    new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Reason")
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      suggestion
    ),
    new ActionRowBuilder().addComponents(
      reason
    )
  );

  return interaction.showModal(modal);
}

  if (
  interaction.isButton() &&
  interaction.customId === "suggest_accept"
) {
  if (
    !interaction.member.roles.cache.has(
      STAFF_ROLE_ID
    )
  )
    return;

  const embed =
    EmbedBuilder.from(
      interaction.message.embeds[0]
    );

  embed.spliceFields(
    2,
    1,
    {
      name: "📊 Status",
      value:
        "✅ Accepted by Lunaris Staff"
    }
  );

  await interaction.update({
    embeds: [embed]
  });

  return;
}

if (
  interaction.isButton() &&
  interaction.customId === "suggest_deny"
) {
  if (
    !interaction.member.roles.cache.has(
      STAFF_ROLE_ID
    )
  )
    return;

  const embed =
    EmbedBuilder.from(
      interaction.message.embeds[0]
    );

  embed.spliceFields(
    2,
    1,
    {
      name: "📊 Status",
      value:
        "❌ Denied by Lunaris Staff"
    }
  );

  await interaction.update({
    embeds: [embed]
  });

  return;
}

if (
  interaction.isButton() &&
  interaction.customId === "suggest_implemented"
) {
  if (
    !interaction.member.roles.cache.has(
      STAFF_ROLE_ID
    )
  )
    return;

  const embed =
    EmbedBuilder.from(
      interaction.message.embeds[0]
    );

  embed.spliceFields(
    2,
    1,
    {
      name: "📊 Status",
      value:
        "🚀 Implemented"
    }
  );

  await interaction.update({
    embeds: [embed]
  });

  return;
}

  // REPORT
  if (interaction.customId === "report") {
    const modal = new ModalBuilder()
      .setCustomId("report_modal")
      .setTitle("Player Report");

    const ign = new TextInputBuilder()
      .setCustomId("ign")
      .setLabel("Minecraft IGN")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const platform = new TextInputBuilder()
      .setCustomId("platform")
      .setLabel("Java or Bedrock")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const reported = new TextInputBuilder()
      .setCustomId("reported")
      .setLabel("Reported Player IGN")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const reason = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Reason")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(ign),
      new ActionRowBuilder().addComponents(platform),
      new ActionRowBuilder().addComponents(reported),
      new ActionRowBuilder().addComponents(reason)
    );

    return interaction.showModal(modal);
  }

  // PURCHASE
  if (interaction.customId === "purchase") {
    const modal = new ModalBuilder()
      .setCustomId("purchase_modal")
      .setTitle("Purchase Ticket");

    const ign = new TextInputBuilder()
      .setCustomId("ign")
      .setLabel("Minecraft IGN")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const platform = new TextInputBuilder()
      .setCustomId("platform")
      .setLabel("Java or Bedrock")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const product = new TextInputBuilder()
      .setCustomId("product")
      .setLabel("Product Wanted (Rank or Keys)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const payment = new TextInputBuilder()
      .setCustomId("payment")
      .setLabel("Payment Method (GCash or PayPal)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(ign),
      new ActionRowBuilder().addComponents(platform),
      new ActionRowBuilder().addComponents(product),
      new ActionRowBuilder().addComponents(payment)
    );

    return interaction.showModal(modal);
  }

  // SUPPORT
  if (interaction.customId === "support") {
    const modal = new ModalBuilder()
      .setCustomId("support_modal")
      .setTitle("Support Ticket");

    const ign = new TextInputBuilder()
      .setCustomId("ign")
      .setLabel("Minecraft IGN")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const platform = new TextInputBuilder()
      .setCustomId("platform")
      .setLabel("Java or Bedrock")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const issue = new TextInputBuilder()
      .setCustomId("issue")
      .setLabel("Issue Description")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(ign),
      new ActionRowBuilder().addComponents(platform),
      new ActionRowBuilder().addComponents(issue)
    );

    return interaction.showModal(modal);
  }
});

client.login(process.env.DISCORD_TOKEN);
