import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionsBitField,
  type GuildMember,
} from "discord.js";
import { getFunRoles } from "../db/socialDb.js";

const DEFAULT_SALUTE_GIF =
  "https://media.giphy.com/media/3oEduO2i4fkpZr7QyQ/giphy.gif";
const DEFAULT_MARAUD_GIF =
  "https://media.giphy.com/media/3o7abB06u9bNzA8lu8/giphy.gif";
const DEFAULT_CUSTOM_GIF =
  "https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Launch a ping salute, maraud, or custom barrage.")
  .addSubcommand((sub) =>
    sub
      .setName("salute")
      .setDescription("21 ping salute with a GIF.")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who should be saluted?")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("gif")
          .setDescription("Optional GIF URL for the salute"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("maraud")
      .setDescription("25 ping maraud with a GIF.")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who should be marauded?")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("gif")
          .setDescription("Optional GIF URL for the maraud"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("custom")
      .setDescription("Custom barrage of pings with a GIF.")
      .addUserOption((opt) =>
        opt
          .setName("target")
          .setDescription("Who should be pinged?")
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("count")
          .setDescription("Number of pings (1–100)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      )
      .addStringOption((opt) =>
        opt
          .setName("gif")
          .setDescription("Optional GIF URL for the barrage"),
      ),
  );

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    // No special roles configured => only admins/owner can use.
    return false;
  }

  if (member.roles.cache.some((role) => funRoles.includes(role.id))) {
    return true;
  }

  return false;
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!isFunOperator(interaction)) {
    await interaction.reply({
      content: "You do not have sufficient Social Credit to use this command.",
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand(true);
  const target = interaction.options.getUser("target", true);

  let count = 21;
  let gifUrl = DEFAULT_SALUTE_GIF;
  let label = "21 Ping Salute";

  if (sub === "maraud") {
    count = 25;
    gifUrl = DEFAULT_MARAUD_GIF;
    label = "25 Ping Maraud";
  } else if (sub === "custom") {
    const rawCount = interaction.options.getInteger("count", true);
    count = Math.max(1, Math.min(100, rawCount));
    gifUrl = DEFAULT_CUSTOM_GIF;
    label = `${count} Ping Barrage`;
  }

  const customGif = interaction.options.getString("gif");
  if (customGif) {
    gifUrl = customGif;
  }

  await interaction.reply({
    content: `Launching a **${label}** at ${target}...`,
    ephemeral: true,
  });

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    return;
  }

  // We already know it's text-based; dodge TS whining.
  const textChannel: any = channel;

  const embed = new EmbedBuilder()
    .setTitle(label)
    .setDescription(`${target} – your Social Credit is under review.`)
    .setImage(gifUrl)
    .setFooter({ text: `Requested by ${interaction.user.tag}` });

  // First hit: GIF + ping
  await textChannel.send({ content: `${target}`, embeds: [embed] });

  // Remaining pings
  for (let i = 1; i < count; i++) {
    await sleep(300);
    await textChannel.send({ content: `${target}` });
  }
}
