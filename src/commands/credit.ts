// src/commands/credit.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from "discord.js";
import * as DJS from "discord.js";
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

// Try to grab modal-related builders dynamically (to avoid TS import errors)
const ModalBuilder: any = (DJS as any).ModalBuilder;
const TextInputBuilder: any = (DJS as any).TextInputBuilder;
const TextInputStyle: any = (DJS as any).TextInputStyle;

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
const SABOTAGE_COOLDOWN_MS: number = Number(
  process.env.CREDIT_SABOTAGE_COOLDOWN_MS ?? "300000",
);
// key: `${guildId}:${userId}` -> last sabotage timestamp
const sabotageCooldown = new Map<string, number>();

// Per-user steal cooldown (ms). Default 5 minutes.
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

// ---- High Court judge helper ----

function isJudge(
  guildId: string,
  userId: string,
  memberPerms: any,
): boolean {
  const judgeId = process.env.SOCIAL_JUDGE_ID;
  if (judgeId && userId === judgeId) return true;

  const ownerId = process.env.OWNER_ID;
  if (ownerId && userId === ownerId) return true;

  const hasManageGuild =
    memberPerms != null &&
    typeof memberPerms === "object" &&
    "has" in memberPerms &&
    (memberPerms as any).has?.(PermissionFlagsBits.ManageGuild);

  return Boolean(hasManageGuild);
}

// Simple incrementing lawsuit case ID (reset on restart, which is fine)
let nextCaseId = 1;

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
  )
  .addSubcommand((sub) =>
    sub
      .setName("sue")
      .setDescription(
        "File a Social Credit lawsuit (opens a High Court filing form).",
      )
      .addUserOption((opt) =>
        opt
          .setName("defendant")
          .setDescription("Who are you suing?")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("court")
      .setDescription("High Court actions (judge only).")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who are you ruling on?")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("action")
          .setDescription("Type of ruling")
          .setRequired(true)
          .addChoices(
            { name: "Fine (deduct points)", value: "fine" },
            { name: "Sentence (timeout from heist/sabotage)", value: "sentence" },
            { name: "Pardon (clear timeouts)", value: "pardon" },
          ),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("amount")
          .setDescription("Fine amount (for action = fine).")
          .setRequired(false),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("minutes")
          .setDescription("Sentence length in minutes (for action = sentence).")
          .setRequired(false),
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Reason or note for the ruling.")
          .setRequired(false),
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

  // ----- /credit court (judge-only) -----
  if (sub === "court") {
    const target = interaction.options.getUser("target", true);
    const action = interaction.options.getString("action", true);
    const amount = interaction.options.getInteger("amount");
    const minutes = interaction.options.getInteger("minutes");
    const reason =
      interaction.options.getString("reason") ??
      "High Court ruling (no further details)";

    const memberPerms = interaction.memberPermissions ?? null;
    if (!isJudge(guildId, interaction.user.id, memberPerms)) {
      await interaction.reply({
        content:
          "Only the appointed High Court Judge may issue rulings. (Set SOCIAL_JUDGE_ID or use Manage Server.)",
        ephemeral: true,
      });
      return;
    }

    if (target.bot) {
      await interaction.reply({
        content: "The High Court does not recognize bots as valid defendants.",
        ephemeral: true,
      });
      return;
    }

    const judge = interaction.user;
    const nowSec = Math.floor(Date.now() / 1000);

    if (action === "fine") {
      const amt = amount ?? 0;
      if (amt <= 0) {
        await interaction.reply({
          content: "You must specify a positive `amount` for a fine.",
          ephemeral: true,
        });
        return;
      }

      const res = adjustScore(
        guildId,
        judge.id,
        target.id,
        -amt,
        `High Court fine: ${reason}`,
      );

      const embed = new EmbedBuilder()
        .setTitle("⚖️ High Court Ruling — Fine Issued")
        .setDescription(
          `${target} has been fined **${amt}** Social Credit.\n\n` +
            `**Reason:** ${reason}\n` +
            `**Balance:** ${res.previous} → ${res.current}`,
        )
        .setFooter({
          text: `Ruling by ${judge.tag} • ${nowSec}`,
        });

      await interaction.reply({ embeds: [embed] });

      // DM the target
      try {
        const dm = new EmbedBuilder()
          .setTitle("⚖️ High Court Notice — Fine")
          .setDescription(
            `You have been fined **${amt}** Social Credit by the High Court.\n\n` +
              `**Reason:** ${reason}\n` +
              `**Balance:** ${res.previous} → ${res.current}`,
          )
          .setFooter({
            text: `Ruling by ${judge.tag}`,
          });
        await target.send({ embeds: [dm] });
      } catch {
        // ignore DM failures
      }

      return;
    }

    if (action === "sentence") {
      const mins = minutes ?? 0;
      if (mins <= 0) {
        await interaction.reply({
          content:
            "You must specify a positive `minutes` value for a sentence.",
          ephemeral: true,
        });
        return;
      }

      const ms = mins * 60_000;
      const until = Date.now() + ms;
      const key = `${guildId}:${target.id}`;

      stealPrison.set(key, until);
      sabotagePrison.set(key, until);

      const untilSec = Math.floor(until / 1000);

      const embed = new EmbedBuilder()
        .setTitle("⚖️ High Court Ruling — Sentence Imposed")
        .setDescription(
          `${target} has been sentenced to **${mins} minutes** of Social Credit prison.\n\n` +
            `During this time, they may not use **/credit steal** or **/credit sabotage**.\n\n` +
            `**Reason:** ${reason}\n` +
            `Sentence ends <t:${untilSec}:R>`,
        )
        .setFooter({
          text: `Ruling by ${judge.tag} • ${nowSec}`,
        });

      await interaction.reply({ embeds: [embed] });

      // DM the target
      try {
        const dm = new EmbedBuilder()
          .setTitle("⚖️ High Court Notice — Sentence")
          .setDescription(
            `You have been sentenced to **${mins} minutes** of Social Credit prison.\n\n` +
              `You cannot use **/credit steal** or **/credit sabotage** until <t:${untilSec}:R>.\n\n` +
              `**Reason:** ${reason}`,
          )
          .setFooter({
            text: `Ruling by ${judge.tag}`,
          });
        await target.send({ embeds: [dm] });
      } catch {
        // ignore DM failures
      }

      return;
    }

    if (action === "pardon") {
      const key = `${guildId}:${target.id}`;
      stealPrison.delete(key);
      sabotagePrison.delete(key);

      const embed = new EmbedBuilder()
        .setTitle("⚖️ High Court Ruling — Pardon Granted")
        .setDescription(
          `${target} has been **fully pardoned**.\n\n` +
            `Any Social Credit prison sentences on **steal** or **sabotage** are now cleared.\n\n` +
            `**Note:** ${reason}`,
        )
        .setFooter({
          text: `Ruling by ${judge.tag} • ${Math.floor(Date.now() / 1000)}`,
        });

      await interaction.reply({ embeds: [embed] });

      // DM the target
      try {
        const dm = new EmbedBuilder()
          .setTitle("⚖️ High Court Notice — Pardon")
          .setDescription(
            `The High Court has granted you a **full pardon**.\n\n` +
              `Any existing Social Credit prison time is now cleared.\n\n` +
              `**Note:** ${reason}`,
          )
          .setFooter({
            text: `Ruling by ${judge.tag}`,
          });
        await target.send({ embeds: [dm] });
      } catch {
        // ignore
      }

      return;
    }

    await interaction.reply({
      content: "Unknown High Court action.",
      ephemeral: true,
    });
    return;
  }

  // ----- /credit sue (now uses a modal, if available) -----
  if (sub === "sue") {
    const plaintiff = interaction.user;
    const defendant = interaction.options.getUser("defendant", true);

    if (defendant.bot) {
      await interaction.reply({
        content: "You cannot sue a bot. The High Court does not care.",
        ephemeral: true,
      });
      return;
    }

    if (defendant.id === plaintiff.id) {
      await interaction.reply({
        content: "You cannot sue yourself. Seek counsel, not chaos.",
        ephemeral: true,
      });
      return;
    }

    // Safety: if this discord.js build has no modals, bail gracefully
    if (!ModalBuilder || !TextInputBuilder || !TextInputStyle) {
      await interaction.reply({
        content:
          "This Yak Yak build does not support High Court filing forms yet. Ping Jared to bump discord.js for modals.",
        ephemeral: true,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        `creditSue|${guildId}|${plaintiff.id}|${defendant.id}`,
      )
      .setTitle("High Court Filing — Social Credit Case");

    const claimInput = new TextInputBuilder()
      .setCustomId("claim")
      .setLabel("Statement of Claim")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1024);

    const reliefInput = new TextInputBuilder()
      .setCustomId("relief")
      .setLabel("Requested Relief (fine, sentence, etc.)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(256);

    const damagesInput = new TextInputBuilder()
      .setCustomId("damages")
      .setLabel("Requested Damages (Social Credit)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("e.g., 250 — leave blank if none");

    const sentenceInput = new TextInputBuilder()
      .setCustomId("sentence")
      .setLabel("Requested Sentence (minutes)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("e.g., 15 — leave blank if none");

    modal.addComponents(
      new ActionRowBuilder<any>().addComponents(claimInput),
      new ActionRowBuilder<any>().addComponents(reliefInput),
      new ActionRowBuilder<any>().addComponents(damagesInput),
      new ActionRowBuilder<any>().addComponents(sentenceInput),
    );

    await interaction.showModal(modal);
    return;
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

    const stealLines: string[] = [];
    stealLines.push(`🎲 Roll: **${roll}** — **${outcomeLabel}**`);
    stealLines.push("");
    if (victimDelta < 0 && thiefDelta > 0) {
      const amount = Math.abs(victimDelta);
      stealLines.push(
        `${thief} stole **${amount}** Social Credit from ${target}.`,
      );
      stealLines.push("");
      stealLines.push(
        `**${target.username}**: ${victimBefore} → ${victimAfter}`,
      );
      stealLines.push(
        `**${thief.username}**: ${thiefBefore} → ${thiefAfter}`,
      );
    } else if (thiefDelta < 0 && victimDelta === 0) {
      const fine = Math.abs(thiefDelta);
      stealLines.push(
        `${thief} got caught trying to rob ${target} and was fined **${fine}** Social Credit.`,
      );
      stealLines.push("");
      stealLines.push(
        `**${thief.username}**: ${thiefBefore} → ${thiefAfter}`,
      );
    } else {
      // Pure fizzle (no DB change)
      stealLines.push(
        `${thief} attempts a heist on ${target}… and absolutely nothing happens.`,
      );
      stealLines.push("");
      stealLines.push(
        `**${target.username}**: ${victimScoreBefore} → ${victimScoreBefore}`,
      );
      stealLines.push(
        `**${thief.username}**: ${thiefScoreBefore} → ${thiefScoreBefore}`,
      );
    }
    stealLines.push("");
    stealLines.push(outcomeFlavor);
    if (prisonNote) stealLines.push(prisonNote);

    const stealDesc = stealLines.join("\n");

    const stealColor =
      thiefDelta < 0
        ? 0xff5555 // big L
        : victimDelta < 0
          ? 0xffc857 // successful steal
          : 0x9ca3af; // nothingburger

    const stealEmbed = new EmbedBuilder()
      .setTitle("🕵️ Social Credit Heist")
      .setDescription(stealDesc)
      .setColor(stealColor)
      .setFooter({ text: "Crime always pays… until it doesn’t." });

    // Heist gif: prefer negative (victim pain), fallback positive
    const heistGif =
      getRandomGif(guildId, "negative") ??
      getRandomGif(guildId, "positive");
    if (heistGif) {
      stealEmbed.setImage(heistGif);
    }

    await interaction.reply({ embeds: [stealEmbed] });
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

    const sabLines: string[] = [];
    sabLines.push(`🎲 Roll: **${roll}** — **${outcomeLabel}**`);
    sabLines.push("");
    sabLines.push(`${attacker} attempts to **sabotage** ${target}.`);
    sabLines.push("");

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

    sabLines.push(changes.join("\n"));
    sabLines.push("");
    sabLines.push(outcomeFlavor);
    if (prisonNote) sabLines.push(prisonNote);

    const sabDesc = sabLines.join("\n");

    let sabColor: number;
    if (attackerDelta < 0 && targetDelta < 0) sabColor = 0x991b1b; // mutual destruction
    else if (targetDelta < 0) sabColor = 0xf97316; // successful hit
    else if (attackerDelta < 0) sabColor = 0xef4444; // pure self-own
    else sabColor = 0x9ca3af; // fizzle/neutral

    const sabEmbed = new EmbedBuilder()
      .setTitle("🧨 Social Credit Sabotage")
      .setDescription(sabDesc)
      .setColor(sabColor)
      .setFooter({ text: "Chaos is a sacred ritual." });

    const sabotageGif =
      getRandomGif(guildId, "sabotage") ??
      getRandomGif(guildId, "negative") ??
      getRandomGif(guildId, "positive");
    if (sabotageGif) {
      sabEmbed.setImage(sabotageGif);
    }

    await interaction.reply({ embeds: [sabEmbed] });
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
          (target as any).tag ?? target.username
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

// ----- Modal handler for /credit sue -----

export async function handleCreditSueModal(interaction: any): Promise<void> {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith("creditSue|")) return;

  const parts = customId.split("|");
  // creditSue|guildId|plaintiffId|defendantId
  if (parts.length < 4) {
    await interaction.reply({
      content: "Malformed High Court filing.",
      ephemeral: true,
    });
    return;
  }

  const [, guildId, plaintiffId, defendantId] = parts;

  if (!interaction.guildId || interaction.guildId !== guildId) {
    await interaction.reply({
      content: "This High Court filing no longer matches this server.",
      ephemeral: true,
    });
    return;
  }

  const claimRaw = interaction.fields.getTextInputValue("claim") ?? "";
  const reliefRaw =
    interaction.fields.getTextInputValue("relief") ?? "";
  const damagesRaw =
    interaction.fields.getTextInputValue("damages") ?? "";
  const sentenceRaw =
    interaction.fields.getTextInputValue("sentence") ?? "";

  const claim = claimRaw.trim();
  const relief = reliefRaw.trim();
  const damages = damagesRaw.trim();
  const sentence = sentenceRaw.trim();

  if (!claim) {
    await interaction.reply({
      content: "Your claim cannot be empty.",
      ephemeral: true,
    });
    return;
  }

  const client = interaction.client;

  const plaintiff =
    (await client.users.fetch(plaintiffId).catch(() => null)) ?? null;
  const defendant =
    (await client.users.fetch(defendantId).catch(() => null)) ?? null;

  const plaintiffMention = plaintiff
    ? `${plaintiff}`
    : `<@${plaintiffId}>`;
  const defendantMention = defendant
    ? `${defendant}`
    : `<@${defendantId}>`;

  const caseId = nextCaseId++;
  const nowSec = Math.floor(Date.now() / 1000);

  const claimText =
    claim.length > 1024 ? claim.slice(0, 1021) + "…" : claim;
  const reliefText =
    (relief || "Not specified.").length > 1024
      ? (relief || "Not specified.").slice(0, 1021) + "…"
      : relief || "Not specified.";

  const damagesText = damages || "Not specified.";
  const sentenceText = sentence || "Not specified.";

  const embed = new EmbedBuilder()
    .setTitle(`📜 New Social Credit Lawsuit #${caseId}`)
    .setDescription(
      `**Plaintiff:** ${plaintiffMention}\n` +
        `**Defendant:** ${defendantMention}\n\n` +
        `A new matter has been filed before the **High Court of Yakuza**.`,
    )
    .addFields(
      {
        name: "Claim",
        value: claimText,
      },
      {
        name: "Requested Relief",
        value: reliefText,
      },
      {
        name: "Requested Damages",
        value: damagesText,
      },
      {
        name: "Requested Sentence",
        value: sentenceText,
      },
      {
        name: "Status",
        value:
          "🟡 Pending review by the High Court. Only the Judge may rule.",
      },
    )
    .setFooter({
      text: `Filed by ${plaintiff?.tag ?? plaintiffId} • Case ${caseId}`,
    })
    .setTimestamp(nowSec * 1000);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `creditCourt|grant|${guildId}|${plaintiffId}|${defendantId}|${caseId}`,
      )
      .setLabel("Grant Case")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(
        `creditCourt|deny|${guildId}|${plaintiffId}|${defendantId}|${caseId}`,
      )
      .setLabel("Deny Case")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(
        `creditCourt|dismiss|${guildId}|${plaintiffId}|${defendantId}|${caseId}`,
      )
      .setLabel("Dismiss Case")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        `creditCourt|trial|${guildId}|${plaintiffId}|${defendantId}|${caseId}`,
      )
      .setLabel("Set for Trial")
      .setStyle(ButtonStyle.Primary),
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
}

// ----- Button handler for High Court lawsuit embeds -----

export async function handleCreditCourtButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith("creditCourt|")) return;

  const parts = customId.split("|");
  // creditCourt|action|guildId|plaintiffId|defendantId|caseId
  if (parts.length < 6) {
    await interaction.reply({
      content: "Malformed High Court button.",
      ephemeral: true,
    });
    return;
  }

  const [, action, guildId, plaintiffId, defendantId, caseId] = parts;
  const judge = interaction.user;

  const memberPerms = (interaction.member as any)?.permissions ?? null;
  if (!isJudge(guildId, judge.id, memberPerms)) {
    await interaction.reply({
      content:
        "Only the appointed High Court Judge may rule on lawsuits.",
      ephemeral: true,
    });
    return;
  }

  const plaintiffMention = `<@${plaintiffId}>`;
  const defendantMention = `<@${defendantId}>`;
  const ts = Math.floor(Date.now() / 1000);

  let decision: string;
  let decisionEmoji: string;

  if (action === "grant") {
    decisionEmoji = "🟢";
    decision =
      `${decisionEmoji} **Case Granted.**\n` +
      `The lawsuit is accepted onto the High Court docket. Judge may now use **/credit court** to issue fines or sentences.\n` +
      `Ruling by ${judge} at <t:${ts}:R>.`;
  } else if (action === "deny") {
    decisionEmoji = "🔴";
    decision =
      `${decisionEmoji} **Case Denied.**\n` +
      `The claims are rejected on their merits. No relief will be granted.\n` +
      `Ruling by ${judge} at <t:${ts}:R>.`;
  } else if (action === "dismiss") {
    decisionEmoji = "⚪";
    decision =
      `${decisionEmoji} **Case Dismissed.**\n` +
      `The matter is dismissed without relief. The parties are returned to the status quo ante.\n` +
      `Ruling by ${judge} at <t:${ts}:R>.`;
  } else if (action === "trial") {
    decisionEmoji = "🟡";
    decision =
      `${decisionEmoji} **Case Set for Trial.**\n` +
      `The High Court sets this matter for formal hearing. Damages and sentences, if any, will be determined after proceedings.\n` +
      `Ruling by ${judge} at <t:${ts}:R>.`;
  } else {
    // legacy "decline" or unknown
    decisionEmoji = "⚪";
    decision =
      `${decisionEmoji} **Case Declined.**\n` +
      `The High Court declines to hear this matter.\n` +
      `Ruling by ${judge} at <t:${ts}:R>.`;
  }

  const original = interaction.message.embeds[0];
  const claimText =
    original?.fields?.find((f) => f.name === "Claim")?.value ??
    "Unknown / missing.";
  const reliefText =
    original?.fields?.find((f) => f.name === "Requested Relief")
      ?.value ?? "Unknown / missing.";
  const damagesText =
    original?.fields?.find((f) => f.name === "Requested Damages")
      ?.value ?? "Not specified.";
  const sentenceText =
    original?.fields?.find((f) => f.name === "Requested Sentence")
      ?.value ?? "Not specified.";

  const verdictEmbed = new EmbedBuilder()
    .setTitle(
      original?.title ??
        `⚖️ Social Credit Case ${caseId}`,
    )
    .setDescription(
      `**Plaintiff:** ${plaintiffMention}\n` +
        `**Defendant:** ${defendantMention}\n\n` +
        `A ruling has been issued by the High Court of Yakuza.`,
    )
    .addFields(
      {
        name: "Claim",
        value: claimText,
      },
      {
        name: "Requested Relief",
        value: reliefText,
      },
      {
        name: "Requested Damages",
        value: damagesText,
      },
      {
        name: "Requested Sentence",
        value: sentenceText,
      },
      {
        name: "Decision",
        value: decision,
      },
    )
    .setFooter({
      text: `Ruled by ${judge.tag} • Case ${caseId}`,
    })
    .setTimestamp();

  // Update the original message: new embed, remove buttons
  await interaction.update({
    embeds: [verdictEmbed],
    components: [],
  });

  // DM plaintiff & defendant so it feels official
  const client = interaction.client;

  const dmEmbed = new EmbedBuilder()
    .setTitle(`⚖️ High Court Ruling — Case ${caseId}`)
    .setDescription(
      `A ruling has been issued in your Social Credit case between ${plaintiffMention} and ${defendantMention}.\n\n${decision}`,
    )
    .addFields(
      { name: "Claim", value: claimText },
      { name: "Requested Relief", value: reliefText },
      { name: "Requested Damages", value: damagesText },
      { name: "Requested Sentence", value: sentenceText },
    )
    .setFooter({ text: `Ruled by ${judge.tag}` })
    .setTimestamp();

  try {
    const pUser = await client.users.fetch(plaintiffId);
    await pUser.send({ embeds: [dmEmbed] });
  } catch {
    // ignore DM failure
  }

  try {
    const dUser = await client.users.fetch(defendantId);
    await dUser.send({ embeds: [dmEmbed] });
  } catch {
    // ignore DM failure
  }
}
