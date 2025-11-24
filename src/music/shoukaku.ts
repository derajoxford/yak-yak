// src/music/shoukaku.ts
import { Shoukaku, Connectors, type Node, type Player } from "shoukaku";
import type { Client } from "discord.js";

let s: Shoukaku | null = null;

// local cache (nice to have), but we will trust Shoukaku's internal maps first
const localPlayers = new Map<string, Player>();

function envBool(v: string | undefined, dflt = false) {
  if (v == null) return dflt;
  return v.toLowerCase() === "true" || v === "1" || v.toLowerCase() === "yes";
}

function getIdealNode(): Node {
  if (!s) throw new Error("Shoukaku not initialized");
  const node = s.getIdealNode();
  if (!node) throw new Error("No Lavalink nodes available");
  return node;
}

export function initShoukaku(client: Client) {
  const host = process.env.LAVALINK_HOST || "127.0.0.1";
  const port = Number(process.env.LAVALINK_PORT || "2333");
  const secure = envBool(process.env.LAVALINK_SECURE, false);

  // Shoukaku expects host:port, NOT ws://...
  const url = `${host}:${port}`;
  const auth = process.env.LAVALINK_PASSWORD || "";

  console.log(
    `[MUSIC] Lavalink config host=${host} port=${port} secure=${secure} url=ws://${url}`,
  );

  const nodes = [
    {
      name: "local",
      url,
      auth,
      secure,
    },
  ];

  const connector = new Connectors.DiscordJS(client);

  s = new Shoukaku(connector, nodes, {
    reconnectTries: 10,
    reconnectInterval: 5,
    restTimeout: 10_000,
    moveOnDisconnect: false,
  });

  s.on("ready", (name) => {
    console.log(`[MUSIC] Lavalink node ready: ${name} url=${url}`);
  });

  s.on("error", (name, err) => {
    console.log(`[MUSIC] Lavalink node error: ${name}`, err);
  });

  s.on("close", (name, code, reason) => {
    console.log(
      `[MUSIC] Lavalink node closed: ${name} code=${code} reason=${reason ?? ""}`,
    );
  });

  s.on("reconnecting", (name) => {
    console.log(`[MUSIC] Lavalink node reconnecting: ${name}`);
  });

  console.log("[MUSIC] Shoukaku initialized");
}

export async function joinOrGetPlayer(opts: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  if (!s) throw new Error("Shoukaku not initialized");

  const { guildId, channelId, shardId } = opts;

  const sAny = s as any;

  // 1) FIRST: Shoukaku's own player map (source of truth)
  const existingFromShoukaku: Player | undefined =
    sAny.players?.get?.(guildId);

  const existing = existingFromShoukaku ?? localPlayers.get(guildId);
  if (existing) {
    const exAny = existing as any;

    // If bot is already connected but in another VC, try move.
    const curChan =
      exAny?.connection?.channelId ??
      exAny?.channelId ??
      exAny?.data?.channelId;

    if (curChan && curChan !== channelId) {
      try {
        await exAny.moveChannel?.(channelId);
      } catch {
        // If move fails, fall through and rejoin cleanly
      }
    }

    localPlayers.set(guildId, existing);
    return existing;
  }

  // 2) If Shoukaku thinks there's a connection but no player, clear it.
  const hasConn = sAny.connections?.get?.(guildId);
  if (hasConn) {
    try {
      await sAny.leaveVoiceChannel?.(guildId);
    } catch {}
  }

  // 3) Fresh join
  const node = getIdealNode();
  const player: Player = await s.joinVoiceChannel({
    guildId,
    channelId,
    shardId,
    deaf: true,
  });

  localPlayers.set(guildId, player);
  return player;
}

export function leavePlayer(guildId: string) {
  const p = localPlayers.get(guildId);
  if (p) {
    const pAny = p as any;
    try {
      pAny.destroy?.();
    } catch {}
    localPlayers.delete(guildId);
  }

  const sAny = s as any;
  try {
    sAny?.leaveVoiceChannel?.(guildId);
  } catch {}

  // also nuke Shoukaku internal player if present
  try {
    sAny?.players?.delete?.(guildId);
  } catch {}
}

export async function resolveTracks(identifier: string): Promise<{
  tracks: any[];
  loadType?: string;
}> {
  const node = getIdealNode();

  const res = (await (node as any).rest.resolve(identifier)) as any;
  if (!res) return { tracks: [], loadType: "NO_MATCHES" };

  // Lavalink v4 returns { loadType, data: [...] }
  const tracks = res.data ?? res.tracks ?? [];
  return { tracks, loadType: res.loadType };
}
