// src/index.ts
import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  type Message,
} from "discord.js";
import { commandMap } from "./commands/index.js";
import { handleMusicButton } from "./commands/music.js";
import { initShoukaku } from "./music/shoukaku.js";
import {
  getTriggers,
  adjustScore,
  getRandomGif,
  getTodayActivityTotal,
} from "./db/socialDb.js";
import { installAfterdarkKeywordListener } from "./nsfw_keywords.js";

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.SOCIAL_GUILD_ID;

if (!token) throw new Error("DISCORD_TOKEN is not set");

if (!guildId) {
  console.warn(
    "[warn] SOCIAL_GUILD_ID is not set; Yak Yak will respond in all guilds it’s in.",
  );
}

const triggerCooldownMs: number = Number(
  process.env.SOCIAL_TRIGGER_COOLDOWN_MS ?? "60000",
);

const triggerCooldownMap = new Map<string, number>();

function pickTriggerGif(guild: string, positive: boolean): string | null {
  return getRandomGif(guild, positive ? "positive" : "negative");
}

// ---- Activity & reaction config ----
const ACTIVITY_COOLDOWN_MS: number = Number(
  process.env.SOCIAL_ACTIVITY_COOLDOWN_MS ?? "600000",
);
const ACTIVITY_DAILY_CAP: number = Number(
  process.env.SOCIAL_ACTIVITY_DAILY_CAP ?? "250",
);
const ACTIVITY_MIN_REWARD = 1;
const ACTIVITY_MAX_REWARD = 5;

const REACTION_MIN_DISTINCT: number = Number(
  process.env.SOCIAL_REACTION_MIN_DISTINCT ?? "3",
);
const REACTION_BONUS_MIN: number = Number(
  process.env.SOCIAL_REACTION_BONUS_MIN ?? "5",
);
const REACTION_BONUS_MAX: number = Number(
  process.env.SOCIAL_REACTION_BONUS_MAX ?? "20",
);

const lastActivityAward = new Map<string, number>();
const reactionTracker = new Map<
  string,
  { users: Set<string>; rewarded: boolean }
>();

function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function maybeAwardActivity(message: Message): void {
  if (!message.guildId) return;
  const gId = message.guildId;
  const userId = message.author.id;

  const content = message.content ?? "";
  const trimmed = content.trim();

  if (!trimmed && message.attachments.size === 0) return;
  if (trimmed.length < 15 && message.attachments.size === 0) return;
  if (trimmed.startsWith("/") || trimmed.startsWith("!")) return;

  const key = `${gId}:${userId}`;
  const now = Date.now();
  const last = lastActivityAward.get(key) ?? 0;

  if (now - last < ACTIVITY_COOLDOWN_MS) return;

  const todayTotal = getTodayActivityTotal(gId, userId);
  if (todayTotal >= ACTIVITY_DAILY_CAP) return;

  const remaining = ACTIVITY_DAILY_CAP - todayTotal;
  const maxReward = Math.min(ACTIVITY_MAX_REWARD, remaining);

  if (maxReward < ACTIVITY_MIN_REWARD) return;

  const amount = randomInt(ACTIVITY_MIN_REWARD, maxReward);
  adjustScore(gId, null, userId, amount, "Activity Bonus (chat participation)");
  lastActivityAward.set(key, now);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates, // REQUIRED
  ],
});

installAfterdarkKeywordListener(client);

client.once(Events.ClientReady, (c) => {
  console.log(`Yak Yak ready as ${c.user.tag}`);

  // ---- init lavalink/shoukaku once client is ready ----
  initShoukaku(client);

  console.log(
    `[config] trigger cooldown: ${triggerCooldownMs}ms (~${
      (triggerCooldownMs / 1000).toFixed(1)
    }s)`,
  );
  console.log(
    `[config] activity cooldown: ${ACTIVITY_COOLDOWN_MS}ms (~${
      (ACTIVITY_COOLDOWN_MS / 1000 / 60).toFixed(1)
    }m), daily cap: ${ACTIVITY_DAILY_CAP}`,
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  // MUSIC BUTTONS
  if (interaction.isButton() && interaction.customId.startsWith("music:")) {
    try {
      await handleMusicButton(interaction);
    } catch (err) {
      console.error("Error handling music button:", err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (guildId && interaction.guildId && interaction.guildId !== guildId) return;

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

    maybeAwardActivity(message);

    const content = message.content;
    if (!content) return;

    const triggers = getTriggers(message.guildId);
    if (triggers.length === 0) return;

    const lower = content.toLowerCase();
    const now = Date.now();

    for (const trig of triggers) {
      const haystack = trig.caseSensitive ? content : lower;
      const needle = trig.caseSensitive
        ? trig.phrase
        : trig.phrase.toLowerCase();

      if (!haystack.includes(needle)) continue;
      if (trig.delta === 0) continue;

      const key = `${message.guildId}:${message.author.id}:${trig.id}`;
      const lastHit = triggerCooldownMap.get(key) ?? 0;
      if (now - lastHit < triggerCooldownMs) continue;

      triggerCooldownMap.set(key, now);

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
        .setTitle(positive ? "Social Credit Awarded" : "Social Credit Deducted")
        .setDescription(
          `${message.author} triggered **"${trig.phrase}"**.\nDelta: **${
            trig.delta > 0 ? `+${trig.delta}` : trig.delta
          }**\nPrevious: **${previous}**\nCurrent: **${current}**`,
        )
        .setFooter({ text: "Automated Social Credit trigger" });

      if (gif) embed.setImage(gif);

      await message.channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error("Error handling message trigger/activity:", err);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;

    const message = reaction.message;
    if (!message.guildId) return;
    if (guildId && message.guildId !== guildId) return;

    const author = message.author;
    if (!author || author.bot) return;

    const key = `${message.guildId}:${message.channelId}:${message.id}`;
    let state = reactionTracker.get(key);
    if (!state) {
      state = { users: new Set<string>(), rewarded: false };
      reactionTracker.set(key, state);
    }

    if (state.rewarded) return;
    state.users.add(user.id);
    if (state.users.size < REACTION_MIN_DISTINCT) return;

    state.rewarded = true;
    reactionTracker.set(key, state);

    const authorId = author.id;
    const todayTotal = getTodayActivityTotal(message.guildId, authorId);
    if (todayTotal >= ACTIVITY_DAILY_CAP) return;

    const remaining = ACTIVITY_DAILY_CAP - todayTotal;
    const maxBonus = Math.min(REACTION_BONUS_MAX, remaining);
    if (maxBonus < REACTION_BONUS_MIN) return;

    const amount = randomInt(REACTION_BONUS_MIN, maxBonus);

    adjustScore(
      message.guildId,
      user.id,
      authorId,
      amount,
      "Reaction Bonus (message popped off)",
    );
  } catch (err) {
    console.error("Error handling reaction bonus:", err);
  }
});

client.login(token);
