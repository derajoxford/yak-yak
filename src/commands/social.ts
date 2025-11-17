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
} from "../db/socialDb.js";

const POSITIVE_GIFS = [
  "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
  "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
  "https://media.giphy.com/media/10UeedrT5MIfPG/giphy.gif",
];

const NEGATIVE_GIFS = [
  "https://media.giphy.com/media/3o6Zt8zb1P4LZP4zIi/giphy.gif",
  "https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif",
  "https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

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

export const data = new SlashCommandBuilder()
  .setName("social")
  .setDescription("Manage and view Social Credit.")
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
    const gif = positive ? pick(POSITIVE_GIFS) : pick(NEGATIVE_GIFS);

    const embed = new EmbedBuilder()
      .setTitle("Social Credit Adjustment")
      .setDescription(
        `${target} has been **${
          positive ? "blessed" : "punished"
        }**.\n\nDelta: **${delta > 0 ? `+${delta}` : delta}**\nPrevious: **${previous}**\nCurrent: **${current}**`,
      )
      .setImage(gif)
      .setFooter({
        text: reason
          ? `Issued by ${interaction.user.tag} – ${reason}`
          : `Issued by ${interaction.user.tag}`,
      });

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
      return `**#${rank}** <@${row.userId}> – **${row.score}**`;
    });

    const title =
      direction === "bottom"
        ? `Social Credit Leaderboard – Bottom ${rows.length}`
        : `Social Credit Leaderboard – Top ${rows.length}`;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(lines.join("\n"));

    await interaction.reply({ embeds: [embed] });
    return;
  }
}
