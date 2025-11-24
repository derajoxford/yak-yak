// src/music/shoukaku.ts
import {
  Shoukaku,
  Connectors,
  type NodeOption,
  type Player,
} from "shoukaku";
import type { Client } from "discord.js";

let shoukaku: Shoukaku | null = null;

// Track where we *think* each guild is connected.
// Shoukaku v4 Player doesn't expose a reliable channelId,
// so we keep our own truth to avoid infinite "stale" leaves.
const guildChannel = new Map<string, string>();

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const password = process.env.LAVALINK_PASSWORD;
  if (!password) {
    console.error("[MUSIC] ❌ LAVALINK_PASSWORD env var missing");
    throw new Error("LAVALINK_PASSWORD env var missing");
  }

  const nodes: NodeOption[] = [
    {
      name: process.env.LAVALINK_NODE_NAME ?? "local",
      url: process.env.LAVALINK_URL ?? "127.0.0.1:2333",
      auth: password,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5,
  });

  shoukaku.on("ready", (name: string) => {
    console.log(`[MUSIC] Lavalink node ready: ${name}`);
  });

  shoukaku.on("error", (name: string, err: unknown) => {
    console.error(`[MUSIC] Lavalink node error: ${name}`, err);
  });

  shoukaku.on("close", (name: string, code: number, reason: string) => {
    console.warn(
      `[MUSIC] Lavalink node closed: ${name} (${code}) ${reason ?? ""}`,
    );
  });

  shoukaku.on("reconnecting", (name: string) => {
    console.warn(`[MUSIC] Lavalink node reconnecting: ${name}`);
  });

  console.log("[MUSIC] Shoukaku initialized");
  return shoukaku;
}

export function getShoukaku(): Shoukaku {
  if (!shoukaku) throw new Error("Shoukaku not initialized");
  return shoukaku;
}

export async function joinOrGetPlayer(opts: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  const s = getShoukaku();

  const existing = s.players.get(opts.guildId); // v4 API :contentReference[oaicite:1]{index=1}
  const lastChan = guildChannel.get(opts.guildId);

  // If we already have a player for THIS channel, reuse it.
  if (existing && lastChan === opts.channelId) return existing;

  // Existing player but different/unknown channel -> leave once, then rejoin.
  if (existing) {
    console.log(
      `[MUSIC] Existing player in different/unknown channel (have=${lastChan ?? "?"}, want=${opts.channelId}). Leaving...`,
    );
    try {
      await s.leaveVoiceChannel(opts.guildId); // v4 API :contentReference[oaicite:2]{index=2}
    } catch {}
  }

  const player = await s.joinVoiceChannel({
    guildId: opts.guildId,
    channelId: opts.channelId,
    shardId: opts.shardId,
    deaf: true,
  }); // join options per Shoukaku v4 :contentReference[oaicite:3]{index=3}

  guildChannel.set(opts.guildId, opts.channelId);
  return player;
}

export async function leaveGuild(guildId: string): Promise<void> {
  const s = getShoukaku();
  guildChannel.delete(guildId);
  await s.leaveVoiceChannel(guildId).catch(() => {});
}

export async function resolveTracks(identifier: string): Promise<any> {
  const s = getShoukaku();
  const node = s.getIdealNode(); // v4 API :contentReference[oaicite:4]{index=4}
  if (!node) throw new Error("No Lavalink nodes are connected");
  return node.rest.resolve(identifier); // returns { tracks: [...] } in v4 :contentReference[oaicite:5]{index=5}
}
