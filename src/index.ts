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

function pickTriggerGif(
  guildId: string,
  positive: boolean,
): string | null {
  return getRandomGif(guildId, positive ? "positive" : "negative");
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
      const gif = pickTriggerGif(message.guildId, positive);

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
        await message.channel.send({ embeds: [embed], content: gif });
      } else {
        await message.channel.send({ embeds: [embed] });
      }
    }
  } catch (err) {
    console.error("Error handling message trigger:", err);
  }
});

client.login(token);
