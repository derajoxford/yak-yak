import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionsBitField,
  type GuildMember,
} from "discord.js";
import {
  adjustScore,
  getScore,
  getLeaderboard,
  getFunRoles,
  addGif,
  removeGif,
  listGifs,
  addTrigger,
  removeTrigger,
  getTriggers,
  getRandomGif,
  type GifKind,
} from "../db/socialDb.js";

// ---- Helpers ----

function isFunOperator(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member as GuildMember | null;
  if (!member) return false;

  if (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  ) {
    return true;
  }

  const ownerId = process.env.OWNER_ID;
  if (ownerId && interaction.user.id === ownerId) {
    return true;
  }

  const guildId = interaction.guildId;
  if (!guildId) return false;

  const funRoles = getFunRoles(guildId);
  if (funRoles.length === 0) {
    // No roles configured: only admins/owner can use it.
    return false;
  }

  if (member.roles.cache.some((role) => funRoles.includes(role.id))) {
    return true;
  }

  return false;
}

function scoreLabel(score: number): string {
  if (score >= 50) return "Model Citizen";
  if (score >= 10) return "Upstanding Member";
  if (score >= 0) return "Under Review";
  if (score >= -9) return "Questionable Influence";
  if (score >= -25) return "Public Menace";
  return "Existential Threat";
}

function pickSocialGif(
  guildId: string,
  positive: boolean,
): string | null {
  const kind: GifKind = positive ? "positive" : "negative";
  return getRandomGif(guildId, kind);
}

// ---- Command definition ----

export const data = new SlashCommandBuilder()
  .setName("social")
  .setDescription("Social Credit controls.")
  // score subcommands
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add Social Credit to a user.")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who to bless.")
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("amount")
          .setDescription("Amount to add (default 1)")
          .setMinValue(1),
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Why are we blessing them?")
          .setMaxLength(200),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove Social Credit from a user.")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who to punish.")
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("amount")
          .setDescription("Amount to remove (default 1)")
          .setMinValue(1),
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Why are we punishing them?")
          .setMaxLength(200),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("Show a user's Social Credit.")
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
  // gif subcommand group
  .addSubcommandGroup((group) =>
    group
      .setName("gif")
      .setDescription("Manage Social Credit GIF pools.")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a GIF to the positive/negative pool.")
          .addStringOption((opt) =>
            opt
              .setName("kind")
              .setDescription("Positive or negative")
              .setRequired(true)
              .addChoices(
                { name: "Positive", value: "positive" },
                { name: "Negative", value: "negative" },
              ),
          )
          .addStringOption((opt) =>
            opt
              .setName("url")
              .setDescription("GIF URL (optional if you upload a file)"),
          )
          .addAttachmentOption((opt) =>
            opt
              .setName("file")
              .setDescription("Upload a GIF instead of providing a URL"),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("List GIFs in the pool.")
          .addStringOption((opt) =>
            opt
              .setName("kind")
              .setDescription("Filter by kind")
              .addChoices(
                { name: "Positive", value: "positive" },
                { name: "Negative", value: "negative" },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Remove a GIF from the pool.")
          .addIntegerOption((opt) =>
            opt
              .setName("id")
              .setDescription("GIF ID (from /social gif list)")
              .setRequired(true),
          ),
      ),
  )
  // triggers subcommand group
  .addSubcommandGroup((group) =>
    group
      .setName("triggers")
      .setDescription("Manage keyword-based Social Credit triggers.")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a keyword/phrase trigger.")
          .addStringOption((opt) =>
            opt
              .setName("phrase")
              .setDescription("Phrase to match in messages.")
              .setRequired(true),
          )
          .addIntegerOption((opt) =>
            opt
              .setName("delta")
              .setDescription("Social Credit change (positive or negative).")
              .setRequired(true)
              .setMinValue(-100)
              .setMaxValue(100),
          )
          .addBooleanOption((opt) =>
            opt
              .setName("case_sensitive")
              .setDescription("Case-sensitive match? Default: false."),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("List all triggers."),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Remove a trigger by ID.")
          .addIntegerOption((opt) =>
            opt
              .setName("id")
              .setDescription("Trigger ID (from /social triggers list)")
              .setRequired(true),
          ),
      ),
  );

// ---- Handler ----

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

  // ----- Score subcommands (no group) -----
  if (!group) {
    if (sub === "add" || sub === "remove") {
      if (!isFunOperator(interaction)) {
        await interaction.reply({
          content:
            "You do not have sufficient authority to modify Social Credit.",
          ephemeral: true,
        });
        return;
      }

      const target = interaction.options.getUser("target", true);
      const amount = interaction.options.getInteger("amount") ?? 1;
      const reason = interaction.options.getString("reason");
      const delta = sub === "add" ? amount : -amount;

      const { previous, current } = adjustScore(
        guildId,
        interaction.user.id,
        target.id,
        delta,
        reason ?? null,
      );

      const positive = delta > 0;
      const title = positive
        ? "Social Credit Awarded"
        : "Social Credit Deducted";
      const gif = pickSocialGif(guildId, positive);

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(
          `${target} has been **${
            positive ? "blessed" : "punished"
          }**.\n\nDelta: **${delta > 0 ? `+${delta}` : delta}**\nPrevious: **${previous}**\nCurrent: **${current}**`,
        )
        .setFooter({
          text: reason
            ? `Issued by ${interaction.user.tag} – ${reason}`
            : `Issued by ${interaction.user.tag}`,
        });

      if (gif) {
        embed.setImage(gif);
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

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
        direction === "bottom" ? 0xff5555 : 0x55ff99; // red-ish for bottom, green-ish for top

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(lines.join("\n"))
        .setColor(color)
        .setFooter({ text: "Social Credit Bureau" });

      await interaction.reply({ embeds: [embed] });
      return;
    }
  }

  // ----- GIF subcommands -----
  if (group === "gif") {
    if (!isFunOperator(interaction)) {
      await interaction.reply({
        content:
          "You do not have sufficient authority to modify GIF pools.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "add") {
      const kind = interaction.options.getString("kind", true) as GifKind;
      const urlOpt = interaction.options.getString("url");
      const file = interaction.options.getAttachment("file");

      const url = urlOpt ?? file?.url ?? null;
      if (!url) {
        await interaction.reply({
          content:
            "You must provide either a GIF URL or upload a GIF file.",
          ephemeral: true,
        });
        return;
      }

      const id = addGif(guildId, kind, url);
      await interaction.reply({
        content: `✅ Added GIF #${id} to **${kind}** pool.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "list") {
      const kindOpt = interaction.options.getString("kind") as
        | GifKind
        | null;
      const rows = listGifs(guildId, kindOpt ?? undefined);

      if (rows.length === 0) {
        await interaction.reply({
          content: "No GIFs configured yet.",
          ephemeral: true,
        });
        return;
      }

      const lines = rows.map(
        (r) => `#${r.id} [${r.kind}] ${r.url}`,
      );

      await interaction.reply({
        content: "GIF pool:\n" + lines.join("\n"),
        ephemeral: true,
      });
      return;
    }

    if (sub === "remove") {
      const id = interaction.options.getInteger("id", true);
      const ok = removeGif(guildId, id);
      if (!ok) {
        await interaction.reply({
          content: `No GIF found with ID #${id}.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `✅ Removed GIF #${id}.`,
        ephemeral: true,
      });
      return;
    }
  }

  // ----- Trigger subcommands -----
  if (group === "triggers") {
    if (!isFunOperator(interaction)) {
      await interaction.reply({
        content:
          "You do not have sufficient authority to manage triggers.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "add") {
      const phrase = interaction.options.getString("phrase", true);
      const delta = interaction.options.getInteger("delta", true);
      const caseSensitive =
        interaction.options.getBoolean("case_sensitive") ?? false;

      const id = addTrigger(guildId, phrase, delta, caseSensitive);
      await interaction.reply({
        content: `✅ Added trigger #${id}: "${phrase}" → ${delta > 0 ? "+" : ""}${delta} (caseSensitive=${caseSensitive})`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "list") {
      const rows = getTriggers(guildId);
      if (rows.length === 0) {
        await interaction.reply({
          content: "No triggers configured yet.",
          ephemeral: true,
        });
        return;
      }

      const lines = rows.map((r) => {
        const cs = r.caseSensitive ? "CS" : "CI";
        const deltaStr = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
        return `#${r.id} "${r.phrase}" → ${deltaStr} (${cs})`;
      });

      await interaction.reply({
        content: "Triggers:\n" + lines.join("\n"),
        ephemeral: true,
      });
      return;
    }

    if (sub === "remove") {
      const id = interaction.options.getInteger("id", true);
      const ok = removeTrigger(guildId, id);
      if (!ok) {
        await interaction.reply({
          content: `No trigger found with ID #${id}.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `✅ Removed trigger #${id}.`,
        ephemeral: true,
      });
      return;
    }
  }
}
