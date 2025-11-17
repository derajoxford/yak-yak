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

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isLikelyImageUrl(url: string): boolean {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  const lowered = url.toLowerCase();
  if (
    lowered.endsWith(".gif") ||
    lowered.endsWith(".png") ||
    lowered.endsWith(".jpg") ||
    lowered.endsWith(".jpeg") ||
    lowered.endsWith(".webp")
  ) {
    return true;
  }
  if (
    lowered.includes("media.giphy.com") ||
    lowered.includes("media.tenor.com") ||
    lowered.includes("cdn.discordapp.com")
  ) {
    return true;
  }
  return false;
}

// Fallback gifs if the pool is empty or broken
const FALLBACK_POSITIVE_GIFS = [
  "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
  "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
  "https://media.giphy.com/media/10UeedrT5MIfPG/giphy.gif",
];

const FALLBACK_NEGATIVE_GIFS = [
  "https://media.giphy.com/media/3o6Zt8zb1P4LZP4zIi/giphy.gif",
  "https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif",
  "https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif",
];

function pickSocialGif(
  guildId: string,
  positive: boolean,
): string | null {
  const kind: GifKind = positive ? "positive" : "negative";
  const fromPool = getRandomGif(guildId, kind);
  if (fromPool && isLikelyImageUrl(fromPool)) return fromPool;

  const pool = positive ? FALLBACK_POSITIVE_GIFS : FALLBACK_NEGATIVE_GIFS;
  return pool.length ? pick(pool) : null;
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
              .setDescription("GIF URL")
              .setRequired(true),
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
