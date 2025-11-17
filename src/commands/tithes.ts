// src/commands/tithes.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

const NATION_ID = 246232;
const NATION_URL = `https://politicsandwar.com/nation/id=${NATION_ID}`;

export const data = new SlashCommandBuilder()
  .setName("tithes")
  .setDescription("Render unto Gemstone what belongs to Gemstone.");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("Pay Your Tithes")
    .setDescription(
      `[Click here to visit the Holy Nation](${NATION_URL})\n\nPraise be.`,
    )
    .setURL(NATION_URL)
    .setColor(0xfacc15); // gold-ish

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Open Nation Page")
      .setStyle(ButtonStyle.Link)
      .setURL(NATION_URL),
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
}
