// src/commands/disaster.ts
import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  getLeaderboard,
  adjustScore,
  getRandomGif,
} from "../db/socialDb.js";

type Severity = "tremor" | "storm" | "cataclysm" | "extinction";

function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

type SeverityConfig = {
  minTargets: number;
  maxTargets: number;
  minPct: number;
  maxPct: number;
  negativeBias: number; // 0–1, chance that the change is negative
  baseFloor: number; // minimum absolute score to use as a base
};

const SEVERITY_CONFIG: Record<Severity, SeverityConfig> = {
  tremor: {
    minTargets: 3,
    maxTargets: 7,
    minPct: 5,
    maxPct: 20,
    negativeBias: 0.5,
    baseFloor: 25,
  },
  storm: {
    minTargets: 6,
    maxTargets: 14,
    minPct: 10,
    maxPct: 35,
    negativeBias: 0.6,
    baseFloor: 50,
  },
  cataclysm: {
    minTargets: 10,
    maxTargets: 22,
    minPct: 20,
    maxPct: 60,
    negativeBias: 0.7,
    baseFloor: 100,
  },
  extinction: {
    minTargets: 15,
    maxTargets: 30,
    minPct: 30,
    maxPct: 120,
    negativeBias: 0.85,
    baseFloor: 250,
  },
};

const TITLE_MAP: Record<Severity, string> = {
  tremor: "🌪️ Localized Social Credit Tremor",
  storm: "⛈️ Social Credit Supercell",
  cataclysm: "🌋 Cataclysmic Credit Eruption",
  extinction: "☄️ Extinction-Level Social Credit Event",
};

const COLOR_MAP: Record<Severity, number> = {
  tremor: 0x38bdf8,
  storm: 0x0ea5e9,
  cataclysm: 0xf97316,
  extinction: 0x991b1b,
};

function severityDescription(severity: Severity): string {
  switch (severity) {
    case "tremor":
      return "Minor chaos ripples through the clan’s ledgers. Some folks get nudged, others get scuffed.";
    case "storm":
      return "A wild front of fortune and misfortune rips across the member list. The accountants are screaming.";
    case "cataclysm":
      return "The books explode in every direction. Legends are made and careers are ruined in a single sweep.";
    case "extinction":
    default:
      return "The archives catch fire. Empires crumble, rats ascend, and nothing in the ledger is sacred.";
  }
}

export const data = new SlashCommandBuilder()
  .setName("disaster")
  .setDescription(
    "Unleash a Social Credit natural disaster on the server (admin / judge only).",
  )
  .addStringOption((opt) =>
    opt
      .setName("severity")
      .setDescription("How bad do you want it to be?")
      .addChoices(
        { name: "Tremor (small chaos)", value: "tremor" },
        { name: "Storm (medium chaos)", value: "storm" },
        { name: "Cataclysm (big swings)", value: "cataclysm" },
        { name: "Extinction-Level (unhinged)", value: "extinction" },
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Natural disasters only apply inside a server.",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;

  // ---- Permission check: Manage Server OR SOCIAL_JUDGE_ID OR OWNER_ID ----
  const perms = interaction.memberPermissions;
  const judgeId = process.env.SOCIAL_JUDGE_ID;
  const ownerId = process.env.OWNER_ID;

  const isAdminOrJudge =
    perms?.has(PermissionFlagsBits.ManageGuild) ||
    (judgeId && interaction.user.id === judgeId) ||
    (ownerId && interaction.user.id === ownerId);

  if (!isAdminOrJudge) {
    await interaction.reply({
      content:
        "Only server admins or the appointed High Court Judge may unleash a Social Credit natural disaster.",
      ephemeral: true,
    });
    return;
  }

  const severity =
    (interaction.options.getString("severity") as Severity | null) ??
    "storm";

  const cfg = SEVERITY_CONFIG[severity];

  // ---- Build candidate pool from top + bottom leaderboards ----
  const top = getLeaderboard(guildId, "top", 50);
  const bottom = getLeaderboard(guildId, "bottom", 50);

  const candidatesMap = new Map<string, { userId: string; score: number }>();

  for (const row of top) {
    candidatesMap.set(row.userId, { userId: row.userId, score: row.score });
  }
  for (const row of bottom) {
    if (!candidatesMap.has(row.userId)) {
      candidatesMap.set(row.userId, { userId: row.userId, score: row.score });
    }
  }

  const candidates = Array.from(candidatesMap.values());

  if (candidates.length === 0) {
    await interaction.reply({
      content:
        "There are no Social Credit entries yet. The disaster has nothing to destroy.",
      ephemeral: true,
    });
    return;
  }

  // ---- Decide how many people get hit ----
  const targetCount = Math.min(
    candidates.length,
    randomInt(cfg.minTargets, cfg.maxTargets),
  );

  // ---- Shuffle candidates (Fisher–Yates) ----
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const victims = candidates.slice(0, targetCount);

  type Result = {
    userId: string;
    delta: number;
    before: number;
    after: number;
  };

  const results: Result[] = [];

  for (const victim of victims) {
    const base = Math.max(Math.abs(victim.score), cfg.baseFloor);
    const pct = randomInt(cfg.minPct, cfg.maxPct);
    const magnitude = Math.max(1, Math.floor((base * pct) / 100));
    const sign = Math.random() < cfg.negativeBias ? -1 : 1;
    const delta = sign * magnitude;

    const res = adjustScore(
      guildId,
      interaction.user.id,
      victim.userId,
      delta,
      `Natural disaster (${severity})`,
    );

    results.push({
      userId: victim.userId,
      delta,
      before: res.previous,
      after: res.current,
    });
  }

  // Sort by absolute impact, biggest swings first
  results.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const lines: string[] = [];

  for (const r of results) {
    const deltaStr = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
    lines.push(
      `• <@${r.userId}> — ${r.before} → ${r.after} (${deltaStr})`,
    );
  }

  // Trim lines to avoid hitting embed description limits
  const MAX_LINES = 25;
  let visibleLines = lines;
  if (lines.length > MAX_LINES) {
    visibleLines = lines.slice(0, MAX_LINES);
    visibleLines.push(
      `…and **${lines.length - MAX_LINES}** more souls were swept up in the chaos.`,
    );
  }

  const description =
    severityDescription(severity) +
    `\n\n**Victims affected:** ${results.length}\n\n` +
    visibleLines.join("\n");

  const embed = new EmbedBuilder()
    .setTitle(TITLE_MAP[severity])
    .setDescription(description)
    .setColor(COLOR_MAP[severity] ?? 0x6366f1)
    .setFooter({
      text: `Disaster triggered by ${interaction.user.tag}`,
    })
    .setTimestamp();

  // Use existing GifKind tags only
  const gif =
    getRandomGif(guildId, "sabotage") ??
    getRandomGif(guildId, "negative") ??
    getRandomGif(guildId, "positive");

  if (gif) {
    embed.setImage(gif);
  }

  await interaction.reply({ embeds: [embed] });
}
