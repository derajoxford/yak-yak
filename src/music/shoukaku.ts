// src/music/shoukaku.ts
import type { Client } from "discord.js";
import { Shoukaku, Connectors, type NodeOption, type Player } from "shoukaku";

let shoukaku: Shoukaku | null = null;

function mustShoukaku(): Shoukaku {
  if (!shoukaku) {
    throw new Error("Shoukaku not initialized. Call initShoukaku(client) first.");
  }
  return shoukaku;
}

export function initShoukaku(client: Client) {
  const host = process.env.LAVALINK_HOST || "127.0.0.1";
  const port = Number(process.env.LAVALINK_PORT || 2333);
  const secure = /^true$/i.test(process.env.LAVALINK_SECURE || "false");
  const password = process.env.LAVALINK_PASSWORD || "youshallnotpass";
  const url =
    process.env.LAVALINK_URL || `${secure ? "wss" : "ws"}://${host}:${port}`;

  const nodes: NodeOption[] = [
    {
      name: "local",
      url: `${host}:${port}`,
      auth: password,
      secure,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    moveOnDisconnect: false,
    reconnectTries: 999,
    reconnectInterval: 5_000,
    restTimeout: 15_000,
  });

  console.log(
    `[MUSIC] Lavalink config host=${host} port=${port} secure=${secure} url=${url}`,
  );

  shoukaku.on("ready", (name) => {
    console.log(`[MUSIC] Lavalink node ready: ${name} url=${host}:${port}`);
  });
  shoukaku.on("error", (name, err) => {
    console.error(`[MUSIC] Lavalink node error: ${name}`, err);
  });
  shoukaku.on("close", (name, code, reason) => {
    console.warn(
      `[MUSIC] Lavalink node closed: ${name} code=${code} reason=${reason ?? ""}`,
    );
  });
  shoukaku.on("reconnecting", (name) => {
    console.warn(`[MUSIC] Lavalink node reconnecting: ${name}`);
  });

  console.log("[MUSIC] Shoukaku initialized");
}

export async function joinOrGetPlayer(args: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  const s = mustShoukaku();

  // If nodes aren't ready yet, don't even try to join.
  if (!s.getIdealNode()) {
    throw new Error("Lavalink not ready yet (no connected nodes).");
  }

  const existing = s.players.get(args.guildId);
  const conn = s.connections.get(args.guildId);

  // If we already have a connection/player, reuse it.
  // This prevents: "This guild already have an existing connection"
  if (existing && conn) {
    // Same VC? return player.
    if (conn.channelId === args.channelId) return existing;

    // Different VC -> leave old, then rejoin new.
    await s.leaveVoiceChannel(args.guildId).catch(() => {});
  } else if (existing && !conn) {
    // Stale player without a connection: drop it so we can rejoin cleanly.
    try { s.players.delete(args.guildId); } catch {}
  }

  return s.joinVoiceChannel({
    guildId: args.guildId,
    channelId: args.channelId,
    shardId: args.shardId,
    deaf: true,
  } as any);
}

export function leavePlayer(guildId: string) {
  const s = mustShoukaku();
  s.leaveVoiceChannel(guildId).catch(() => {});
  try { s.players.delete(guildId); } catch {}
  try { s.connections.delete(guildId); } catch {}
}

export async function resolveTracks(identifier: string): Promise<{
  tracks: any[];
  loadType: string;
}> {
  const s = mustShoukaku();
  const node = s.getIdealNode();
  if (!node) throw new Error("No Lavalink nodes available.");

  const res: any = await node.rest.resolve(identifier);

  // Lavalink v4 returns tracks in res.data (array) for searches/loads.
  const data = res?.data;
  const tracks: any[] = Array.isArray(data)
    ? data
    : Array.isArray(res?.tracks)
      ? res.tracks
      : [];

  return {
    tracks,
    loadType: res?.loadType ?? "NO_MATCHES",
  };
}
