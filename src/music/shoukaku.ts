// src/music/shoukaku.ts
import { Shoukaku, Connectors, type Player } from "shoukaku";
import type { Client } from "discord.js";

let s: Shoukaku | null = null;

function must() {
  if (!s) throw new Error("Shoukaku not initialized");
  return s;
}

export function initShoukaku(client: Client) {
  let host = (process.env.LAVALINK_HOST || "127.0.0.1").trim();
  let port = (process.env.LAVALINK_PORT || "2333").trim();
  const secure =
    (process.env.LAVALINK_SECURE || "false").toLowerCase() === "true";
  const auth = (process.env.LAVALINK_PASSWORD || "").trim();

  // If someone fed a full URL into HOST, peel it down to host/port.
  if (host.includes("://")) {
    try {
      const u = new URL(host);
      host = u.hostname || "127.0.0.1";
      if (u.port) port = u.port;
    } catch {}
  }

  // If LAVALINK_URL is set, allow either "host:port" or "ws://host:port"
  const rawUrl = (process.env.LAVALINK_URL || "").trim();
  if (rawUrl) {
    if (rawUrl.includes("://")) {
      try {
        const u = new URL(rawUrl);
        host = u.hostname || host;
        if (u.port) port = u.port;
      } catch {}
    } else {
      // rawUrl like "127.0.0.1:2333"
      const m = rawUrl.match(/^([^:]+):(\d+)$/);
      if (m) {
        host = m[1];
        port = m[2];
      }
    }
  }

  // FINAL: Shoukaku v4 node.url MUST be "host:port" (no ws://)
  const nodeUrl = `${host}:${port}`;

  console.log(
    `[MUSIC] Lavalink config host=${host} port=${port} secure=${secure} nodeUrl=${nodeUrl}`,
  );

  const nodes = [{ name: "local", url: nodeUrl, auth, secure }];

  s = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 999,
    restTimeout: 10_000,
    moveOnDisconnect: false,
  });

  s.on("ready", (name) =>
    console.log(`[MUSIC] Lavalink node ready: ${name} url=${nodeUrl}`),
  );
  s.on("error", (name, error) =>
    console.error(`[MUSIC] Lavalink node error: ${name}`, error),
  );
  s.on("close", (name, code, reason) =>
    console.warn(
      `[MUSIC] Lavalink node closed: ${name} code=${code} reason=${reason}`,
    ),
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

export async function resolveTracks(
  identifier: string,
): Promise<{ tracks: any[] }> {
  const node = idealNode();
  const res: any = await node.rest.resolve(identifier);

  let tracks: any[] = [];

  if (Array.isArray(res?.data)) tracks = res.data;
  else if (Array.isArray(res?.tracks)) tracks = res.tracks;
  else if (Array.isArray(res?.data?.tracks)) tracks = res.data.tracks;
  else if (res?.data && !Array.isArray(res.data)) tracks = [res.data];

  return { tracks };
}
