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

// ---- "Prison" lockouts (extra punishment / heat) ----

// Base "sentence" length for botched / extreme plays (default 10 minutes).
const STEAL_PRISON_BASE_MS: number = Number(
  process.env.CREDIT_STEAL_PRISON_MS ?? "600000",
);
const SABOTAGE_PRISON_BASE_MS: number = Number(
  process.env.CREDIT_SABOTAGE_PRISON_MS ?? "600000",
);

// key: `${guildId}:${userId}` -> prison-until timestamp (ms since epoch)
const stealPrison = new Map<string, number>();
const sabotagePrison = new Map<string, number>();

function checkPrison(
  map: Map<string, number>,
  key: string,
): { locked: boolean; remainingMs: number; untilSec: number } {
  const now = Date.now();
  const until = map.get(key) ?? 0;
  if (until <= now) {
    if (until) map.delete(key);
    return { locked: false, remainingMs: 0, untilSec: 0 };
  }
  const remainingMs = until - now;
  const untilSec = Math.floor(until / 1000);
  return { locked: true, remainingMs, untilSec };
}

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
        "Roll the dice to steal Social Credit from another player.",
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
        "Roll the dice to sabotage someone’s Social Credit (may backfire).",
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

    // Prison check first
    {
      const prisonKey = `${guildId}:${thief.id}`;
      const { locked, remainingMs, untilSec } = checkPrison(
        stealPrison,
        prisonKey,
      );
      if (locked) {
        await interaction.reply({
          content:
            `⛓ Clan Court says you're still in lockup for **${formatCooldown(
              remainingMs,
            )}** (you'll be free <t:${untilSec}:R>).`,
          ephemeral: true,
        });
        return;
      }
    }

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

    const thiefScoreBefore = getScore(guildId, thief.id);
    const victimScoreBefore = getScore(guildId, target.id);

    if (victimScoreBefore <= 0) {
      await interaction.reply({
        content: `${target} has no Social Credit worth stealing.`,
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

    const baseVictim = Math.max(Math.abs(victimScoreBefore), 1);

    // 🎲 Dice-based outcome table
    const roll = randomInt(1, 100);

    let victimDelta = 0;
    let thiefDelta = 0;
    let outcomeLabel = "";
    let outcomeFlavor = "";
    let prisonAddedMs = 0;

    if (roll <= 3) {
      // 1–3: Catastrophic bust — big fine, no steal, long prison
      outcomeLabel = "Catastrophic Bust";
      const pct = randomInt(15, 30);
      const baseFine = Math.max(Math.abs(thiefScoreBefore), 10);
      let fine = Math.floor((baseFine * pct) / 100);
      if (fine < 1) fine = 1;
      thiefDelta = -fine;
      outcomeFlavor =
        "You trip the alarms, the clan accountant and the cops show up at the same time. Massive fine, zero payout.";
      prisonAddedMs = STEAL_PRISON_BASE_MS * 2;
    } else if (roll <= 10) {
      // 4–10: Busted by security — medium fine, short prison
      outcomeLabel = "Busted by Security";
      const pct = randomInt(5, 15);
      const baseFine = Math.max(Math.abs(thiefScoreBefore), 5);
      let fine = Math.floor((baseFine * pct) / 100);
      if (fine < 1) fine = 1;
      thiefDelta = -fine;
      outcomeFlavor =
        "The cameras catch everything. You get marched into clan court and slapped with a fine.";
      prisonAddedMs = STEAL_PRISON_BASE_MS;
    } else if (roll <= 25) {
      // 11–25: Botched job — tiny or zero steal
      outcomeLabel = "Botched Job";
      const pct = randomInt(1, 5);
      let amount = Math.floor((baseVictim * pct) / 100);
      if (amount < 1) amount = 0; // can fully fizzle
      if (amount > 0) {
        victimDelta = -amount;
        thiefDelta = amount;
        outcomeFlavor =
          "You barely get away with a handful of coins. The mark doesn’t even notice.";
      } else {
        outcomeFlavor =
          "You fumble the bag so hard you leave the scene with nothing but anxiety.";
      }
    } else if (roll <= 70) {
      // 26–70: Standard heist — 5–20% of victim
      outcomeLabel = "Standard Heist";
      const pct = randomInt(5, 20);
      let amount = Math.floor((baseVictim * pct) / 100);
      if (amount < 1) amount = 1;
      victimDelta = -amount;
      thiefDelta = amount;
      outcomeFlavor =
        "Smooth work. In, out, cash in hand before anyone knows what happened.";
    } else if (roll <= 90) {
      // 71–90: Clean score — 15–30% of victim
      outcomeLabel = "Clean Score";
      const pct = randomInt(15, 30);
      let amount = Math.floor((baseVictim * pct) / 100);
      if (amount < 1) amount = 1;
      victimDelta = -amount;
      thiefDelta = amount;
      outcomeFlavor =
        "This one goes in the highlight reel. You walk off whistling and counting stacks.";
    } else if (roll <= 98) {
      // 91–98: High-stakes robbery — 25–40%, must lay low
      outcomeLabel = "High-Stakes Robbery";
      const pct = randomInt(25, 40);
      let amount = Math.floor((baseVictim * pct) / 100);
      if (amount < 1) amount = 1;
      victimDelta = -amount;
      thiefDelta = amount;
      outcomeFlavor =
        "You hit the jackpot and half the district is talking about it. Maybe keep a low profile.";
      prisonAddedMs = STEAL_PRISON_BASE_MS; // heat
    } else {
      // 99–100: Heist of the Century — 35–50%, long heat
      outcomeLabel = "Heist of the Century";
      const pct = randomInt(35, 50);
      let amount = Math.floor((baseVictim * pct) / 100);
      if (amount < 1) amount = 1;
      victimDelta = -amount;
      thiefDelta = amount;
      outcomeFlavor =
        "You just signed your own documentary deal. The whole clan is impressed—and watching you closely.";
      prisonAddedMs = STEAL_PRISON_BASE_MS * 2;
    }

    // Apply DB changes
    let victimBefore = victimScoreBefore;
    let victimAfter = victimScoreBefore;
    let thiefBefore = thiefScoreBefore;
    let thiefAfter = thiefScoreBefore;

    if (victimDelta !== 0) {
      const res = adjustScore(
        guildId,
        thief.id,
        target.id,
        victimDelta,
        `Heist [${outcomeLabel}] on ${target.tag}`,
      );
      victimBefore = res.previous;
      victimAfter = res.current;
    }

    if (thiefDelta !== 0) {
      const res = adjustScore(
        guildId,
        thief.id,
        thief.id,
        thiefDelta,
        victimDelta !== 0
          ? `Heist [${outcomeLabel}] vs ${target.tag}`
          : `Heist fine [${outcomeLabel}]`,
      );
      thiefBefore = res.previous;
      thiefAfter = res.current;
    }

    // Burn cooldown on ANY attempted heist
    stealCooldown.set(stealKey, nowMs);

    // Optional prison lock
    let prisonNote = "";
    if (prisonAddedMs > 0) {
      const until = Date.now() + prisonAddedMs;
      const untilSec = Math.floor(until / 1000);
      stealPrison.set(`${guildId}:${thief.id}`, until);
      prisonNote = `\n\n⛓ Clan Court sentences ${thief} to **${formatCooldown(
        prisonAddedMs,
      )}** in Social Credit prison (no more heists until <t:${untilSec}:R>).`;
    }

    const embed = new EmbedBuilder()
      .setTitle("🕵️ Social Credit Heist")
      .setDescription(() => {
        const lines: string[] = [];
        lines.push(`🎲 Roll: **${roll}** — **${outcomeLabel}**`);
        lines.push("");
        if (victimDelta < 0 && thiefDelta > 0) {
          const amount = Math.abs(victimDelta);
          lines.push(
            `${thief} stole **${amount}** Social Credit from ${target}.`,
          );
          lines.push("");
          lines.push(
            `**${target.username}**: ${victimBefore} → ${victimAfter}`,
          );
          lines.push(
            `**${thief.username}**: ${thiefBefore} → ${thiefAfter}`,
          );
        } else if (thiefDelta < 0 && victimDelta === 0) {
          const fine = Math.abs(thiefDelta);
          lines.push(
            `${thief} got caught trying to rob ${target} and was fined **${fine}** Social Credit.`,
          );
          lines.push("");
          lines.push(
            `**${thief.username}**: ${thiefBefore} → ${thiefAfter}`,
          );
        } else {
          // Pure fizzle (no DB change)
          lines.push(
            `${thief} attempts a heist on ${target}… and absolutely nothing happens.`,
          );
          lines.push("");
          lines.push(
            `**${target.username}**: ${victimScoreBefore} → ${victimScoreBefore}`,
          );
          lines.push(
            `**${thief.username}**: ${thiefScoreBefore} → ${thiefScoreBefore}`,
          );
        }
        lines.push("");
        lines.push(outcomeFlavor);
        if (prisonNote) lines.push(prisonNote);
        return lines.join("\n");
      })
      .setColor(
        thiefDelta < 0
          ? 0xff5555 // big L
          : victimDelta < 0
            ? 0xffc857 // successful steal
            : 0x9ca3af, // nothingburger
      )
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

    // Prison check first
    {
      const prisonKey = `${guildId}:${attacker.id}`;
      const { locked, remainingMs, untilSec } = checkPrison(
        sabotagePrison,
        prisonKey,
      );
      if (locked) {
        await interaction.reply({
          content:
            `⛓ You’re still under clan investigation for prior sabotage. Remaining sentence: **${formatCooldown(
              remainingMs,
            )}** (free <t:${untilSec}:R>).`,
          ephemeral: true,
        });
        return;
      }
    }

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

    const attackerScoreBefore = getScore(guildId, attacker.id);
    const targetScoreBefore = getScore(guildId, target.id);

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

    const baseTarget = Math.max(Math.abs(targetScoreBefore), 1);
    const baseAttacker = Math.max(Math.abs(attackerScoreBefore), 1);

    // 🎲 Dice-based sabotage outcome
    const roll = randomInt(1, 100);

    let targetDelta = 0;
    let attackerDelta = 0;
    let outcomeLabel = "";
    let outcomeFlavor = "";
    let prisonAddedMs = 0;

    if (roll <= 5) {
      // 1–5: Catastrophic self-own — huge self hit, no target change, long prison
      outcomeLabel = "Catastrophic Self-Own";
      const pctSelf = randomInt(15, 30);
      let dmgSelf = Math.floor((baseAttacker * pctSelf) / 100);
      if (dmgSelf < 1) dmgSelf = 1;
      attackerDelta = -dmgSelf;
      outcomeFlavor =
        "You slip on your own banana peel, blow your cover, and tank your own reputation in one move.";
      prisonAddedMs = SABOTAGE_PRISON_BASE_MS * 2;
    } else if (roll <= 15) {
      // 6–15: Backfire — moderate self hit, tiny buff to target
      outcomeLabel = "Backfire";
      const pctSelf = randomInt(5, 15);
      let dmgSelf = Math.floor((baseAttacker * pctSelf) / 100);
      if (dmgSelf < 1) dmgSelf = 1;
      attackerDelta = -dmgSelf;

      const pctBuff = randomInt(1, 5);
      let buff = Math.floor((baseTarget * pctBuff) / 100);
      if (buff < 1) buff = 1;
      targetDelta = buff;

      outcomeFlavor =
        "Your plan leaks, the target spins the story, and you look like the clown.";
      prisonAddedMs = SABOTAGE_PRISON_BASE_MS;
    } else if (roll <= 30) {
      // 16–30: Fizzle — tiny +/- change or nothing
      outcomeLabel = "Total Fizzle";
      const pct = randomInt(1, 3);
      let amount = Math.floor((baseTarget * pct) / 100);
      if (amount < 1) amount = 0;
      if (amount > 0) {
        const sign = Math.random() < 0.5 ? -1 : 1;
        targetDelta = sign * amount;
        outcomeFlavor =
          "Rumors fly for about twelve seconds, then everyone forgets.";
      } else {
        outcomeFlavor =
          "You push the dominoes and they refuse to fall. Nothing really sticks.";
      }
    } else if (roll <= 60) {
      // 31–60: Standard chaos — ±5–15% to target
      outcomeLabel = "Standard Sabotage";
      const pct = randomInt(5, 15);
      let amount = Math.floor((baseTarget * pct) / 100);
      if (amount < 1) amount = 1;
      const sign = Math.random() < 0.5 ? -1 : 1;
      targetDelta = sign * amount;
      outcomeFlavor =
        "You stir the pot and walk away. Sometimes it hurts them, sometimes it mysteriously boosts their cred.";
    } else if (roll <= 85) {
      // 61–85: Brutal hit — 10–25% loss to target, small chance of self chip
      outcomeLabel = "Brutal Hit";
      const pctTarget = randomInt(10, 25);
      let dmgTarget = Math.floor((baseTarget * pctTarget) / 100);
      if (dmgTarget < 1) dmgTarget = 1;
      targetDelta = -dmgTarget;

      if (Math.random() < 0.3) {
        const pctSelf = randomInt(1, 5);
        let dmgSelf = Math.floor((baseAttacker * pctSelf) / 100);
        if (dmgSelf < 1) dmgSelf = 1;
        attackerDelta = -dmgSelf;
        outcomeFlavor =
          "You wreck their rep, but some of the blast radius leaks back on you.";
      } else {
        outcomeFlavor =
          "You kneecap their Social Credit and somehow avoid any obvious fingerprints.";
      }
    } else if (roll <= 95) {
      // 86–95: Mutual destruction — heavy damage to both, plus prison
      outcomeLabel = "Mutual Destruction";
      const pctTarget = randomInt(15, 30);
      let dmgTarget = Math.floor((baseTarget * pctTarget) / 100);
      if (dmgTarget < 1) dmgTarget = 1;
      targetDelta = -dmgTarget;

      const pctSelf = randomInt(5, 15);
      let dmgSelf = Math.floor((baseAttacker * pctSelf) / 100);
      if (dmgSelf < 1) dmgSelf = 1;
      attackerDelta = -dmgSelf;

      outcomeFlavor =
        "You both end up bleeding Social Credit all over the floor. Nobody learns anything.";
      prisonAddedMs = SABOTAGE_PRISON_BASE_MS;
    } else {
      // 96–100: Apocalyptic sabotage — huge target hit, tiny or zero self chip, long prison
      outcomeLabel = "Apocalyptic Sabotage";
      const pctTarget = randomInt(25, 40);
      let dmgTarget = Math.floor((baseTarget * pctTarget) / 100);
      if (dmgTarget < 1) dmgTarget = 1;
      targetDelta = -dmgTarget;

      if (Math.random() < 0.5) {
        const pctSelf = randomInt(1, 5);
        let dmgSelf = Math.floor((baseAttacker * pctSelf) / 100);
        if (dmgSelf < 1) dmgSelf = 1;
        attackerDelta = -dmgSelf;
      }

      outcomeFlavor =
        "You rewrite their legend in real time. The clan quietly files a 'this was excessive' report on you.";
      prisonAddedMs = SABOTAGE_PRISON_BASE_MS * 2;
    }

    // Apply DB changes
    let targetBefore = targetScoreBefore;
    let targetAfter = targetScoreBefore;
    let attackerBefore = attackerScoreBefore;
    let attackerAfter = attackerScoreBefore;

    if (targetDelta !== 0) {
      const res = adjustScore(
        guildId,
        attacker.id,
        target.id,
        targetDelta,
        `Sabotage [${outcomeLabel}] by ${attacker.tag}`,
      );
      targetBefore = res.previous;
      targetAfter = res.current;
    }

    if (attackerDelta !== 0) {
      const res = adjustScore(
        guildId,
        attacker.id,
        attacker.id,
        attackerDelta,
        `Sabotage backfire [${outcomeLabel}] vs ${target.tag}`,
      );
      attackerBefore = res.previous;
      attackerAfter = res.current;
    }

    // Burn cooldown on ANY sabotage attempt
    sabotageCooldown.set(key, now);

    // Optional prison lock
    let prisonNote = "";
    if (prisonAddedMs > 0) {
      const until = Date.now() + prisonAddedMs;
      const untilSec = Math.floor(until / 1000);
      sabotagePrison.set(`${guildId}:${attacker.id}`, until);
      prisonNote = `\n\n⛓ Clan Court adds a **${formatCooldown(
        prisonAddedMs,
      )}** sentence for reckless sabotage (no more sabotage until <t:${untilSec}:R>).`;
    }

    const embed = new EmbedBuilder()
      .setTitle("🧨 Social Credit Sabotage")
      .setDescription(() => {
        const lines: string[] = [];
        lines.push(`🎲 Roll: **${roll}** — **${outcomeLabel}**`);
        lines.push("");
        lines.push(`${attacker} attempts to **sabotage** ${target}.`);
        lines.push("");

        const changes: string[] = [];

        if (targetDelta !== 0) {
          const deltaStr = targetDelta > 0 ? `+${targetDelta}` : `${targetDelta}`;
          changes.push(
            `**Target change:** ${deltaStr}\n` +
              `**${target.username}**: ${targetBefore} → ${targetAfter}`,
          );
        } else {
          changes.push(
            `**${target.username}**: ${targetBefore} → ${targetAfter} (no meaningful change)`,
          );
        }

        if (attackerDelta !== 0) {
          const diff = attackerAfter - attackerBefore;
          const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;
          changes.push(
            `**${attacker.username}**: ${attackerBefore} → ${attackerAfter} (${diffStr})`,
          );
        } else {
          changes.push(
            `**${attacker.username}**: ${attackerBefore} → ${attackerAfter}`,
          );
        }

        lines.push(changes.join("\n"));
        lines.push("");
        lines.push(outcomeFlavor);
        if (prisonNote) lines.push(prisonNote);
        return lines.join("\n");
      })
      .setColor(() => {
        if (attackerDelta < 0 && targetDelta < 0) return 0x991b1b; // mutual destruction
        if (targetDelta < 0) return 0xf97316; // successful hit
        if (attackerDelta < 0) return 0xef4444; // pure self-own
        return 0x9ca3af; // fizzle/neutral
      })
      .setFooter({ text: "Chaos is a sacred
