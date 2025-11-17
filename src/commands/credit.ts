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
      .setFooter({ text: "Social Credit Bureau" });

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
        content: "Nice try. You can't steal from yourself.",
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

    // First, take from victim
    const victimResult = adjustScore(
      guildId,
      thief.id,
      target.id,
      -amount,
      `Stolen by ${thief.tag}`,
    );

    // Then, give to thief
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
      .setFooter({ text: "Crime always pays… until it doesn’t." });

    await interaction.reply({ embeds: [embed] });
    return;
  }
}
