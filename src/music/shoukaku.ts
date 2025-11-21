// src/music/shoukaku.ts
import type { Client } from "discord.js";
import { Shoukaku, Connectors, type NodeOption, type Player } from "shoukaku";

let shoukaku: Shoukaku | null = null;

// Keep a simple per-guild player cache
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
  const auth = mustEnv("LAVALINK_PASSWORD"); // you already set this in /opt/lavalink/application.yml

  const Nodes: NodeOption[] = [
    {
      name: "local",
      url: `${host}:${port}`,
      auth,
      secure: false,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, {
    // v4 option name is "resume"
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
  if (existing) {
    // If we already have a player but it’s in another channel, hard reset it.
    if (existing.channelId !== opts.channelId) {
      try {
        s.leaveVoiceChannel(opts.guildId);
      } catch {}
      players.delete(opts.guildId);
    } else {
      return existing;
    }
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
