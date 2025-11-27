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
  getRecentLogForUser,
  getSabotageStatsSince,
  getCreditActionChannel,
  setCreditActionChannel,
  createCase,
  getCaseById,
  listCases,
  setCaseVerdict,
} from "../db/socialDb.js";

type VerdictChoice =
  | "guilty"
  | "not_guilty"
  | "frivolous"
  | "mutual_mess"
  | "declined";

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

function verdictHumanLabel(v: VerdictChoice): string {
  switch (v) {
    case "guilty":
      return "Guilty";
    case "not_guilty":
      return "Not Guilty";
    case "frivolous":
      return "Frivolous Complaint";
    case "mutual_mess":
      return "Mutual Mess";
    case "declined":
      return "Declined";
  }
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

function addPrisonTime(
  map: Map<string, number>,
  key: string,
  extraMs: number,
): number {
  const now = Date.now();
  const current = map.get(key) ?? 0;
  const base = current > now ? current : now;
  const until = base + extraMs;
  map.set(key, until);
  return until;
}

async function safeSendDm(
  interaction: ChatInputCommandInteraction,
  userId: string,
  embed: EmbedBuilder,
): Promise<void> {
  try {
    const user = await interaction.client.users.fetch(userId);
    await user.send({ embeds: [embed] });
  } catch {
    // ignore DM failures
  }
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
  )
  .addSubcommand((sub) =>
    sub
      .setName("sue")
      .setDescription("File a Social Credit lawsuit against another member.")
      .addUserOption((opt) =>
        opt
          .setName("defendant")
          .setDescription("Who are you suing?")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("charge")
          .setDescription("Short description of the charge.")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("details")
          .setDescription("Longer details / lore for the case.")
          .setMaxLength(1000),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("requested_fine")
          .setDescription("Requested Social Credit fine (optional)."),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("requested_sentence_min")
          .setDescription(
            "Requested prison time in minutes (optional – locks heist/sabotage).",
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("docket")
      .setDescription(
        "View the High Court docket (judge only; filtered list of cases).",
      )
      .addStringOption((opt) =>
        opt
          .setName("status")
          .setDescription("Which cases to view")
          .addChoices(
            { name: "Open", value: "open" },
            { name: "Closed", value: "closed" },
            { name: "All", value: "all" },
          ),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("How many cases to show (1–25, default 10).")
          .setMinValue(1)
          .setMaxValue(25),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("case")
      .setDescription("High Court tools (judge only).")
      .addSubcommand((sub) =>
        sub
          .setName("info")
          .setDescription("View details of a Social Credit case.")
          .addIntegerOption((opt) =>
            opt
              .setName("case_id")
              .setDescription("The case number.")
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("verdict")
          .setDescription(
            "Issue a High Court verdict (fines / prison / decline).",
          )
          .addIntegerOption((opt) =>
            opt
              .setName("case_id")
              .setDescription("The case number.")
              .setRequired(true),
          )
          .addStringOption((opt) =>
            opt
              .setName("verdict")
              .setDescription("Type of verdict.")
              .setRequired(true)
              .addChoices(
                { name: "Guilty", value: "guilty" },
                { name: "Not guilty (no penalties)", value: "not_guilty" },
                {
                  name: "Frivolous (punish plaintiff)",
                  value: "frivolous",
                },
                {
                  name: "Mutual mess (hit both)",
                  value: "mutual_mess",
                },
                {
                  name: "Declined (case not heard)",
                  value: "declined",
                },
              ),
          )
          .addIntegerOption((opt) =>
            opt
              .setName("fine_defendant")
              .setDescription(
                "Social Credit fine for defendant (positive number).",
              ),
          )
          .addIntegerOption((opt) =>
            opt
              .setName("fine_plaintiff")
              .setDescription(
                "Social Credit fine for plaintiff (positive number).",
              ),
          )
          .addIntegerOption((opt) =>
            opt
              .setName("prison_defendant_min")
              .setDescription(
                "Prison minutes for defendant (locks heist/sabotage).",
              ),
          )
          .addIntegerOption((opt) =>
            opt
              .setName("prison_plaintiff_min")
              .setDescription(
                "Prison minutes for plaintiff (locks heist/sabotage).",
              ),
          )
          .addStringOption((opt) =>
            opt
              .setName("note")
              .setDescription("Note from the judge for the record / DM.")
              .setMaxLength(1000),
          ),
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
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(true);
  const ownerId = process.env.OWNER_ID ?? null;

  // ----- High Court: /credit case ... (judge only) -----
  if (group === "case") {
    if (!ownerId || interaction.user.id !== ownerId) {
      await interaction.reply({
        content:
          "Only the High Court judge may manage cases. This bench is reserved.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "info") {
      const caseId = interaction.options.getInteger("case_id", true);
      const c = getCaseById(guildId, caseId);

      if (!c) {
        await interaction.reply({
          content: `Case #${caseId} was not found in this server.`,
          ephemeral: true,
        });
        return;
      }

      const filedTag = `<t:${c.createdAt}:R>`;
      const closedTag =
        c.closedAt != null ? `<t:${c.closedAt}:R>` : "—";

      const statusLine =
        c.status === "open"
          ? "OPEN"
          : `CLOSED${c.verdict ? ` (${c.verdict})` : ""}`;

      const requestedParts: string[] = [];
      if (c.requestedFine != null) {
        requestedParts.push(`Fine: **${c.requestedFine}**`);
      }
      if (c.requestedSentence != null) {
        requestedParts.push(`Prison: **${c.requestedSentence}m**`);
      }
      const requested =
        requestedParts.length > 0
          ? requestedParts.join(" · ")
          : "None specified";

      const verdictParts: string[] = [];
      if (c.verdict) {
        verdictParts.push(`Verdict: **${c.verdict}**`);
      }
      if (c.judgeId) {
        verdictParts.push(`Judge: <@${c.judgeId}>`);
      }
      if (c.fineDefendant) {
        verdictParts.push(`Fine (def): **${c.fineDefendant}**`);
      }
      if (c.finePlaintiff) {
        verdictParts.push(`Fine (plt): **${c.finePlaintiff}**`);
      }
      if (c.prisonDefendant) {
        verdictParts.push(
          `Prison (def): **${c.prisonDefendant}m**`,
        );
      }
      if (c.prisonPlaintiff) {
        verdictParts.push(
          `Prison (plt): **${c.prisonPlaintiff}m**`,
        );
      }

      const embed = new EmbedBuilder()
        .setTitle(`⚖ High Court Case #${c.id}`)
        .setDescription(
          [
            `**Charge:** ${c.charge}`,
            `**Status:** ${statusLine}`,
            "",
            `**Plaintiff:** <@${c.plaintiffId}>`,
            `**Defendant:** <@${c.defendantId}>`,
            "",
            `**Filed:** ${filedTag}`,
            `**Closed:** ${closedTag}`,
          ].join("\n"),
        )
        .addFields(
          {
            name: "Requested Relief",
            value: requested,
          },
          {
            name: "Details",
            value: c.details ?? "_No additional lore provided._",
          },
          {
            name: "Verdict / Outcome",
            value:
              verdictParts.length > 0
                ? verdictParts.join("\n")
                : "_No verdict recorded yet._",
          },
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "verdict") {
      const caseId = interaction.options.getInteger("case_id", true);
      const verdict = interaction.options.getString(
        "verdict",
        true,
      ) as VerdictChoice;

      let fineDefendant =
        interaction.options.getInteger("fine_defendant") ?? 0;
      let finePlaintiff =
        interaction.options.getInteger("fine_plaintiff") ?? 0;
      let prisonDefendantMin =
        interaction.options.getInteger("prison_defendant_min") ?? 0;
      let prisonPlaintiffMin =
        interaction.options.getInteger("prison_plaintiff_min") ?? 0;
      const note =
        interaction.options.getString("note") ??
        "No additional remarks.";

      const c = getCaseById(guildId, caseId);
      if (!c) {
        await interaction.reply({
          content: `Case #${caseId} was not found in this server.`,
          ephemeral: true,
        });
        return;
      }

      if (c.status === "closed") {
        await interaction.reply({
          content: `Case #${caseId} is already closed.`,
          ephemeral: true,
        });
        return;
      }

      // Normalize some verdict behaviors
      if (verdict === "not_guilty" || verdict === "declined") {
        // Pure "no-penalty" outcomes
        fineDefendant = 0;
        finePlaintiff = 0;
        prisonDefendantMin = 0;
        prisonPlaintiffMin = 0;
      }

      const judgeId = interaction.user.id;

      const plaintiffScoreBefore = getScore(
        guildId,
        c.plaintiffId,
      );
      const defendantScoreBefore = getScore(
        guildId,
        c.defendantId,
      );
      let plaintiffScoreAfter = plaintiffScoreBefore;
      let defendantScoreAfter = defendantScoreBefore;

      // Apply Social Credit fines
      if (finePlaintiff > 0) {
        const res = adjustScore(
          guildId,
          judgeId,
          c.plaintiffId,
          -finePlaintiff,
          `High Court Case #${caseId} — Verdict: ${verdict}`,
        );
        plaintiffScoreAfter = res.current;
      }

      if (fineDefendant > 0) {
        const res = adjustScore(
          guildId,
          judgeId,
          c.defendantId,
          -fineDefendant,
          `High Court Case #${caseId} — Verdict: ${verdict}`,
        );
        defendantScoreAfter = res.current;
      }

      // Apply prison time (heist / sabotage lock)
      let plaintiffPrisonUntilSec: number | null = null;
      let defendantPrisonUntilSec: number | null = null;

      if (prisonPlaintiffMin > 0) {
        const extraMs = prisonPlaintiffMin * 60_000;
        const key = `${guildId}:${c.plaintiffId}`;
        const untilSteal = addPrisonTime(
          stealPrison,
          key,
          extraMs,
        );
        addPrisonTime(sabotagePrison, key, extraMs);
        plaintiffPrisonUntilSec = Math.floor(untilSteal / 1000);
      }

      if (prisonDefendantMin > 0) {
        const extraMs = prisonDefendantMin * 60_000;
        const key = `${guildId}:${c.defendantId}`;
        const untilSteal = addPrisonTime(
          stealPrison,
          key,
          extraMs,
        );
        addPrisonTime(sabotagePrison, key, extraMs);
        defendantPrisonUntilSec = Math.floor(untilSteal / 1000);
      }

      // Persist verdict in DB
      setCaseVerdict(
        guildId,
        caseId,
        verdict,
        judgeId,
        finePlaintiff,
        fineDefendant,
        prisonPlaintiffMin,
        prisonDefendantMin,
      );

      const vLabel = verdictHumanLabel(verdict);
      const guildName =
        interaction.guild?.name ?? "this server";

      const lines: string[] = [];
      lines.push(
        `**Case #${caseId} — ${c.charge}**`,
        `**Verdict:** ${vLabel}`,
        "",
        `**Plaintiff:** <@${c.plaintiffId}>`,
        `**Defendant:** <@${c.defendantId}>`,
        "",
      );

      if (
        finePlaintiff === 0 &&
        fineDefendant === 0 &&
        prisonPlaintiffMin === 0 &&
        prisonDefendantMin === 0
      ) {
        if (verdict === "declined") {
          lines.push(
            "_The Court declines to hear this matter. No Social Credit penalties were issued._",
          );
        } else if (verdict === "not_guilty") {
          lines.push(
            "_The Court finds no liability. No Social Credit penalties were issued._",
          );
        } else {
          lines.push(
            "_No Social Credit penalties were recorded in this verdict._",
          );
        }
      } else {
        if (finePlaintiff > 0) {
          lines.push(
            `• **Plaintiff fine:** -${finePlaintiff} Social Credit`,
          );
        }
        if (fineDefendant > 0) {
          lines.push(
            `• **Defendant fine:** -${fineDefendant} Social Credit`,
          );
        }
        if (prisonPlaintiffMin > 0) {
          const until =
            plaintiffPrisonUntilSec != null
              ? `<t:${plaintiffPrisonUntilSec}:R>`
              : "for a while";
          lines.push(
            `• **Plaintiff prison:** ${prisonPlaintiffMin} minutes (no heists/sabotage until ${until})`,
          );
        }
        if (prisonDefendantMin > 0) {
          const until =
            defendantPrisonUntilSec != null
              ? `<t:${defendantPrisonUntilSec}:R>`
              : "for a while";
          lines.push(
            `• **Defendant prison:** ${prisonDefendantMin} minutes (no heists/sabotage until ${until})`,
          );
        }

        lines.push("");
        lines.push(`**Judge's Note:** ${note}`);
      }

      const embed = new EmbedBuilder()
        .setTitle("⚖ High Court Verdict")
        .setDescription(lines.join("\n"))
        .setFooter({
          text: `High Court of Yak Yak · ${guildName}`,
        });

      await interaction.reply({ embeds: [embed] });

      // DMs only when there is a penalty
      const dmTasks: Promise<void>[] = [];

      if (fineDefendant > 0 || prisonDefendantMin > 0) {
        const fields = [];
        if (fineDefendant > 0) {
          fields.push({
            name: "Social Credit Fine",
            value: `-${fineDefendant}`,
            inline: true,
          });
        }
        if (
          prisonDefendantMin > 0 &&
          defendantPrisonUntilSec != null
        ) {
          fields.push({
            name: "Prison Sentence",
            value: `${prisonDefendantMin} minutes (no heists/sabotage until <t:${defendantPrisonUntilSec}:R>)`,
            inline: true,
          });
        }

        const dmEmbedDef = new EmbedBuilder()
          .setTitle("⚖ High Court of Yak Yak — Verdict")
          .setDescription(
            [
              "You've been summoned to the High Court for Social Credit fraud.",
              "",
              `**Case:** #${caseId}`,
              `**Role:** Defendant`,
              `**Server:** ${guildName}`,
              `**Verdict:** ${vLabel}`,
            ].join("\n"),
          )
          .addFields(...fields);

        if (note) {
          dmEmbedDef.addFields({
            name: "Judge's Note",
            value: note,
          });
        }

        dmTasks.push(
          safeSendDm(interaction, c.defendantId, dmEmbedDef),
        );
      }

      if (finePlaintiff > 0 || prisonPlaintiffMin > 0) {
        const fields = [];
        if (finePlaintiff > 0) {
          fields.push({
            name: "Social Credit Fine",
            value: `-${finePlaintiff}`,
            inline: true,
          });
        }
        if (
          prisonPlaintiffMin > 0 &&
          plaintiffPrisonUntilSec != null
        ) {
          fields.push({
            name: "Prison Sentence",
            value: `${prisonPlaintiffMin} minutes (no heists/sabotage until <t:${plaintiffPrisonUntilSec}:R>)`,
            inline: true,
          });
        }

        const dmEmbedPlt = new EmbedBuilder()
          .setTitle("⚖ High Court of Yak Yak — Verdict")
          .setDescription(
            [
              "You've been summoned to the High Court for Social Credit fraud.",
              "",
              `**Case:** #${caseId}`,
              `**Role:** Plaintiff`,
              `**Server:** ${guildName}`,
              `**Verdict:** ${vLabel}`,
            ].join("\n"),
          )
          .addFields(...fields);

        if (note) {
          dmEmbedPlt.addFields({
            name: "Judge's Note",
            value: note,
          });
        }

        dmTasks.push(
          safeSendDm(interaction, c.plaintiffId, dmEmbedPlt),
        );
      }

      if (dmTasks.length > 0) {
        await Promise.allSettled(dmTasks);
      }

      return;
    }

    // Unknown case subcommand
    await interaction.reply({
      content: "Unknown High Court operation.",
      ephemeral: true,
    });
    return;
  }

  // ----- /credit set_action_channel -----
  if (sub === "set_action_channel") {
    const channel = interaction.options.getChannel("channel", true);

    const isAdmin =
      interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild,
      ) ||
      (ownerId && interaction.user.id === ownerId);

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

  // ----- /credit sue -----
  if (sub === "sue") {
    const plaintiff = interaction.user;
    const defendant =
      interaction.options.getUser("defendant", true);

    if (defendant.bot) {
      await interaction.reply({
        content: "You can't sue a bot. They have no legal standing.",
        ephemeral: true,
      });
      return;
    }

    if (defendant.id === plaintiff.id) {
      await interaction.reply({
        content:
          "You can't sue yourself in the High Court. Touch grass and pick a new target.",
        ephemeral: true,
      });
      return;
    }

    const charge = interaction.options.getString("charge", true);
    const details =
      interaction.options.getString("details") ?? null;
    const requestedFine =
      interaction.options.getInteger("requested_fine") ?? null;
    const requestedSentence =
      interaction.options.getInteger("requested_sentence_min") ??
      null;

    const caseId = createCase(
      guildId,
      plaintiff.id,
      defendant.id,
      charge,
      details,
      requestedFine,
      requestedSentence,
    );

    const lines: string[] = [];
    lines.push(
      `**Plaintiff:** ${plaintiff}`,
      `**Defendant:** ${defendant}`,
      `**Charge:** ${charge}`,
      "",
    );

    const reqParts: string[] = [];
    if (requestedFine != null) {
      reqParts.push(`Fine: **${requestedFine}** Social Credit`);
    }
    if (requestedSentence != null) {
      reqParts.push(
        `Prison: **${requestedSentence} minutes** (heist/sabotage lock)`,
      );
    }
    lines.push(
      `**Requested Relief:** ${
        reqParts.length > 0
          ? reqParts.join(" · ")
          : "None specified"
      }`,
    );

    if (details) {
      lines.push("", `**Details:** ${details}`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`📜 High Court Civil Complaint #${caseId}`)
      .setDescription(lines.join("\n"))
      .setFooter({
        text: "Case filed. The judge will review this when they feel like it.",
      });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ----- /credit docket -----
  if (sub === "docket") {
    if (!ownerId || interaction.user.id !== ownerId) {
      await interaction.reply({
        content:
          "Only the High Court judge may view the full docket.",
        ephemeral: true,
      });
      return;
    }

    const statusInput = interaction.options.getString(
      "status",
    ) as "open" | "closed" | "all" | null;
    const status = statusInput ?? "open";
    const limit = interaction.options.getInteger("limit") ?? 10;

    const cases = listCases(guildId, status, limit);

    if (cases.length === 0) {
      await interaction.reply({
        content:
          status === "open"
            ? "The docket is clear. No open cases."
            : "No cases match that filter.",
        ephemeral: true,
      });
      return;
    }

    const lines = cases.map((c) => {
      const statusLabel =
        c.status === "open"
          ? "OPEN"
          : `CLOSED${c.verdict ? ` (${c.verdict})` : ""}`;
      const filedTag = `<t:${c.createdAt}:R>`;
      return `• **#${c.id}** — <@${c.plaintiffId}> v. <@${c.defendantId}> — ${c.charge} · *${statusLabel}* · filed ${filedTag}`;
    });

    const title =
      status === "open"
        ? "⚖ High Court Docket — Open Cases"
        : status === "closed"
          ? "⚖ High Court Docket — Closed Cases"
          : "⚖ High Court Docket — All Cases";

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(lines.join("\n"))
      .setFooter({
        text: `Showing ${cases.length} case(s)`,
      });

    await interaction.reply({ embeds: [embed], ephemeral: true });
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
    const baseAttacker = Math.max(
      Math.abs(attackerScoreBefore),
      1,
    );

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
        let dmgSelf = Math.floor(
          (baseAttacker * pctSelf) / 100,
        );
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
        let dmgSelf = Math.floor(
          (baseAttacker * pctSelf) / 100,
        );
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
      const deltaStr =
        targetDelta > 0 ? `+${targetDelta}` : `${targetDelta}`;
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
