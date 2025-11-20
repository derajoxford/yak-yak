// src/nsfw_keywords.ts
import { Client, TextChannel } from "discord.js";
import { getRandomKeywordContent } from "./afterdarkStore.js";

const allowedGuildId = process.env.SOCIAL_GUILD_ID || null;

export function installAfterdarkKeywordListener(client: Client) {
  client.on("messageCreate", async (message) => {
    try {
      if (!message.guildId) return;
      if (allowedGuildId && message.guildId !== allowedGuildId) return;
      if (message.author.bot) return;

      const channel = message.channel as TextChannel;

      // Only react in NSFW guild text channels
      if (!("nsfw" in channel) || !channel.nsfw) return;

      const raw = (message.content ?? "").trim();
      if (!raw) return;

      const keyword = raw.toLowerCase();

      const content = await getRandomKeywordContent(message.guildId, keyword);
      if (!content) return;

      await (channel as any).send({ content });
    } catch (err) {
      console.error("Error in afterdark keyword listener:", err);
    }
  });
}
