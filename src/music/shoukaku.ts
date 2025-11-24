// src/music/shoukaku.ts
import { Shoukaku, Connectors, type Node, type Player } from "shoukaku";
import type { Client } from "discord.js";

let s: Shoukaku | null = null;

// We keep our own cache so we can avoid double-joining.
const players = new Map<string, Player>();

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

  // IMPORTANT: Shoukaku expects "host:port" here, not "ws://..."
  const url = `${host}:${port}`;
  const auth = process.env.LAVALINK_PASSWORD || "";

  console.log(
    `[MUSIC] Lavalink config host=${host} port=${port} secure=${secure} url=${secure ? "wss" : "ws"}://${url}`,
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

  const existing = players.get(guildId);
  if (existing) {
    const exAny = existing as any;

    const connected =
      exAny?.data?.state?.connected ??
      exAny?.state?.connected ??
      exAny?.connection?.connected ??
      false;

    if (connected) {
      // If already connected, just reuse it.
      const curChan =
        exAny?.connection?.channelId ??
        exAny?.channelId ??
        exAny?.data?.channelId;

      // If they moved voice channels, try to move without rejoin.
      if (curChan && curChan !== channelId) {
        try {
          await exAny.moveChannel?.(channelId);
        } catch {
          // Fallback: destroy and rejoin.
          try {
            await exAny.destroy?.();
          } catch {}
          players.delete(guildId);
        }
      } else {
        return existing;
      }
    } else {
      // Stale player — destroy so we can rejoin cleanly.
      try {
        await exAny.destroy?.();
      } catch {}
      players.delete(guildId);
    }
  }

  const node = getIdealNode();
  const player = await s.joinVoiceChannel({
    guildId,
    channelId,
    shardId,
    deaf: true,
  });

  // Cache it so we don't double-join next time.
  players.set(guildId, player);
  return player;
}

export function leavePlayer(guildId: string) {
  const player = players.get(guildId);
  if (player) {
    const pAny = player as any;
    try {
      pAny.destroy?.();
    } catch {}
    players.delete(guildId);
  }

  const sAny = s as any;
  try {
    sAny?.leaveVoiceChannel?.(guildId);
  } catch {}
}

export async function resolveTracks(identifier: string): Promise<{
  tracks: any[];
  loadType?: string;
}> {
  const node = getIdealNode();

  const res = (await (node as any).rest.resolve(identifier)) as any;
  if (!res) return { tracks: [], loadType: "NO_MATCHES" };

  // Lavalink v4 returns { loadType, data: [...] }.
  const tracks = res.data ?? res.tracks ?? [];
  return { tracks, loadType: res.loadType };
}
