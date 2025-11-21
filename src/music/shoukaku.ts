// src/music/shoukaku.ts
import {
  Shoukaku,
  Connectors,
  type NodeOption,
  type Player,
  type VoiceChannelOptions,
} from "shoukaku";
import type { Client } from "discord.js";

let shoukaku: Shoukaku | null = null;

// We track last known VC per guild because Player doesn't expose channelId in v4.
const lastChannelByGuild = new Map<string, string>();

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const pass = process.env.LAVALINK_PASSWORD;
  if (!pass) {
    throw new Error("LAVALINK_PASSWORD env var missing");
  }

  const nodes: NodeOption[] = [
    {
      name: "local",
      url: process.env.LAVALINK_URL ?? "127.0.0.1:2333",
      auth: pass,
      secure: false,
    },
  ];

  // Per Shoukaku v4 docs, init BEFORE login is ideal, but safe either way.
  shoukaku = new Shoukaku(
    new Connectors.DiscordJS(client),
    nodes,
    {
      resume: true,
      resumeTimeout: 60,
      reconnectTries: 5,
      reconnectInterval: 10,
      restTimeout: 10_000,
      voiceConnectionTimeout: 10_000,
      moveOnDisconnect: true,
      nodeResolver: (ns) => {
        const arr = [...ns.values()];
        if (arr.length === 0) return undefined as any;
        return arr.sort((a, b) => a.penalties - b.penalties)[0];
      },
    },
  );

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
  if (!shoukaku) {
    throw new Error("Shoukaku not initialized. Call initShoukaku(client) first.");
  }
  return shoukaku;
}

export async function joinOrGetPlayer(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<Player> {
  const s = getShoukaku();
  const node =
    s.options.nodeResolver?.(s.nodes) ?? [...s.nodes.values()][0];

  if (!node) throw new Error("No Lavalink nodes available");

  const existing = node.players.get(guildId);
  const lastCh = lastChannelByGuild.get(guildId);

  if (existing) {
    if (lastCh && lastCh !== channelId) {
      console.log(
        `[MUSIC] Existing player in other channel (have=${lastCh}, want=${channelId}). Moving...`,
      );
      try {
        await s.leaveVoiceChannel(guildId);
      } catch {}
      lastChannelByGuild.delete(guildId);
    } else {
      return existing;
    }
  }

  const shardId = client.guilds.cache.get(guildId)?.shardId ?? 0;
  const opts: VoiceChannelOptions = { guildId, channelId, shardId };

  try {
    const player = await s.joinVoiceChannel(opts);
    lastChannelByGuild.set(guildId, channelId);

    player.once("closed", () => {
      lastChannelByGuild.delete(guildId);
    });

    return player;
  } catch (err: unknown) {
    // If we raced a connection, reuse it.
    const again = node.players.get(guildId);
    if (again) return again;
    throw err;
  }
}

export async function leavePlayer(guildId: string): Promise<void> {
  const s = getShoukaku();
  try {
    await s.leaveVoiceChannel(guildId);
  } finally {
    lastChannelByGuild.delete(guildId);
  }
}
