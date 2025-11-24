// src/music/shoukaku.ts
import { Shoukaku, Connectors, type Player } from "shoukaku";
import type { Client } from "discord.js";

let s: Shoukaku | null = null;

function must() {
  if (!s) throw new Error("Shoukaku not initialized");
  return s;
}

export function initShoukaku(client: Client) {
  const host = (process.env.LAVALINK_HOST || "127.0.0.1").trim();
  const port = (process.env.LAVALINK_PORT || "2333").trim();
  const secure = (process.env.LAVALINK_SECURE || "false").toLowerCase() === "true";
  const auth = (process.env.LAVALINK_PASSWORD || "").trim();

  let url =
    (process.env.LAVALINK_URL || "").trim() ||
    `${secure ? "wss" : "ws"}://${host}:${port}`;

  // If someone put only host:port or only "ws", normalize to full ws://host:port
  if (!url.includes("://")) {
    // if they accidentally set "ws" or "wss" as URL, fall back to host/port
    if (url === "ws" || url === "wss") {
      url = `${secure ? "wss" : "ws"}://${host}:${port}`;
    } else {
      url = `${secure ? "wss" : "ws"}://${url}`;
    }
  }

  const nodes = [{ name: "local", url, auth }];

  s = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 999,
    restTimeout: 10_000,
    moveOnDisconnect: false,
  });

  s.on("ready", (name) => console.log(`[MUSIC] Lavalink node ready: ${name} url=${url}`));
  s.on("error", (name, error) => console.error(`[MUSIC] Lavalink node error: ${name}`, error));
  s.on("close", (name, code, reason) =>
    console.warn(`[MUSIC] Lavalink node closed: ${name} code=${code} reason=${reason}`),
  );
  s.on("reconnecting", (name) =>
    console.warn(`[MUSIC] Lavalink node reconnecting: ${name}`),
  );

  console.log("[MUSIC] Shoukaku initialized");
}

function idealNode() {
  const sh = must();
  const node = sh.getIdealNode();
  if (!node) throw new Error("No Lavalink nodes available");
  return node;
}

export async function joinOrGetPlayer(opts: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  const sh = must();

  const existing = (sh as any).players?.get(opts.guildId) as Player | undefined;
  if (existing) {
    const existingChannel =
      (existing as any).connection?.channelId ??
      (existing as any).channelId ??
      (existing as any).voice?.channelId;

    if (existingChannel === opts.channelId) return existing;

    // stale/wrong channel → hard disconnect
    try {
      if (typeof (existing as any).disconnect === "function") {
        await (existing as any).disconnect();
      } else if (typeof (existing as any).destroy === "function") {
        await (existing as any).destroy();
      }
    } catch {}
    try {
      (sh as any).players?.delete(opts.guildId);
    } catch {}
  }

  const player = await sh.joinVoiceChannel({
    guildId: opts.guildId,
    channelId: opts.channelId,
    shardId: opts.shardId,
    deaf: true,
  });

  return player;
}

export function leavePlayer(guildId: string) {
  const sh = must();
  const player = (sh as any).players?.get(guildId) as Player | undefined;
  if (!player) return;

  try {
    if (typeof (player as any).disconnect === "function") {
      (player as any).disconnect();
    } else if (typeof (player as any).destroy === "function") {
      (player as any).destroy();
    }
  } catch {}

  try {
    (sh as any).players?.delete(guildId);
  } catch {}
}

export async function resolveTracks(identifier: string): Promise<{ tracks: any[] }> {
  const node = idealNode();
  const res: any = await node.rest.resolve(identifier);

  // Lavalink v4 results vary by loadType; normalize to a flat tracks array
  let tracks: any[] = [];

  if (Array.isArray(res?.data)) tracks = res.data; // search result
  else if (Array.isArray(res?.tracks)) tracks = res.tracks;
  else if (res?.data?.tracks && Array.isArray(res.data.tracks)) tracks = res.data.tracks; // playlist
  else if (res?.data && !Array.isArray(res.data)) tracks = [res.data]; // single track

  return { tracks };
}
