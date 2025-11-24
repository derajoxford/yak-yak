// src/music/shoukaku.ts
import type { Client } from "discord.js";
import {
  Shoukaku,
  Connectors,
  type NodeOption,
  type Player,
  LoadType,
} from "shoukaku";

let shoukaku: Shoukaku | null = null;

// Store channel meta ourselves because v4 Player doesn't expose channelId reliably.
const playerMeta = new Map<string, { channelId: string }>();

function mustShoukaku(): Shoukaku {
  if (!shoukaku) throw new Error("Shoukaku not initialized yet.");
  return shoukaku;
}

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const host = process.env.LAVALINK_HOST ?? "127.0.0.1";
  const port = Number(process.env.LAVALINK_PORT ?? "2333");
  const password = process.env.LAVALINK_PASSWORD;

  if (!password) {
    throw new Error("LAVALINK_PASSWORD env var missing");
  }

  const nodes: NodeOption[] = [
    {
      name: "local",
      url: `${host}:${port}`,
      auth: password,
      secure: false,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5,
    restTimeout: 10_000,
  });

  shoukaku.on("ready", (name: string) => {
    console.log(`[MUSIC] Lavalink node ready: ${name}`);
  });

  shoukaku.on("error", (name: string, err: unknown) => {
    console.error(`[MUSIC] Lavalink node error: ${name}`, err);
  });

  shoukaku.on("close", (name: string, code: number, reason: string) => {
    console.warn(
      `[MUSIC] Lavalink node closed: ${name} code=${code} reason=${reason}`,
    );
  });

  shoukaku.on("reconnecting", (name: string) => {
    console.warn(`[MUSIC] Lavalink node reconnecting: ${name}`);
  });

  return shoukaku;
}

export function getShoukaku(): Shoukaku {
  return mustShoukaku();
}

export function getPlayer(guildId: string): Player | undefined {
  return mustShoukaku().players.get(guildId);
}

export function leavePlayer(guildId: string): void {
  const s = mustShoukaku();
  const existing = s.players.get(guildId);
  if (existing) {
    try {
      existing.destroy();
    } catch {}
  }
  s.players.delete(guildId);
  playerMeta.delete(guildId);
}

export async function joinOrGetPlayer(opts: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  const s = mustShoukaku();

  const existing = s.players.get(opts.guildId);
  const meta = playerMeta.get(opts.guildId);

  if (existing) {
    // ONLY treat stale if we *have* meta and it differs.
    if (meta && meta.channelId !== opts.channelId) {
      console.log(
        `[MUSIC] Existing player in different channel (have=${meta.channelId}, want=${opts.channelId}). Leaving...`,
      );
      leavePlayer(opts.guildId);
    } else {
      return existing;
    }
  }

  const player = await s.joinVoiceChannel({
    guildId: opts.guildId,
    channelId: opts.channelId,
    shardId: opts.shardId,
    deaf: false,
    mute: false,
  });

  playerMeta.set(opts.guildId, { channelId: opts.channelId });
  return player;
}

// Resolve helper used by /music play
export async function resolveTracks(identifier: string): Promise<{
  tracks: any[];
  loadType: LoadType;
}> {
  const node = mustShoukaku().getIdealNode();
  if (!node) {
    throw new Error("No Lavalink nodes are ready");
  }

  const res: any = await node.rest.resolve(identifier);

  if (!res || res.loadType === LoadType.EMPTY || res.loadType === LoadType.ERROR) {
    return { tracks: [], loadType: res?.loadType ?? LoadType.EMPTY };
  }

  switch (res.loadType as LoadType) {
    case LoadType.TRACK:
      return { tracks: res.data ? [res.data] : [], loadType: res.loadType };
    case LoadType.PLAYLIST:
      return { tracks: res.data?.tracks ?? [], loadType: res.loadType };
    case LoadType.SEARCH:
      return { tracks: res.data ?? [], loadType: res.loadType };
    default:
      return { tracks: [], loadType: res.loadType };
  }
}
