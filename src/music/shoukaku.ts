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
  // Guard against double init (can happen on hot reload / multiple imports)
  if (shoukaku) return shoukaku;

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

  return shoukaku;
}

export async function joinOrGetPlayer(args: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  const s = mustShoukaku();

  const existing = s.players.get(args.guildId) as Player | undefined;

  if (existing && (existing as any).connection) {
    const curChannelId = (existing as any).connection?.channelId;

    // If already connected to THIS channel, reuse.
    if (curChannelId === args.channelId) {
      return existing;
    }

    // Otherwise leave cleanly first (v4 pattern)
    try {
      (existing as any).connection?.disconnect();
    } catch {}
    try {
      await s.leaveVoiceChannel(args.guildId);
    } catch {}
  }

  // Fresh join to requested VC
  return s.joinVoiceChannel({
    guildId: args.guildId,
    channelId: args.channelId,
    shardId: args.shardId,
    deaf: true,
  } as any);
}

export async function leavePlayer(guildId: string) {
  const s = mustShoukaku();
  const existing = s.players.get(guildId) as Player | undefined;
  if (!existing) return;

  // Shoukaku v4: disconnect via connection + leaveVoiceChannel on Shoukaku
  try {
    (existing as any).connection?.disconnect();
  } catch {}
  try {
    await s.leaveVoiceChannel(guildId);
  } catch {}
  try {
    s.players.delete(guildId);
  } catch {}
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
