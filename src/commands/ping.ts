// src/commands/ping.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionsBitField,
  type GuildMember,
} from "discord.js";
import { getFunRoles } from "../db/socialDb.js";

// ---- Helpers ----

function isFunOperator(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member as GuildMember | null;
  if (!member) return false;

  // Admins / Manage Guild always allowed
  if (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  ) {
    return true;
  }

  // OWNER_ID override (you)
  const ownerId = process.env.OWNER_ID;
  if (ownerId && interaction.user.id === ownerId) {
    return true;
  }

  // Fun gate roles
  const guildId = interaction.guildId;
  if (!guildId) return false;

  const funRoles = getFunRoles(guildId);
  if (funRoles.length === 0) {
    // No roles configured: only admins/owner
    return false;
  }

  if (member.roles.cache.some((role) => funRoles.includes(role.id))) {
    return true;
  }

  return false;
}

function buildHeaderEmbed(
  mode: "salute" | "maraud" | "barrage",
  targetMention: string,
  total: number,
  intervalMs: number,
  gifUrl?: string | null,
): EmbedBuilder {
  let title: string;
  let color: number;
  let emojiLine: string;

  if (mode === "salute") {
    title = "🎖️ 21 Ping Salute";
    color = 0x3b82f6; // blue-ish
    emojiLine = "🎖️ 🇺🇸 Ceremonial salute engaged.";
  } else if (mode === "maraud") {
    title = "🏴‍☠️ 25 Ping Maraud";
    color = 0xef4444; // red-ish
    emojiLine = "🏴‍☠️ ⚔️ Raider sortie launched.";
  } else {
    title = "📣 Custom Ping Barrage";
    color = 0xa855f7; // purple-ish
    emojiLine = "📣 💥 Chaotic ping barrage initiated.";
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      `${emojiLine}\n\n` +
        `**Target:** ${targetMention}\n` +
        `**Pings:** ${total}\n` +
        `**Interval:** ${intervalMs}ms\n\n` +
        `Watch for messages like \`1/${total}\`, \`2/${total}\`, ...`,
    )
    .setColor(color)
    .setFooter({ text: "Please scream responsibly." });

  if (gifUrl) {
    embed.setImage(gifUrl);
  }

  return embed;
}

function buildPingLine(
  mode: "salute" | "maraud" | "barrage",
  index: number,
  total: number,
  targetMention: string,
): string {
  const counter = `${index}/${total}`;
  const progressSlots = 8;
  const filledSlots = Math.max(
    1,
    Math.round((index / total) * progressSlots),
  );
  const bar =
    "█".repeat(filledSlots) + "░".repeat(progressSlots - filledSlots);

  if (mode === "salute") {
    return `🎖️ (${counter}) [${bar}] 🇺🇸 ${targetMention}`;
  }

  if (mode === "maraud") {
    return `🏴‍☠️ (${counter}) [${bar}] ⚔️ ${targetMention}`;
  }

  return `📣 (${counter}) [${bar}] 💥 ${targetMention}`;
}

function getDefaultsForMode(
  mode: "salute" | "maraud" | "barrage",
  requestedCount: number | null,
  requestedInterval: number | null,
): { total: number; intervalMs: number } {
  let defaultCount: number;
  let defaultInterval: number;

  if (mode === "salute") {
    defaultCount = 21;
    defaultInterval = 750;
  } else if (mode === "maraud") {
    defaultCount = 25;
    defaultInterval = 600;
  } else {
    defaultCount = 10;
    defaultInterval = 500;
  }

  const total =
    requestedCount ?? defaultCount;

  const intervalMs = Math.min(
    5000,
    Math.max(150, requestedInterval ?? defaultInterval),
  );

  return { total, intervalMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Command definition ----

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Launch ceremonial or chaotic ping salvos.")
  .addSubcommand((sub) =>
    sub
      .setName("salute")
      .setDescription("Fire a 21 ping salute at someone.")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who is being honored?")
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("pings")
          .setDescription("Number of pings (default 21)")
          .setMinValue(1)
          .setMaxValue(100),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("interval_ms")
          .setDescription("Delay between pings in ms (default ~750)")
          .setMinValue(150)
          .setMaxValue(5000),
      )
      .addStringOption((opt) =>
        opt
          .setName("gif_url")
          .setDescription("Optional GIF to accompany the salute."),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("maraud")
      .setDescription("Launch a 25 ping maraud.")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who are we raiding?")
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("pings")
          .setDescription("Number of pings (default 25)")
          .setMinValue(1)
          .setMaxValue(100),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("interval_ms")
          .setDescription("Delay between pings in ms (default ~600)")
          .setMinValue(150)
          .setMaxValue(5000),
      )
      .addStringOption((opt) =>
        opt
          .setName("gif_url")
          .setDescription("Optional GIF to accompany the maraud."),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("barrage")
      .setDescription("Custom ping barrage for maximum chaos.")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who are we harassing?")
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("pings")
          .setDescription("Number of pings (default 10)")
          .setMinValue(1)
          .setMaxValue(200),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("interval_ms")
          .setDescription("Delay between pings in ms (default ~500)")
          .setMinValue(150)
          .setMaxValue(5000),
      )
      .addStringOption((opt) =>
        opt
          .setName("gif_url")
          .setDescription("Optional GIF to accompany the barrage."),
      ),
  );

// ---- Handler ----

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command only works in servers.",
      ephemeral: true,
    });
    return;
  }

  if (!isFunOperator(interaction)) {
    await interaction.reply({
      content:
        "You are not authorized to fire the Yak Yak pings. Ask an admin to grant you the fun gate role.",
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand(true) as
    | "salute"
    | "maraud"
    | "barrage";

  const target = interaction.options.getUser("target", true);
  const pingsOpt = interaction.options.getInteger("pings");
  const intervalOpt = interaction.options.getInteger("interval_ms");
  const gifUrl = interaction.options.getString("gif_url") ?? null;

  const { total, intervalMs } = getDefaultsForMode(
    sub,
    pingsOpt,
    intervalOpt,
  );

  if (!interaction.channel || !interaction.channel.isTextBased()) {
    await interaction.reply({
      content: "I can't send pings in this channel type.",
      ephemeral: true,
    });
    return;
  }

  const textChannel: any = interaction.channel;
  const targetMention = `${target}`;

  const headerEmbed = buildHeaderEmbed(
    sub,
    targetMention,
    total,
    intervalMs,
    gifUrl,
  );

  await interaction.reply({ embeds: [headerEmbed] });

  // Fire the salvo
  for (let i = 1; i <= total; i++) {
    const line = buildPingLine(sub, i, total, targetMention);
    await textChannel.send({ content: line });
    if (i < total) {
      await sleep(intervalMs);
    }
  }
}
