// src/music/shoukaku.ts
import { Shoukaku, Connectors, type Player, type NodeOption } from "shoukaku";
import type { Client } from "discord.js";

let shoukaku: Shoukaku | null = null;

// We keep our own player map because Shoukaku v4 typings no longer expose node.players.
const players = new Map<string, Player>();
const playerMeta = new Map<string, { channelId: string; shardId: number }>();

function parseLavalinkEnv() {
  const password = process.env.LAVALINK_PASSWORD || "";

  // Prefer URL if present
  const rawUrl = process.env.LAVALINK_URL;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      const host = u.hostname || "127.0.0.1";
      const port = Number(u.port || process.env.LAVALINK_PORT || 2333);
      const secure =
        u.protocol === "wss:" ||
        process.env.LAVALINK_SECURE === "true" ||
        process.env.LAVALINK_SECURE === "1";

      return { host, port, secure, password };
    } catch {
      // fall through to HOST/PORT below
    }
  }

  const host = process.env.LAVALINK_HOST || "127.0.0.1";
  const port = Number(process.env.LAVALINK_PORT || 2333);
  const secure =
    process.env.LAVALINK_SECURE === "true" ||
    process.env.LAVALINK_SECURE === "1";

  return { host, port, secure, password };
}

export function initShoukaku(client: Client) {
  if (shoukaku) return shoukaku;

  const { host, port, secure, password } = parseLavalinkEnv();
  if (!password) {
    throw new Error("LAVALINK_PASSWORD env var missing");
  }

  const url = `${secure ? "wss" : "ws"}://${host}:${port}`;

  const nodes: NodeOption[] = [
    {
      name: "local",
      url,
      auth: password,
      secure,
    },
  ];

  shoukaku = new Shoukaku(
    new Connectors.DiscordJS(client),
    nodes,
    {
      moveOnDisconnect: true,
      reconnectInterval: 5,
      restTimeout: 10,
      resume: true,
      resumeTimeout: 60,
    } as any
  );

  shoukaku.on("ready", (name) => {
    console.log(`[MUSIC] Lavalink node ready: ${name}`);
  });
  shoukaku.on("error", (name, err) => {
    console.error(`[MUSIC] Lavalink node error: ${name}`, err);
  });
  shoukaku.on("close", (name, code, reason) => {
    console.warn(`[MUSIC] Lavalink node closed: ${name} code=${code} reason=${reason ?? ""}`);
  });
  shoukaku.on("reconnecting", (name) => {
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

  const existing = players.get(opts.guildId);
  const meta = playerMeta.get(opts.guildId);

  if (existing && meta) {
    const pAny = existing as any;
    const connected =
      pAny.state?.connected ??
      pAny.connected ??
      pAny.connection?.connected ??
      false;

    // same channel + still connected => reuse
    if (meta.channelId === opts.channelId && connected) {
      return existing;
    }

    // stale/wrong channel => nuke it
    console.log(
      `[MUSIC] Existing player stale/wrong channel (have=${meta.channelId}, want=${opts.channelId}, connected=${connected}). Leaving...`
    );
    try { pAny.disconnect?.(); } catch {}
    try { pAny.leaveChannel?.(); } catch {}
    try { pAny.destroy?.(); } catch {}
    players.delete(opts.guildId);
    playerMeta.delete(opts.guildId);
  }

  const node = s.getIdealNode();
  if (!node) throw new Error("Can't find any nodes to connect on");

  const player = await s.joinVoiceChannel({
    guildId: opts.guildId,
    channelId: opts.channelId,
    shardId: opts.shardId,
  } as any);

  players.set(opts.guildId, player);
  playerMeta.set(opts.guildId, { channelId: opts.channelId, shardId: opts.shardId });

  return player;
}

export function leavePlayer(guildId: string) {
  const p = players.get(guildId);
  if (!p) return;
  const pAny = p as any;

  try { pAny.disconnect?.(); } catch {}
  try { pAny.leaveChannel?.(); } catch {}
  try { pAny.destroy?.(); } catch {}

  players.delete(guildId);
  playerMeta.delete(guildId);
}

export async function resolveTracks(identifier: string): Promise<{
  loadType: string;
  tracks: any[];
}> {
  const s = getShoukaku();
  const node = s.getIdealNode();
  if (!node) throw new Error("Can't find any nodes to connect on");

  const res: any = await node.rest.resolve(identifier);

  let tracks: any[] = [];
  if (Array.isArray(res?.data)) {
    tracks = res.data;
  } else if (res?.data?.tracks && Array.isArray(res.data.tracks)) {
    tracks = res.data.tracks;
  } else if (res?.data) {
    tracks = [res.data];
  }

  return {
    loadType: res?.loadType ?? "unknown",
    tracks,
  };
}
