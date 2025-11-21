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

  return [{ name: "local", url: `${host}:${port}`, auth, secure: false }];
}

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const connector = new Connectors.DiscordJS(client);
  shoukaku = new Shoukaku(connector, buildNodes(), {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5,
  });

  shoukaku.on("ready", (name: string) =>
    console.log(`[MUSIC] Lavalink node ready: ${name}`),
  );
  shoukaku.on("error", (name: string, err: unknown) =>
    console.error(`[MUSIC] Lavalink node error: ${name}`, err),
  );
  shoukaku.on("close", (name: string, code: number, reason: string) =>
    console.warn(`[MUSIC] Lavalink node closed: ${name} code=${code} reason=${reason}`),
  );
  shoukaku.on("reconnecting", (name: string) =>
    console.warn(`[MUSIC] Lavalink node reconnecting: ${name}`),
  );

  return shoukaku;
}

export function getShoukaku(): Shoukaku {
  if (!shoukaku) throw new Error("Shoukaku not initialized yet.");
  return shoukaku;
}

function playerLooksAlive(p: any, wantChannelId: string): boolean {
  const ch = p?.connection?.channelId ?? null;
  const connected = Boolean(p?.state?.connected);
  return ch === wantChannelId && connected;
}

async function clearDiscordVoiceFlags(client: Client, guildId: string) {
  const g = client.guilds.cache.get(guildId);
  const me = g?.members.me;
  const v = me?.voice;
  if (!v) return;

  // log current flags so we can see what's happening
  console.log(
    `[MUSIC] voice flags before clear: channel=${v.channelId} selfMute=${v.selfMute} serverMute=${v.serverMute} selfDeaf=${v.selfDeaf} serverDeaf=${v.serverDeaf} suppress=${v.suppress}`,
  );

  // These require Mute/Deafen Members perms; you have admin so it should work.
  if (v.selfMute || v.serverMute) {
    await v.setMute(false).catch(() => {});
  }
  if (v.selfDeaf || v.serverDeaf) {
    await v.setDeaf(false).catch(() => {});
  }
  if (v.suppress) {
    await v.setSuppressed(false).catch(() => {});
  }

  const v2 = me.voice;
  console.log(
    `[MUSIC] voice flags after clear: channel=${v2.channelId} selfMute=${v2.selfMute} serverMute=${v2.serverMute} selfDeaf=${v2.selfDeaf} serverDeaf=${v2.serverDeaf} suppress=${v2.suppress}`,
  );
}

export async function joinOrGetPlayer(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<Player> {
  const s = shoukaku ?? initShoukaku(client);

  const existing = s.players.get(guildId) as any | undefined;
  if (existing) {
    if (playerLooksAlive(existing, channelId)) {
      await clearDiscordVoiceFlags(client, guildId);
      return existing as Player;
    }
    try {
      console.log(
        `[MUSIC] Existing player stale/wrong channel (have=${existing?.connection?.channelId}, want=${channelId}, connected=${existing?.state?.connected}). Leaving...`,
      );
      await s.leaveVoiceChannel(guildId);
    } catch {}
  }

  const shardId = client.guilds.cache.get(guildId)?.shardId ?? 0;
  let player: Player;

  try {
    player = await s.joinVoiceChannel({
      guildId,
      channelId,
      shardId,
      deaf: false,
      mute: false,
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("already have an existing connection")) {
      try {
        await s.leaveVoiceChannel(guildId);
      } catch {}
      player = await s.joinVoiceChannel({
        guildId,
        channelId,
        shardId,
        deaf: false,
        mute: false,
      });
    } else {
      throw err;
    }
  }

  await clearDiscordVoiceFlags(client, guildId);
  return player!;
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
