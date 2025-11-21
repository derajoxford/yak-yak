// src/music/shoukaku.ts
import { Shoukaku, Connectors, type NodeOption, type Player } from "shoukaku";
import type { Client } from "discord.js";

let shoukaku: Shoukaku | null = null;

type GuildPlayerState = {
  player: Player;
  channelId: string;
};

const guildPlayers = new Map<string, GuildPlayerState>();

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const nodes: NodeOption[] = [
    {
      name: "local",
      url: process.env.LAVALINK_URL ?? "127.0.0.1:2333",
      auth: process.env.LAVALINK_PASSWORD ?? "youshallnotpass",
      secure: false,
    },
  ];

  // Shoukaku v4 options
  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 2,
    restTimeout: 10000,
  } as any);

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
  if (!shoukaku) throw new Error("Shoukaku not initialized yet");
  return shoukaku;
}

function pickNode(s: Shoukaku): any {
  const nodesMap: Map<string, any> = (s as any).nodes;
  if (!nodesMap || nodesMap.size === 0) {
    throw new Error("No Lavalink nodes available");
  }

  // Prefer a connected node if possible
  for (const n of nodesMap.values()) {
    if (n?.state === 2 || n?.state === "CONNECTED") return n;
  }

  return nodesMap.values().next().value;
}

export function getNodeForSearch(): any {
  const s = getShoukaku();
  return pickNode(s);
}

export function getGuildPlayer(guildId: string): Player | null {
  return guildPlayers.get(guildId)?.player ?? null;
}

export async function joinOrGetPlayer(opts: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  const s = getShoukaku();

  const existing = guildPlayers.get(opts.guildId);
  if (existing) {
    // Same channel? reuse.
    if (existing.channelId === opts.channelId) return existing.player;

    // Different channel → cleanly destroy and rejoin.
    try {
      await (existing.player as any).leaveVoiceChannel?.();
    } catch {}
    try {
      existing.player.destroy();
    } catch {}

    guildPlayers.delete(opts.guildId);
  }

  const player = await s.joinVoiceChannel({
    guildId: opts.guildId,
    channelId: opts.channelId,
    shardId: opts.shardId,
    deaf: false,
  } as any);

  guildPlayers.set(opts.guildId, {
    player,
    channelId: opts.channelId,
  });

  // Default volume (v4 = setGlobalVolume)
  try {
    const ap = player as any;
    if (typeof ap.setGlobalVolume === "function") {
      await ap.setGlobalVolume(100);
    } else if (typeof ap.setVolume === "function") {
      await ap.setVolume(100);
    } else if (typeof ap.update === "function") {
      await ap.update({ volume: 100 });
    }
  } catch {}

  return player;
}

export async function leaveGuild(guildId: string): Promise<void> {
  const st = guildPlayers.get(guildId);
  if (!st) return;

  try {
    await (st.player as any).leaveVoiceChannel?.();
  } catch {}
  try {
    st.player.destroy();
  } catch {}

  guildPlayers.delete(guildId);
}
