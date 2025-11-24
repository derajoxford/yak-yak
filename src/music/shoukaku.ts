// src/music/shoukaku.ts
import { Client } from "discord.js";
import {
  Shoukaku,
  Connectors,
  type Node,
  type Player,
  type NodeOption,
  type LavalinkResponse,
} from "shoukaku";

let shoukaku: Shoukaku | null = null;

function env(name: string, fallback?: string) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

function envInt(name: string, fallback: number) {
  const raw = env(name);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback = false) {
  const raw = env(name);
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const host = env("LAVALINK_HOST", "127.0.0.1")!;
  const port = envInt("LAVALINK_PORT", 2333);
  const secure = envBool("LAVALINK_SECURE", false);
  const password = env("LAVALINK_PASSWORD", "")!;

  const urlNoProto = `${host}:${port}`;
  const urlDisplay =
    env("LAVALINK_URL") ?? `${secure ? "wss" : "ws"}://${urlNoProto}`;

  console.log(
    `[MUSIC] Lavalink config host=${host} port=${port} secure=${secure} url=${urlDisplay}`,
  );

  const nodes: NodeOption[] = [
    {
      name: "local",
      url: urlNoProto, // Shoukaku v4 wants host:port WITHOUT ws://
      auth: password,
      secure,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    moveOnDisconnect: true,
    resume: false,
    reconnectTries: 5,
    restTimeout: 10_000,
  });

  shoukaku.on("ready", (name) =>
    console.log(`[MUSIC] Lavalink node ready: ${name} url=${urlNoProto}`),
  );
  shoukaku.on("error", (name, error) =>
    console.log(`[MUSIC] Lavalink node error: ${name} ${error}`),
  );
  shoukaku.on("close", (name, code, reason) =>
    console.log(
      `[MUSIC] Lavalink node closed: ${name} code=${code} reason=${reason ?? ""}`,
    ),
  );
  shoukaku.on("reconnecting", (name) =>
    console.log(`[MUSIC] Lavalink node reconnecting: ${name}`),
  );

  console.log("[MUSIC] Shoukaku initialized");
  return shoukaku;
}

export function getShoukaku(): Shoukaku {
  if (!shoukaku) {
    throw new Error("Shoukaku not initialized. Call initShoukaku(client) first.");
  }
  return shoukaku;
}

function getIdealNode(): Node {
  const s = getShoukaku();
  const ideal = s.getIdealNode();
  if (ideal) return ideal;

  const fallback = [...s.nodes.values()][0];
  if (!fallback) throw new Error("No Lavalink nodes configured.");
  return fallback;
}

export async function resolveTracks(
  identifier: string,
): Promise<LavalinkResponse> {
  const node = getIdealNode();
  return node.rest.resolve(identifier);
}

type JoinOpts = {
  guildId: string;
  channelId: string;
  shardId: number;
};

export async function joinOrGetPlayer(opts: JoinOpts): Promise<Player> {
  const s = getShoukaku();

  // ✅ If a player already exists, reuse it.
  const existing = s.players.get(opts.guildId);
  if (existing) return existing;

  // ✅ If a stale connection exists without a player, clear it first.
  if (s.connections.has(opts.guildId)) {
    try {
      await s.leaveVoiceChannel(opts.guildId);
    } catch {
      // ignore cleanup errors
    }
  }

  const node = getIdealNode();
  if (!node) throw new Error("Can't find any nodes to connect on");

  // Join voice + create player (idempotent around fresh state)
  const player = await s.joinVoiceChannel({
    guildId: opts.guildId,
    channelId: opts.channelId,
    shardId: opts.shardId,
    deaf: false, // try to avoid self-deafen
    mute: false,
  });

  return player;
}

export function leavePlayer(guildId: string) {
  const s = getShoukaku();
  s.leaveVoiceChannel(guildId).catch(() => {});
}
