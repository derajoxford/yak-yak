// src/music/shoukaku.ts
import type { Client } from "discord.js";
import {
  Shoukaku,
  Connectors,
  type NodeOption,
  type Player,
  type VoiceChannelOptions,
  type ShoukakuEvents,
} from "shoukaku";

let shoukaku: Shoukaku | null = null;

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

  shoukaku = new Shoukaku(
    new Connectors.DiscordJS(client),
    nodes,
    {} // keep options minimal to satisfy v4 types
  );

  // Use `as any` on event names to avoid TS mismatches across minor versions
  shoukaku.on("ready" as any, (name: string) => {
    console.log(`[lavalink] node ready: ${name}`);
  });
  shoukaku.on("error" as any, (name: string, err: unknown) => {
    console.error(`[lavalink] node error: ${name}`, err);
  });
  shoukaku.on("close" as any, (name: string, code: number, reason: string) => {
    console.warn(`[lavalink] node closed: ${name} (${code}) ${reason}`);
  });
  shoukaku.on("reconnecting" as any, (name: string) => {
    console.warn(`[lavalink] reconnecting: ${name}`);
  });

  return shoukaku;
}

export function getShoukaku(): Shoukaku {
  if (!shoukaku) {
    throw new Error(
      "Shoukaku not initialized yet. Call initShoukaku(client) on startup."
    );
  }
  return shoukaku;
}

// Main helper: join if needed, otherwise reuse.
// If already connected to a *different* VC, leave first then rejoin.
// This fixes: "This guild already have an existing connection".
export async function getOrCreatePlayer(
  opts: VoiceChannelOptions
): Promise<Player> {
  const sk = getShoukaku();

  const existingConn = sk.connections.get(opts.guildId);
  const existingPlayer = sk.players.get(opts.guildId);

  if (existingConn && existingPlayer) {
    if (existingConn.channelId === opts.channelId) {
      return existingPlayer;
    }

    // different channel => drop old connection first
    await sk.leaveVoiceChannel(opts.guildId).catch(() => {});
  }

  return sk.joinVoiceChannel(opts);
}

export async function leavePlayer(guildId: string): Promise<void> {
  const sk = getShoukaku();
  await sk.leaveVoiceChannel(guildId).catch(() => {});
}
