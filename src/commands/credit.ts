// src/commands/credit.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import {
  getScore,
  getLeaderboard,
  adjustScore,
  getRandomGif,
  getTodayActivityTotal,
  getRecentLogForUser,
  getSabotageStatsSince,
  getCreditActionChannel,
  setCreditActionChannel,
} from "../db/socialDb.js";

function scoreLabel(score: number): string {
  // Perfectly neutral
  if (score === 0) {
    return "🌀 Unlisted in the Family Ledger";
  }

  // -------- Positive side: climbing the syndicate --------
  if (score > 0) {
    if (score >= 10_000_000) return "⛩ Mythic Dragon of the Clan";
    if (score >= 5_000_000) return "🌋 World-Breaking Legend";
    if (score >= 1_000_000) return "👑 Shadow Shogun";
    if (score >= 500_000) return "🉐 Legendary Oyabun";
    if (score >= 250_000) return "🐉 Clan Kumicho";
    if (score >= 100_000) return "🪙 Saiko-komon (Shadow Advisor)";
    if (score >= 50_000) return "🗡 Wakagashira (Underboss)";
    if (score >= 25_000) return "🏮 Street Emperor";
    if (score >= 10_000) return "🔥 Red Lantern Captain";
    if (score >= 5_000) return "🎴 High-Roller Enforcer";
    if (score >= 2_500) return "🥋 Kyodai (Big Brother)";
    if (score >= 1_000) return "💼 Trusted Fixer";
    if (score >= 500) return "💴 Serious Earner";
    if (score >= 250) return "📈 Rising Star of the Clan";
    if (score >= 100) return "📜 Reliable Collector";
    if (score >= 50) return "🧳 Trusted Bagman";
    if (score >= 25) return "🪪 Local Operator";
    if (score >= 10) return "📊 Minor Associate";
    // 1–9
    return "🏮 Shopfront Civilian";
  }

  // -------- Negative side: falling into the gutter --------
  if (score <= -10_000_000) return "🌑 Final Boss of Bad Decisions";
  if (score <= -5_000_000) return "☄️ Walking Extinction Event";
  if (score <= -1_000_000) return "👻 Urban Legend (Do Not Engage)";
  if (score <= -500_000) return "💀 Federally Monitored Disaster";
  if (score <= -250_000) return "🚨 Sirens On Sight";
  if (score <= -100_000) return "🚔 Permanent Police Escort";
  if (score <= -50_000) return "📛 Clan-Wide Embarrassment";
  if (score <= -25_000) return "🕳 Reputation Black Hole";
  if (score <= -10_000) return "⛓ Lifetime Debt Slave";
  if (score <= -5_000) return "🩸 Catastrophic Liability";
  if (score <= -2_500) return "⛔ Nuclear-Level Problem";
  if (score <= -1_000) return "🕵️ Snitch Rumors Everywhere";
  if (score <= -500) return "📉 Bad Debt Magnet";
  if (score <= -250) return "⚠️ Clan Liability";
  if (score <= -100) return "☠️ Existential Threat to the Clan";
  if (score <= -50) return "💣 Danger to Society";
  if (score <= -25) return "😬 Loose Cannon";
  if (score <= -10) return "🚬 Suspicious Drifter";
  // -1 to -9
  return "😐 Mildly Suspect";
}

function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function formatCooldown(msRemaining: number): string {
  const remainingSec = Math.ceil(msRemaining / 1000);
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// ---- Cooldowns ----

// Per-user sabotage cooldown (ms). Default 5 minutes.
// You *can* override with CREDIT_SABOTAGE_COOLDOWN_MS in .env.local if you want.
const SABOTAGE_COOLDOWN_MS: number = Number(
  process.env.CREDIT_SABOTAGE_COOLDOWN_MS ?? "300000",
);
// key: `${guildId}:${userId}` -> last sabotage timestamp
const sabotageCooldown = new Map<string, number>();

// Per-user steal cooldown (ms). Default 5 minutes.
// Optional override: CREDIT_STEAL_COOLDOWN_MS
const STEAL_COOLDOWN_MS: number = Number(
  process.env.CREDIT_STEAL_COOLDOWN_MS ?? "300000",
);
// key: `${guildId}:${userId}` -> last steal timestamp
const stealCooldown = new Map<string, number>();

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
  )
  .addSubcommand((sub) =>
    sub
      .setName("rapsheet")
      .setDescription(
        "Show the last 10 Social Credit events for you (or a target).",
      )
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Whose rap sheet to view (defaults to you)."),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("How many events to show (1–25, default 10).")
          .setMinValue(1)
          .setMaxValue(25),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("most_sabotaged")
      .setDescription("Show the most sabotaged members this week.")
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("How many entries to show (1–25, default 10).")
          .setMinValue(1)
          .setMaxValue(25),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("set_action_channel")
      .setDescription(
        "Set the only channel where /credit steal and /credit sabotage are allowed.",
      )
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Allowed channel for credit actions")
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
          )
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

  // ----- /credit set_action_channel -----
  if (sub === "set_action_channel") {
    const channel = interaction.options.getChannel("channel", true);

    const isAdmin =
      interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild,
      ) ||
      (process.env.OWNER_ID &&
        interaction.user.id === process.env.OWNER_ID);

    if (!isAdmin) {
      await interaction.reply({
        content:
          "Only server admins (Manage Server) can set the credit action channel.",
        ephemeral: true,
      });
      return;
    }

    setCreditActionChannel(guildId, channel.id);

    const embed = new EmbedBuilder()
      .setTitle("✅ Credit Action Channel Set")
      .setDescription(
        `Steal and sabotage are now restricted to <#${channel.id}>.`,
      )
      .setFooter({ text: "Yak Yak Social Credit Bureau" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // helper: enforce channel for steal/sabotage
  async function enforceActionChannel(): Promise<boolean> {
    const actionChannelId = getCreditActionChannel(guildId);

    if (!actionChannelId) {
      await interaction.reply({
        content:
          "Credit actions aren’t configured yet. An admin must run `/credit set_action_channel #channel` first.",
        ephemeral: true,
      });
      return false;
    }

    if (interaction.channelId !== actionChannelId) {
      await interaction.reply({
        content: `Steal and sabotage only work in <#${actionChannelId}>.`,
        ephemeral: true,
      });
      return false;
    }

    return true;
  }

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
      .setFooter({ text: "Social Credit Bureau" });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ----- /credit steal -----
  if (sub === "steal") {
    if (!(await enforceActionChannel())) return;

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
        content: "Nice try. You can't steal from yourself.",
        ephemeral: true,
      });
      return;
    }

    // Cooldown check (per guild + thief)
    const stealKey = `${guildId}:${thief.id}`;
    const nowMs = Date.now();
    const lastSteal = stealCooldown.get(stealKey) ?? 0;
    const stealElapsed = nowMs - lastSteal;

    if (stealElapsed < STEAL_COOLDOWN_MS) {
      const remainingMs = STEAL_COOLDOWN_MS - stealElapsed;
      await interaction.reply({
        content: `You’re still cooling off from your last heist. Cooldown remaining: **${formatCooldown(
          remainingMs,
        )}**.`,
        ephemeral: true,
      });
      return;
    }

    const victimScore = getScore(guildId, target.id);
    if (victimScore <= 0) {
      await interaction.reply({
        content: `${target} has no Social Credit worth stealing.`,
        ephemeral: true,
      });
      return;
    }

    const maxStealRaw = Math.floor(victimScore * 0.3);
    const maxSteal = Math.max(maxStealRaw, 1);

    if (maxSteal <= 0) {
      await interaction.reply({
        content: `${target} has no Social Credit worth stealing.`,
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

    // Burn cooldown only on successful steal
    stealCooldown.set(stealKey, nowMs);

    const embed = new EmbedBuilder()
      .setTitle("🕵️ Social Credit Heist")
      .setDescription(
        `${thief} stole **${amount}** Social Credit from ${target}!\n\n` +
          `**${target.username}**: ${victimResult.previous} → ${victimResult.current}\n` +
          `**${thief.username}**: ${thiefResult.previous} → ${thiefResult.current}`,
      )
      .setColor(0xffc857)
      .setFooter({ text: "Crime always pays… until it doesn’t." });

    // Heist gif: prefer negative (victim pain), fallback positive
    const heistGif =
      getRandomGif(guildId, "negative") ??
      getRandomGif(guildId, "positive");
    if (heistGif) {
      embed.setImage(heistGif);
    }

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ----- /credit sabotage -----
  if (sub === "sabotage") {
    if (!(await enforceActionChannel())) return;

    const attacker = interaction.user;
    const target = interaction.options.getUser("target", true);

    if (target.bot) {
      await interaction.reply({
        content: "You can't sabotage a bot. They have no soul.",
        ephemeral: true,
      });
      return;
    }

    if (target.id === attacker.id) {
      await interaction.reply({
        content:
          "You’re trying to sabotage **yourself**. Even James Bond didn’t do that. Pick a different target.",
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
      await interaction.reply({
        content: `You recently attempted sabotage. Cooldown remaining: **${formatCooldown(
          remainingMs,
        )}**.`,
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
      deltaTarget > 0 ? `+${deltaTarget}` : `${deltaTarget}`;

    let desc =
      `${attacker} attempted to **sabotage** ${target}.\n\n` +
      `**Target change:** ${deltaStr}\n` +
      `**${target.username}**: ${targetResult.previous} → ${targetResult.current}\n`;

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
      getRandomGif(guildId, "negative") ??
      getRandomGif(guildId, "positive");
    if (sabotageGif) {
      embed.setImage(sabotageGif);
    }

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ----- /credit rapsheet -----
  if (sub === "rapsheet") {
    const target =
      interaction.options.getUser("target") ?? interaction.user;
    const limit = interaction.options.getInteger("limit") ?? 10;

    const entries = getRecentLogForUser(guildId, target.id, limit);

    if (entries.length === 0) {
      await interaction.reply({
        content: `${target} has no Social Credit history yet.`,
        ephemeral: true,
      });
      return;
    }

    const lines = entries.map((entry) => {
      const deltaStr =
        entry.delta > 0 ? `+${entry.delta}` : `${entry.delta}`;
      const actor =
        entry.actorId != null
          ? `<@${entry.actorId}>`
          : "System / Auto";
      const reason = entry.reason ?? "No reason recorded";
      const ts = entry.createdAt; // seconds
      const timeTag = `<t:${ts}:R>`; // "x minutes ago"

      return `• ${timeTag} — **${deltaStr}** (${reason}) · by ${actor}`;
    });

    const embed = new EmbedBuilder()
      .setTitle("📂 Social Credit Rap Sheet")
      .setDescription(lines.join("\n"))
      .setFooter({
        text: `Showing last ${entries.length} events for ${
          target.tag ?? target.username
        }`,
      });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ----- /credit most_sabotaged -----
  if (sub === "most_sabotaged") {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const nowSec = Math.floor(Date.now() / 1000);
    const weekAgo = nowSec - 7 * 24 * 60 * 60;

    const rows = getSabotageStatsSince(guildId, weekAgo, limit);

    if (rows.length === 0) {
      await interaction.reply({
        content:
          "No sabotage events recorded in the last 7 days. The clan has been… unusually calm.",
        ephemeral: true,
      });
      return;
    }

    const lines = rows.map((row, idx) => {
      const rank = idx + 1;
      let badge: string;
      if (rank === 1) badge = "🥇";
      else if (rank === 2) badge = "🥈";
      else if (rank === 3) badge = "🥉";
      else badge = `#${rank}`;

      const netStr =
        row.netDelta > 0
          ? `+${row.netDelta}`
          : `${row.netDelta}`;

      return `${badge} <@${row.targetId}> — sabotaged **${row.hits}** times, lost **${row.totalLoss}** (net: ${netStr})`;
    });

    const embed = new EmbedBuilder()
      .setTitle("🧨 Most Sabotaged — Last 7 Days")
      .setDescription(lines.join("\n"))
      .setFooter({
        text: "Window: last 7 days · Based on Sabotage events only",
      });

    await interaction.reply({ embeds: [embed] });
    return;
  }
}
