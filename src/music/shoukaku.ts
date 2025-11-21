// src/music/shoukaku.ts
import { Shoukaku, Connectors, type NodeOption, type Player } from "shoukaku";
import type { Client } from "discord.js";

let shoukaku: Shoukaku | null = null;

// We track which VC a guild's player is supposed to be in.
// (Player in v4 doesn't expose channelId.)
const playerChannel = new Map<string, string>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForConnected(player: Player, tries = 12, stepMs = 500) {
  for (let i = 0; i < tries; i++) {
    if (player.data?.state?.connected) return true;
    await sleep(stepMs);
  }
  return false;
}

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const pass = process.env.LAVALINK_PASSWORD;
  if (!pass) {
    throw new Error("LAVALINK_PASSWORD env var missing");
  }

  const nodes: NodeOption[] = [
    {
      name: "local",
      url: "127.0.0.1:2333",
      auth: pass,
      secure: false,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    // v4 option names
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5,
  });

  // typed event params to avoid implicit any
  shoukaku.on("ready", (name: string) => {
    console.log(`[MUSIC] Lavalink node ready: ${name}`);
  });

  shoukaku.on("error", (name: string, err: Error) => {
    console.error(`[MUSIC] Lavalink node error: ${name}`, err);
  });

  shoukaku.on("close", (name: string, code: number, reason: string) => {
    console.warn(`[MUSIC] Lavalink node close: ${name} code=${code} reason=${reason}`);
  });

  shoukaku.on("reconnecting", (name: string) => {
    console.warn(`[MUSIC] Lavalink node reconnecting: ${name}`);
  });

  return shoukaku;
}

// Keep signature flexible so calls with/without client don't explode
export function getShoukaku(_client?: Client): Shoukaku {
  if (!shoukaku) {
    throw new Error("Shoukaku not initialized. Call initShoukaku(client) first.");
  }
  return shoukaku;
}

export function getPlayerChannel(guildId: string): string | undefined {
  return playerChannel.get(guildId);
}

export async function leaveGuild(guildId: string): Promise<void> {
  if (!shoukaku) return;
  try {
    await shoukaku.leaveVoiceChannel(guildId);
  } catch {}
  shoukaku.players.delete(guildId);
  playerChannel.delete(guildId);
}

export async function joinOrGetPlayer(
  client: Client,
  guildId: string,
  channelId: string,
  shardId: number
): Promise<Player> {
  const s = shoukaku ?? initShoukaku(client);

  const existing = s.players.get(guildId);
  const existingChan = playerChannel.get(guildId);

  if (existing) {
    const connected = existing.data?.state?.connected;
    const wrongChan = existingChan && existingChan !== channelId;

    // If stale, disconnected, or wrong channel => leave first
    if (!connected || wrongChan) {
      console.log(
        `[MUSIC] Existing player stale/wrong channel (have=${existingChan}, want=${channelId}, connected=${connected}). Leaving...`
      );
      await leaveGuild(guildId);
    } else {
      // good existing player
      return existing;
    }
  }

  const player = await s.joinVoiceChannel({
    guildId,
    channelId,
    shardId,
  });

  playerChannel.set(guildId, channelId);

  // Wait for Discord UDP/WebSocket to be up before play()
  await waitForConnected(player);

  return player;
}
