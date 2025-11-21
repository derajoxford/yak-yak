// src/music/shoukaku.ts
import { Shoukaku, Connectors, type NodeOption } from "shoukaku";
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

// force self mute/deafen OFF if the runtime exposes connection
function forceUnmute(player: any) {
  try {
    const conn = player?.connection;
    if (conn?.setMute) conn.setMute(false);
    if (conn?.setDeaf) conn.setDeaf(false);
  } catch {}
}

export async function joinOrGetPlayer(
  client: Client,
  guildId: string,
  channelId: string,
) {
  const s = shoukaku ?? initShoukaku(client);

  const existing = s.players.get(guildId) as any | undefined;
  if (existing) {
    // If already connected somewhere else, hard leave then rejoin
    const existingChannelId =
      existing?.connection?.channelId ??
      existing?.channelId ??
      null;

    if (existingChannelId && existingChannelId !== channelId) {
      try {
        await s.leaveVoiceChannel(guildId);
      } catch {}
    } else {
      // same channel: just make sure we're not muted/deafened
      forceUnmute(existing);
      return existing;
    }
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
    forceUnmute(player as any);
    return player;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("already have an existing connection")) {
      const again = s.players.get(guildId) as any | undefined;
      if (again) {
        forceUnmute(again);
        return again;
      }
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
