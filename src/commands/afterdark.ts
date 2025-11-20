import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';

type TriggerConfig = {
  content?: string;
  files?: string[]; // optional: local file paths if you ever want to attach files
};

// Map of trigger -> payload YOU define.
// Put your own text/links here. I’m using placeholders.
const NSFW_TRIGGERS: Record<string, TriggerConfig> = {
  // Example:
  // bunny: {
  //   content: "https://your-cdn-or-image-link-here",
  // },
  // fox: {
  //   content: "Some text or another link",
  // },
};

export const data = new SlashCommandBuilder()
  .setName('afterdark')
  .setDescription('Drop pre-configured 18+ content in this NSFW channel')
  .addStringOption((opt) =>
    opt
      .setName('trigger')
      .setDescription('Pre-set trigger key')
      .setRequired(true)
      .setAutocomplete(true),
  );

// Optional autocomplete so people can see which triggers exist
export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const allKeys = Object.keys(NSFW_TRIGGERS);

  const filtered = allKeys
    .filter((key) => key.toLowerCase().startsWith(focused))
    .slice(0, 25);

  await interaction.respond(
    filtered.map((key) => ({
      name: key,
      value: key,
    })),
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const channel = interaction.channel;

  // 1) Hard stop if not in a guild text channel
  if (!channel || channel.isDMBased()) {
    await interaction.reply({
      content: 'This command can only be used in a server text channel.',
      ephemeral: true,
    });
    return;
  }

  // Extra safety, though ChatInput should already be text-based
  if (!channel.isTextBased()) {
    await interaction.reply({
      content: 'This command can only be used in a text channel.',
      ephemeral: true,
    });
    return;
  }

  // NSFW gate
  const guildChannel: any = channel;
  if (!guildChannel.nsfw) {
    await interaction.reply({
      content: 'This command can only be used in an **NSFW**-marked channel.',
      ephemeral: true,
    });
    return;
  }

  const trigger = interaction.options.getString('trigger', true).toLowerCase();
  const entry = NSFW_TRIGGERS[trigger];

  if (!entry) {
    await interaction.reply({
      content: `Unknown trigger \`${trigger}\`. Ask an admin which triggers are set up.`,
      ephemeral: true,
    });
    return;
  }

  // At this point we know:
  // - We're in an NSFW channel
  // - The trigger exists

  await interaction.deferReply({ ephemeral: true });

  const payload: { content?: string; files?: string[] } = {};

  if (entry.content) {
    // This can be a link, plain text, whatever you want.
    payload.content = entry.content;
  }

  if (entry.files && Array.isArray(entry.files) && entry.files.length > 0) {
    // Optional: if you want to attach files for some triggers:
    // NSFW_TRIGGERS["x"] = { content: "blah", files: ["./path/to/file.png"] }
    payload.files = entry.files;
  }

  if (!payload.content && !payload.files) {
    await interaction.editReply({
      content: `Trigger \`${trigger}\` is misconfigured (no content/files).`,
    });
    return;
  }

  await channel.send(payload);

  await interaction.editReply({
    content: `Posted content for trigger \`${trigger}\` in this channel.`,
  });
}
