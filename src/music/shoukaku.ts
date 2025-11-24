// src/music/shoukaku.ts
import { Client } from "discord.js";
import {
  Shoukaku,
  Connectors,
  type NodeOption,
  type Player,
  type Node,
} from "shoukaku";

let shoukaku: Shoukaku | null = null;

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const password = process.env.LAVALINK_PASSWORD;
  if (!password) {
    throw new Error("LAVALINK_PASSWORD env var missing");
  }

  const host = process.env.LAVALINK_HOST ?? "127.0.0.1";
  const port = Number(process.env.LAVALINK_PORT ?? "2333");
  const secure =
    (process.env.LAVALINK_SECURE ?? "false").toLowerCase() === "true";
  const name = process.env.LAVALINK_NAME ?? "local";

  const url = `${secure ? "wss" : "ws"}://${host}:${port}`;

  const nodes: NodeOption[] = [
    {
      name,
      url,
      auth: password,
      secure,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 10,
    reconnectInterval: 5,
    restTimeout: 10,
    voiceConnectionTimeout: 15,
    moveOnDisconnect: false,
  });

  // Some DiscordJS setups need raw forwarding for voice events
  const connectorAny: any = shoukaku.connector as any;
  if (typeof connectorAny.raw === "function") {
    client.on("raw", (pkt: any) => connectorAny.raw(pkt));
  }

  shoukaku.on("ready", (nodeName: string) => {
    console.log(`[MUSIC] Lavalink node ready: ${nodeName}`);
  });
  shoukaku.on("error", (nodeName: string, err: unknown) => {
    console.error(`[MUSIC] Lavalink node error: ${nodeName}`, err);
  });
  shoukaku.on("close", (nodeName: string, code: number, reason: string) => {
    console.warn(
      `[MUSIC] Lavalink node closed: ${nodeName} code=${code} reason=${reason}`,
    );
  });
  shoukaku.on("reconnecting", (nodeName: string) => {
    console.warn(`[MUSIC] Lavalink node reconnecting: ${nodeName}`);
  });

  console.log("[MUSIC] Shoukaku initialized");
  return shoukaku;
}

export function getShoukaku(): Shoukaku {
  if (!shoukaku) throw new Error("Shoukaku not initialized");
  return shoukaku;
}

function idealNode(): Node {
  const s = getShoukaku();
  const node = s.getIdealNode();
  if (!node) {
    throw new Error("[MUSIC] No Lavalink nodes available/ready yet");
  }
  return node;
}

function safeLeave(player: Player) {
  const p: any = player as any;
  try {
    if (typeof p.leaveChannel === "function") return p.leaveChannel();
    if (typeof p.disconnect === "function") return p.disconnect();
    if (typeof p.destroy === "function") return p.destroy();
  } catch {}
}

export async function joinOrGetPlayer(opts: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  const s = getShoukaku();

  const players: Map<string, Player> = (s as any).players ?? new Map();
  const existing = players.get(opts.guildId);

  if (existing) {
    const curChannelId =
      (existing as any).connection?.channelId ??
      (existing as any).channelId;

    const connected =
      (existing as any).data?.state?.connected ??
      (existing as any).connection?.connected;

    if (curChannelId === opts.channelId && connected !== false) {
      return existing;
    }

    console.log(
      `[MUSIC] Existing player stale/wrong channel (have=${curChannelId}, want=${opts.channelId}, connected=${connected}). Leaving...`,
    );
    await Promise.resolve(safeLeave(existing)).catch(() => {});
    players.delete(opts.guildId);
  }

  const player = await s.joinVoiceChannel({
    guildId: opts.guildId,
    channelId: opts.channelId,
    shardId: opts.shardId,
    deaf: false,
  });

  players.set(opts.guildId, player);
  (s as any).players = players;

  return player;
}

export function leavePlayer(guildId: string): void {
  const s = getShoukaku();
  const players: Map<string, Player> = (s as any).players ?? new Map();
  const player = players.get(guildId);
  if (!player) return;

  Promise.resolve(safeLeave(player)).catch(() => {});
  players.delete(guildId);
  (s as any).players = players;
}

export async function resolveTracks(identifier: string): Promise<{
  tracks: any[];
  loadType: string;
  playlistName?: string;
}> {
  const node = idealNode();
  const res: any = await node.rest.resolve(identifier);

  if (!res) return { tracks: [], loadType: "empty" };

  switch (res.loadType) {
    case "track":
      return { tracks: res.data ? [res.data] : [], loadType: res.loadType };

    case "playlist":
      return {
        tracks: res.data?.tracks ?? [],
        loadType: res.loadType,
        playlistName: res.data?.info?.name,
      };

    case "search":
    case "empty":
      return { tracks: res.data ?? [], loadType: res.loadType };

    case "error":
      console.warn("[MUSIC] resolve error:", res.data);
      return { tracks: [], loadType: res.loadType };

    default:
      return {
        tracks: res.data?.tracks ?? res.data ?? [],
        loadType: res.loadType ?? "unknown",
      };
  }
}
