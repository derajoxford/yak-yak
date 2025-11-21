// src/music/shoukaku.ts
import type { Client } from "discord.js";
import {
  Shoukaku,
  Connectors,
  type NodeOption,
  type Player,
} from "shoukaku";

let shoukaku: Shoukaku | null = null;

// Track what channel we joined per guild (avoid relying on Player types)
const joinedChannel = new Map<string, string>();

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const password = process.env.LAVALINK_PASSWORD;
  if (!password) throw new Error("LAVALINK_PASSWORD env var missing");

  const nodes: NodeOption[] = [
    {
      name: "local",
      url: "127.0.0.1:2333",
      auth: password,
      secure: false,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes);

  shoukaku.on("ready", (name: string) => {
    console.log(`[MUSIC] Lavalink node ready: ${name}`);
  });

  shoukaku.on("error", (name: string, err: unknown) => {
    console.error(`[MUSIC] Lavalink node error: ${name}`, err);
  });

  shoukaku.on("close", (name: string, code: number, reason: string) => {
    console.warn(
      `[MUSIC] Lavalink node closed: ${name} code=${code} reason=${reason}`,
    );
  });

  shoukaku.on("reconnecting", (name: string) => {
    console.warn(`[MUSIC] Lavalink node reconnecting: ${name}`);
  });

  return shoukaku;
}

export function getShoukaku(client?: Client): Shoukaku {
  if (!shoukaku) {
    if (!client) throw new Error("Shoukaku not initialized yet");
    return initShoukaku(client);
  }
  return shoukaku;
}

export async function joinOrGetPlayer(
  client: Client,
  guildId: string,
  channelId: string,
  shardId = 0,
): Promise<Player> {
  const s = getShoukaku(client);

  const existing = s.players.get(guildId);
  const prevChan = joinedChannel.get(guildId);

  // If already joined to this channel, reuse
  if (existing && prevChan === channelId) return existing;

  // If joined elsewhere, leave first
  if (existing) {
    try {
      await s.leaveVoiceChannel(guildId);
    } catch (e) {
      console.warn("[MUSIC] leaveVoiceChannel failed (continuing):", e);
    }
  }

  const player = await s.joinVoiceChannel({ guildId, channelId, shardId });
  joinedChannel.set(guildId, channelId);

  // Player lifecycle logs
  player.on("start", (ev) => {
    console.log(
      `[MUSIC] TrackStart ${guildId}: ${ev.track?.info?.title ?? "unknown"}`,
    );
  });

  player.on("end", (ev) => {
    console.log(`[MUSIC] TrackEnd ${guildId}: reason=${ev.reason}`);
  });

  player.on("exception", (ev) => {
    console.warn(`[MUSIC] TrackException ${guildId}:`, ev.exception);
  });

  player.on("stuck", (ev) => {
    console.warn(
      `[MUSIC] TrackStuck ${guildId}: threshold=${ev.thresholdMs}`,
    );
  });

  player.on("closed", (ev) => {
    console.warn(
      `[MUSIC] Player WS closed ${guildId}: code=${ev.code} reason=${ev.reason}`,
    );
  });

  return player;
}

export async function leavePlayer(guildId: string): Promise<void> {
  if (!shoukaku) return;
  joinedChannel.delete(guildId);
  try {
    await shoukaku.leaveVoiceChannel(guildId);
  } catch {}
}
