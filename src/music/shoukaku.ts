// src/music/shoukaku.ts
import { Shoukaku, Connectors, type NodeOption, type Player } from "shoukaku";
import type { Client } from "discord.js";

let shoukaku: Shoukaku | null = null;

function mustEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`❌ ${name} env var missing`);
  return v;
}

function buildNodes(): NodeOption[] {
  const host = mustEnv("LAVALINK_HOST", "127.0.0.1");
  const port = Number(mustEnv("LAVALINK_PORT", "2333"));
  const auth = mustEnv("LAVALINK_PASSWORD");

  return [
    {
      name: "local",
      url: `${host}:${port}`,
      auth,
      secure: false,
    },
  ];
}

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const nodes = buildNodes();
  const connector = new Connectors.DiscordJS(client);

  shoukaku = new Shoukaku(connector, nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5,
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
  if (!shoukaku) throw new Error("Shoukaku not initialized yet.");
  return shoukaku;
}

function playerLooksAlive(p: any, wantChannelId: string): boolean {
  const ch = p?.connection?.channelId ?? null; // real VC id per docs
  const connected = Boolean(p?.state?.connected); // Lavalink connected flag
  return ch === wantChannelId && connected;
}

export async function joinOrGetPlayer(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<Player> {
  const s = shoukaku ?? initShoukaku(client);

  const existing = s.players.get(guildId) as any | undefined;
  if (existing) {
    // If it's alive in the same channel, reuse it.
    if (playerLooksAlive(existing, channelId)) {
      return existing as Player;
    }

    // Otherwise it's stale or in wrong channel → nuke it.
    try {
      console.log(
        `[MUSIC] Existing player stale/wrong channel (have=${existing?.connection?.channelId}, want=${channelId}, connected=${existing?.state?.connected}). Leaving...`,
      );
      await s.leaveVoiceChannel(guildId);
    } catch {}
  }

  const shardId = client.guilds.cache.get(guildId)?.shardId ?? 0;

  try {
    const player = await s.joinVoiceChannel({
      guildId,
      channelId,
      shardId,
      deaf: false,
      mute: false,
    });
    return player;
  } catch (err: any) {
    const msg = String(err?.message ?? err);

    // If Shoukaku claims existing connection, force cleanup then rejoin once.
    if (msg.includes("already have an existing connection")) {
      try {
        await s.leaveVoiceChannel(guildId);
      } catch {}
      const player = await s.joinVoiceChannel({
        guildId,
        channelId,
        shardId,
        deaf: false,
        mute: false,
      });
      return player;
    }

    throw err;
  }
}

export async function leavePlayer(
  client: Client,
  guildId: string,
): Promise<void> {
  const s = shoukaku ?? initShoukaku(client);
  try {
    await s.leaveVoiceChannel(guildId);
  } catch {}
}
