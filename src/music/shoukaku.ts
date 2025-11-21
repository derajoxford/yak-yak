// src/music/shoukaku.ts
import type { Client } from "discord.js";
import { Shoukaku, Connectors, type NodeOption } from "shoukaku";

let shoukaku: Shoukaku | null = null;

function buildNodes(): NodeOption[] {
  const pass = process.env.LAVALINK_PASSWORD;
  if (!pass) {
    throw new Error("LAVALINK_PASSWORD env var missing");
  }

  return [
    {
      name: "local",
      url: "127.0.0.1:2333",
      auth: pass,
      secure: false,
    },
  ];
}

export function getShoukaku(client?: Client): Shoukaku {
  if (shoukaku) return shoukaku;
  if (!client) throw new Error("Shoukaku not initialized (client missing)");

  const nodes = buildNodes();

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5,
    restTimeout: 10_000,
  });

  // --- node lifecycle logging ---
  shoukaku.on("ready", (name: string, resumed: boolean) => {
    console.log(`[MUSIC] Lavalink node ready: ${name} resumed=${resumed}`);
  });

  shoukaku.on("error", (name: string, error: unknown) => {
    console.error(`[MUSIC] Lavalink node error: ${name}`, error);
  });

  shoukaku.on("close", (name: string, code: number, reason: string) => {
    console.warn(`[MUSIC] Lavalink node close: ${name} code=${code} reason=${reason}`);
  });

  shoukaku.on("reconnecting", (name: string) => {
    console.warn(`[MUSIC] Lavalink node reconnecting: ${name}`);
  });

  return shoukaku;
}

/**
 * Join or reuse a player for this guild.
 * Uses Shoukaku connections (not Player fields) to avoid "stale/undefined" loops.
 */
export async function joinOrGetPlayer(
  client: Client,
  guildId: string,
  channelId: string,
) {
  const s = getShoukaku(client);

  // If we already have a connection for this guild, verify it's the right channel.
  const existingConn = s.connections.get(guildId);
  if (existingConn) {
    const haveChannel = existingConn.channelId;
    if (haveChannel && haveChannel !== channelId) {
      console.log(
        `[MUSIC] Existing connection in another channel (have=${haveChannel}, want=${channelId}). Leaving...`,
      );
      await s.leaveVoiceChannel(guildId);
    }
  }

  // Shard id (0 for unsharded bots)
  const shardId =
    client.guilds.cache.get(guildId)?.shardId ??
    (client.shard?.ids?.[0] ?? 0);

  // joinVoiceChannel is idempotent IF we didn't already connect above
  const player = await s.joinVoiceChannel({
    guildId,
    channelId,
    shardId,
    deaf: true,
    mute: false,
  });

  return player;
}

export async function leaveVoiceChannel(guildId: string) {
  if (!shoukaku) return;
  await shoukaku.leaveVoiceChannel(guildId).catch(() => {});
}
