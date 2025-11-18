// src/index.ts
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

// Cooldown for auto Social Credit triggers (keyword-based), in ms.
// Default: 60000 (60s) if not set in env.
const triggerCooldownMs: number = Number(
  process.env.SOCIAL_TRIGGER_COOLDOWN_MS ?? "60000",
);

// key: `${guildId}:${userId}:${triggerId}` -> last hit timestamp (ms)
const triggerCooldownMap = new Map<string, number>();

function pickTriggerGif(
  guild: string,
  positive: boolean,
): string | null {
  return getRandomGif(guild, positive ? "positive" : "negative");
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
  console.log(
    `[config] trigger cooldown: ${triggerCooldownMs}ms (~${
      (triggerCooldownMs / 1000).toFixed(1)
    }s)`,
  );
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
    const now = Date.now();

    for (const trig of triggers) {
      const haystack = trig.caseSensitive ? content : lower;
      const needle = trig.caseSensitive
        ? trig.phrase
        : trig.phrase.toLowerCase();

      if (!haystack.includes(needle)) continue;
      if (trig.delta === 0) continue;

      // ---- Cooldown check (per guild + user + trigger) ----
      const key = `${message.guildId}:${message.author.id}:${trig.id}`;
      const lastHit = triggerCooldownMap.get(key) ?? 0;
      const elapsed = now - lastHit;

      if (elapsed < triggerCooldownMs) {
        // Still on cooldown; skip this trigger for this message
        continue;
      }

      // Record this hit time
      triggerCooldownMap.set(key, now);

      // ---- Apply Social Credit change ----
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
        embed.setImage(gif);
      }

      await message.channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error("Error handling message trigger:", err);
  }
});

client.login(token);
