// src/commands/credit.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import {
  getScore,
  getLeaderboard,
  adjustScore,
  getRandomGif,
} from "../db/socialDb.js";

function scoreLabel(score: number): string {
  if (score >= 50) return "Model Citizen";
  if (score >= 10) return "Upstanding Member";
  if (score >= 0) return "Under Review";
  if (score >= -9) return "Questionable Influence";
  if (score >= -25) return "Public Menace";
  return "Existential Threat";
}

function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

// ---- Sabotage config ----

// Per-user sabotage cooldown (ms). Default 5 minutes.
// You *can* override with CREDIT_SABOTAGE_COOLDOWN_MS in .env.local if you want.
const SABOTAGE_COOLDOWN_MS: number = Number(
  process.env.CREDIT_SABOTAGE_COOLDOWN_MS ?? "300000",
);

// key: `${guildId}:${userId}` -> last sabotage timestamp
const sabotageCooldown = new Map<string, number>();

export const data = new SlashCommandBuilder()
  .setName("credit")
  .setDescription("Check and play with your Social Credit.")
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("Show your Social Credit (or someone else's).")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Whose Social Credit to view (defaults to you)."),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("leaderboard")
      .setDescription("Show the Social Credit leaderboard.")
      .addStringOption((opt) =>
        opt
          .setName("direction")
          .setDescription("Top or bottom")
          .addChoices(
            { name: "Top (highest scores)", value: "top" },
            { name: "Bottom (lowest scores)", value: "bottom" },
          ),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("How many entries to show (1–25)")
          .setMinValue(1)
          .setMaxValue(25),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("steal")
      .setDescription(
        "Steal a random amount (up to 30%) of another player's Social Credit.",
      )
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who are you robbing?")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("sabotage")
      .setDescription(
        "Sabotage someone’s Social Credit (±1–18% swing, with a chance to backfire 1–8% on you).",
      )
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who are you trying to sabotage?")
          .setRequired(true),
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Social Credit only works inside a server.",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand(true);

  // ----- /credit show -----
  if (sub === "show") {
    const target =
      interaction.options.getUser("target") ?? interaction.user;
    const score = getScore(guildId, target.id);
    const label = scoreLabel(score);

    const embed = new EmbedBuilder()
      .setTitle("Social Credit Report")
      .setDescription(
        `${target} has a Social Credit score of **${score}**.\nStatus: **${label}**`,
      );

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ----- /credit leaderboard -----
  if (sub === "leaderboard") {
    const direction =
      (interaction.options.getString("direction") as
        | "top"
        | "bottom"
        | null) ?? "top";
    const limit = interaction.options.getInteger("limit") ?? 10;

    const rows = getLeaderboard(guildId, direction, limit);
    if (rows.length === 0) {
      await interaction.reply({
        content: "No Social Credit data yet.",
        ephemeral: true,
      });
      return;
    }

    const lines = rows.map((row, idx) => {
      const rank = idx + 1;
      let badge: string;
      if (direction === "top") {
        if (rank === 1) badge = "🥇";
        else if (rank === 2) badge = "🥈";
        else if (rank === 3) badge = "🥉";
        else badge = `#${rank}`;
      } else {
        if (rank === 1) badge = "💀";
        else if (rank === 2) badge = "☢️";
        else if (rank === 3) badge = "🚨";
        else badge = `#${rank}`;
      }

      const label = scoreLabel(row.score);
      return `${badge} <@${row.userId}> — **${row.score}** · *${label}*`;
    });

    const title =
      direction === "bottom"
        ? `📉 Social Credit Leaderboard — Bottom ${rows.length}`
        : `📊 Social Credit Leaderboard — Top ${rows.length}`;

    const color =
      direction === "bottom" ? 0xff5555 : 0x55ff99;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(lines.join("\n"))
      .setColor(color)
      .setFooter({ text: "Yakuza Social Credit Bureau" });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ----- /credit steal -----
  if (sub === "steal") {
    const thief = interaction.user;
    const target = interaction.options.getUser("target", true);

    if (target.bot) {
      await interaction.reply({
        content: "You can't steal Social Credit from a bot.",
        ephemeral: true,
      });
      return;
    }

    if (target.id === thief.id) {
      await interaction.reply({
        content: "Dumbass. You can't steal from yourself.",
        ephemeral: true,
      });
      return;
    }

    const victimScore = getScore(guildId, target.id);
    if (victimScore <= 0) {
      await interaction.reply({
        content: `${target} has no Social Credit worth stealing, such a brokie.`,
        ephemeral: true,
      });
      return;
    }

    const maxStealRaw = Math.floor(victimScore * 0.3);
    const maxSteal = Math.max(maxStealRaw, 1);

    if (maxSteal <= 0) {
      await interaction.reply({
        content: `${target} has negative social credit, obvisouly a drain on society.`,
        ephemeral: true,
      });
      return;
    }

    const amount = randomInt(1, maxSteal);

    const victimResult = adjustScore(
      guildId,
      thief.id,
      target.id,
      -amount,
      `Stolen by ${thief.tag}`,
    );

    const thiefResult = adjustScore(
      guildId,
      thief.id,
      thief.id,
      amount,
      `Stole from ${target.tag}`,
    );

    const embed = new EmbedBuilder()
      .setTitle("🕵️ Social Credit Heist")
      .setDescription(
        `${thief} stole **${amount}** Social Credit from ${target}!\n\n` +
          `**${target.username}**: ${victimResult.previous} → ${victimResult.current}\n` +
          `**${thief.username}**: ${thiefResult.previous} → ${thiefResult.current}`,
      )
      .setColor(0xffc857)
      .setFooter({ text: "Crime always pays… In Yakuza." });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ----- /credit sabotage -----
  if (sub === "sabotage") {
    const attacker = interaction.user;
    const target = interaction.options.getUser("target", true);

    if (target.bot) {
      await interaction.reply({
        content: "You can only sabatoge the Resident Retard No other bots accept sabatoge.",
        ephemeral: true,
      });
      return;
    }

    if (target.id === attacker.id) {
      await interaction.reply({
        content:
          "Are you mildly retarded? Avoid self sabotage....genius. Even James Bond didn’t do that. Pick a different target dipshit.",
        ephemeral: true,
      });
      return;
    }

    const key = `${guildId}:${attacker.id}`;
    const now = Date.now();
    const last = sabotageCooldown.get(key) ?? 0;
    const elapsed = now - last;

    if (elapsed < SABOTAGE_COOLDOWN_MS) {
      const remainingMs = SABOTAGE_COOLDOWN_MS - elapsed;
      const remainingSec = Math.ceil(remainingMs / 1000);
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      const friendly =
        mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

      await interaction.reply({
        content: `You need to chill the fuck out on the Sabotages genius. Cooldown remaining: **${friendly}**.`,
        ephemeral: true,
      });
      return;
    }

    const attackerScore = getScore(guildId, attacker.id);
    const targetScore = getScore(guildId, target.id);

    // ---- Target effect: ±1–18% of |targetScore| (or at least 1) ----
    const baseTarget = Math.max(Math.abs(targetScore), 1);
    const pctTarget = randomInt(1, 18);
    let amountTarget = Math.floor((baseTarget * pctTarget) / 100);
    if (amountTarget < 1) amountTarget = 1;

    const targetSign = Math.random() < 0.5 ? 1 : -1;
    const deltaTarget = targetSign * amountTarget;

    const targetResult = adjustScore(
      guildId,
      attacker.id,
      target.id,
      deltaTarget,
      `Sabotage by ${attacker.tag}`,
    );

    // ---- Backfire: 25% chance, -1–8% of |attackerScore| ----
    let backfire = false;
    let attackerResult:
      | { previous: number; current: number }
      | null = null;
    let backfireAmount = 0;

    if (Math.random() < 0.25) {
      const baseAttacker = Math.max(Math.abs(attackerScore), 1);
      const pctAttacker = randomInt(1, 8);
      let amountAtt = Math.floor((baseAttacker * pctAttacker) / 100);
      if (amountAtt < 1) amountAtt = 1;

      backfireAmount = amountAtt;
      const deltaAtt = -amountAtt;

      attackerResult = adjustScore(
        guildId,
        attacker.id,
        attacker.id,
        deltaAtt,
        `Sabotage backfire on ${attacker.tag}`,
      );
      backfire = true;
    }

    sabotageCooldown.set(key, now);

    const deltaStr =
      deltaTarget > 0
        ? `+${deltaTarget}`
        : `${deltaTarget}`;

    let desc =
      `${attacker} attempted to **sabotage** ${target}.\n\n` +
      `**Target change:** ${deltaStr}\n` +
      `**${target.username}:** ${targetResult.previous} → ${targetResult.current}\n`;

    if (backfire && attackerResult) {
      const diff =
        attackerResult.current - attackerResult.previous;
      const diffStr =
        diff < 0 ? `${diff}` : `+${diff}`;

      desc +=
        `\n**Backfire!** ${attacker} also got wrecked.\n` +
        `Lost: **${Math.abs(backfireAmount)}** Social Credit\n` +
        `**${attacker.username}**: ${attackerResult.previous} → ${attackerResult.current} (${diffStr})`;
    }

    const embed = new EmbedBuilder()
      .setTitle("🧨 Social Credit Sabotage")
      .setDescription(desc)
      .setColor(backfire ? 0xef4444 : 0xf97316)
      .setFooter({ text: "Chaos is a sacred ritual." });

    const sabotageGif =
      getRandomGif(guildId, "sabotage") ??
      getRandomGif(guildId, "negative");
    if (sabotageGif) {
      embed.setImage(sabotageGif);
    }

    await interaction.reply({ embeds: [embed] });
    return;
  }
}
