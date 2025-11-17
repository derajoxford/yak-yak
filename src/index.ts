import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
} from "discord.js";
import { commandMap } from "./commands/index.js";
import {
  getTriggers,
  adjustScore,
  getRandomGif,
} from "./db/socialDb.js";

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.SOCIAL_GUILD_ID;

if (!token) {
  throw new Error("DISCORD_TOKEN is not set");
}

if (!guildId) {
  console.warn(
    "[warn] SOCIAL_GUILD_ID is not set; Yak Yak will respond in all guilds it’s in.",
  );
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Fallback gifs for triggers if pool is empty
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

function pickTriggerGif(
  gId: string,
  positive: boolean,
): string | null {
  const fromPool = getRandomGif(
    gId,
    positive ? "positive" : "negative",
  );
  if (fromPool) return fromPool;

  const pool = positive ? FALLBACK_POSITIVE_GIFS : FALLBACK_NEGATIVE_GIFS;
  return pool.length ? pick(pool) : null;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Yak Yak ready as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (guildId && interaction.guildId && interaction.guildId !== guildId) {
    return;
  }

  const command = commandMap.get(interaction.commandName);
  if (!command) {
    console.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error("Error handling command:", interaction.commandName, err);
    const replyPayload = {
      content: "Something went wrong running that command.",
      ephemeral: true as const,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(replyPayload).catch(() => {});
    } else {
      await interaction.reply(replyPayload).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guildId) return;
    if (guildId && message.guildId !== guildId) return;
    if (message.author.bot) return;

    const content = message.content;
    if (!content) return;

    const triggers = getTriggers(message.guildId);
    if (triggers.length === 0) return;

    const lower = content.toLowerCase();

    for (const trig of triggers) {
      const haystack = trig.caseSensitive ? content : lower;
      const needle = trig.caseSensitive
        ? trig.phrase
        : trig.phrase.toLowerCase();

      if (!haystack.includes(needle)) continue;
      if (trig.delta === 0) continue;

      const { previous, current } = adjustScore(
        message.guildId,
        null,
        message.author.id,
        trig.delta,
        trig.phrase,
      );

      const positive = trig.delta > 0;
      const gif = pickTriggerGif(message.guildId, positive) ?? undefined;

      const embed = new EmbedBuilder()
        .setTitle(
          positive ? "Social Credit Awarded" : "Social Credit Deducted",
        )
        .setDescription(
          `${message.author} triggered **"${trig.phrase}"**.\nDelta: **${
            trig.delta > 0 ? `+${trig.delta}` : trig.delta
          }**\nPrevious: **${previous}**\nCurrent: **${current}**`,
        )
        .setFooter({ text: "Automated Social Credit trigger" });

      if (gif) {
        embed.setImage(gif);
      }

      await message.channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error("Error handling message trigger:", err);
  }
});

client.login(token);
