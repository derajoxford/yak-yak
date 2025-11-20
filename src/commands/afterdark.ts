// src/commands/afterdark.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  PermissionFlagsBits,
} from "discord.js";
import {
  getKeyword,
  setKeyword,
  deleteKeyword,
  listKeywords,
} from "../afterdarkStore.js";

export const data = new SlashCommandBuilder()
  .setName("afterdark")
  .setDescription("Admin: manage and trigger NSFW keyword responses")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("set")
      .setDescription("Create or update an afterdark keyword")
      .addStringOption((opt) =>
        opt
          .setName("keyword")
          .setDescription("Keyword to configure (e.g. booty)")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("content")
          .setDescription("Text or URL to send when this keyword is used")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Delete an afterdark keyword")
      .addStringOption((opt) =>
        opt
          .setName("keyword")
          .setDescription("Keyword to delete")
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List configured afterdark keywords for this server"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("send")
      .setDescription("Send a configured keyword in this NSFW channel")
      .addStringOption((opt) =>
        opt
          .setName("keyword")
          .setDescription("Keyword to send")
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

export async function autocomplete(interaction: AutocompleteInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.respond([]);
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub !== "send" && sub !== "delete") {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused().toLowerCase();
  const keys = await listKeywords(guildId);
  const filtered = keys
    .filter((k) => k.toLowerCase().includes(focused))
    .slice(0, 25);

  await interaction.respond(
    filtered.map((k) => ({
      name: k,
      value: k,
    })),
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "set") {
    const keywordRaw = interaction.options.getString("keyword", true);
    const content = interaction.options.getString("content", true);

    const keyword = keywordRaw.trim().toLowerCase();
    if (!keyword) {
      await interaction.reply({
        content: "Keyword cannot be empty.",
        ephemeral: true,
      });
      return;
    }

    await setKeyword(guildId, keyword, { content });

    await interaction.reply({
      content: `Saved afterdark keyword \`${keyword}\`. It will reply with:\n${content}`,
      ephemeral: true,
    });
    return;
  }

  if (sub === "delete") {
    const keywordRaw = interaction.options.getString("keyword", true);
    const keyword = keywordRaw.trim().toLowerCase();

    const ok = await deleteKeyword(guildId, keyword);
    await interaction.reply({
      content: ok
        ? `Deleted afterdark keyword \`${keyword}\`.`
        : `Keyword \`${keyword}\` was not found.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === "list") {
    const keys = await listKeywords(guildId);
    if (keys.length === 0) {
      await interaction.reply({
        content: "No afterdark keywords configured for this server yet.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Configured afterdark keywords for this server:\n${keys
        .sort()
        .map((k) => `• \`${k}\``)
        .join("\n")}`,
      ephemeral: true,
    });
    return;
  }

  if (sub === "send") {
    const channel = interaction.channel;

    if (!channel || !channel.isTextBased()) {
      await interaction.reply({
        content: "This subcommand must be used in a text channel.",
        ephemeral: true,
      });
      return;
    }

    const guildChannel: any = channel;
    if (!guildChannel.nsfw) {
      await interaction.reply({
        content: "This subcommand can only be used in an **NSFW**-marked channel.",
        ephemeral: true,
      });
      return;
    }

    const keywordRaw = interaction.options.getString("keyword", true);
    const keyword = keywordRaw.trim().toLowerCase();

    const entry = await getKeyword(guildId, keyword);
    if (!entry || !entry.content) {
      await interaction.reply({
        content: `No content configured for keyword \`${keyword}\`.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await channel.send({ content: entry.content });

    await interaction.editReply({
      content: `Posted afterdark content for keyword \`${keyword}\` in this channel.`,
    });
    return;
  }

  // Fallback (should not hit)
  await interaction.reply({
    content: "Unknown subcommand.",
    ephemeral: true,
  });
}
