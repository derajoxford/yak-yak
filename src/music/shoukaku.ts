// src/music/shoukaku.ts
import type { Client } from "discord.js";
import { Shoukaku, Connectors, type NodeOption, type Player } from "shoukaku";

let shoukaku: Shoukaku | null = null;

// per-guild player cache
const players = new Map<string, Player>();

function mustEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`❌ ${name} env var missing`);
  return v;
}

export function initShoukaku(client: Client) {
  if (shoukaku) return shoukaku;

  const host = mustEnv("LAVALINK_HOST", "127.0.0.1");
  const port = Number(mustEnv("LAVALINK_PORT", "2333"));
  const auth = mustEnv("LAVALINK_PASSWORD");

  const nodes: NodeOption[] = [
    {
      name: "local",
      url: `${host}:${port}`,
      auth,
      secure: false,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 10,
  });

  shoukaku.on("ready", (name: string) => {
    console.log(`[MUSIC] Lavalink node ready: ${name}`);
  });
  shoukaku.on("error", (name: string, err: unknown) => {
    console.error(`[MUSIC] Node error ${name}:`, err);
  });
  shoukaku.on("close", (name: string, code: number, reason: string) => {
    console.warn(`[MUSIC] Node close ${name} (${code}): ${reason}`);
  });
  shoukaku.on("reconnecting", (name: string) => {
    console.warn(`[MUSIC] Node reconnecting: ${name}`);
  });

  return shoukaku;
}

export function getShoukaku(): Shoukaku {
  if (!shoukaku) throw new Error("Shoukaku not initialized yet.");
  return shoukaku;
}

export async function ensurePlayer(opts: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  const s = getShoukaku();

  const existing = players.get(opts.guildId);
  const existingConn = s.connections.get(opts.guildId) as any | undefined;
  const existingChannelId: string | undefined = existingConn?.channelId;

  // If we have a player and it’s in a different VC, hard reset.
  if (existing && existingChannelId && existingChannelId !== opts.channelId) {
    try {
      s.leaveVoiceChannel(opts.guildId);
    } catch {}
    players.delete(opts.guildId);
  } else if (existing && existingChannelId === opts.channelId) {
    return existing;
  } else if (existingConn && !existing) {
    // stale connection with no player
    try {
      s.leaveVoiceChannel(opts.guildId);
    } catch {}
  }

  const player = await s.joinVoiceChannel({
    guildId: opts.guildId,
    channelId: opts.channelId,
    shardId: opts.shardId,
  });

  players.set(opts.guildId, player);
  return player;
}

export function getPlayer(guildId: string): Player | undefined {
  return players.get(guildId);
}

export function leaveGuild(guildId: string) {
  const s = getShoukaku();
  try {
    s.leaveVoiceChannel(guildId);
  } catch {}
  players.delete(guildId);
}
