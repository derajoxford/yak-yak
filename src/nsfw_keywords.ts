// src/nsfw_keywords.ts
import { Client, TextChannel } from "discord.js";
import { getKeyword } from "./afterdarkStore.js";

export function installAfterdarkKeywordListener(client: Client) {
  client.on("messageCreate", async (message) => {
    // Ignore bots and DMs
    if (message.author.bot) return;
    if (!message.guild) return;

    const channel = message.channel as TextChannel;

    // Only in NSFW channels
    if (!("nsfw" in channel) || !channel.nsfw) return;

    const raw = message.content.trim();
    if (!raw) return;

    const keyword = raw.toLowerCase();
    const entry = await getKeyword(message.guild.id, keyword);
    if (!entry || !entry.content) return;

    await channel.send({ content: entry.content });
  });
}
