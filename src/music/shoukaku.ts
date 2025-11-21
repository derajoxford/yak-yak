// src/music/shoukaku.ts
import { Shoukaku, Connectors, type NodeOption, type Player } from "shoukaku";
import type { Client } from "discord.js";

let shoukaku: Shoukaku | null = null;

function buildNodes(): NodeOption[] {
  const url = process.env.LAVALINK_URL ?? "localhost:2333";
  const auth = process.env.LAVALINK_PASSWORD;

  if (!auth) {
    throw new Error("LAVALINK_PASSWORD env var missing");
  }

  return [
    {
      name: "local",
      url,          // host:port
      auth,         // password
      secure: false // local http
    }
  ];
}

export function getShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const nodes = buildNodes();
  const connector = new Connectors.DiscordJS(client);

  shoukaku = new Shoukaku(connector, nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5
  });

  // Typed params to satisfy TS strictness
  shoukaku.on("ready", (name: string) => {
    console.log(`[lavalink] node ready: ${name}`);
  });

  shoukaku.on("error", (name: string, err: unknown) => {
    console.error(`[lavalink] node error: ${name}`, err);
  });

  shoukaku.on("close", (name: string, code: number, reason: string) => {
    console.warn(`[lavalink] node closed: ${name} code=${code} reason=${reason}`);
  });

  shoukaku.on("reconnecting", (name: string) => {
    console.warn(`[lavalink] node reconnecting: ${name}`);
  });

  return shoukaku;
}

export async function joinOrGetPlayer(
  client: Client,
  guildId: string,
  channelId: string
): Promise<Player> {
  const s = getShoukaku(client);

  const shardId =
    client.guilds.cache.get(guildId)?.shardId ??
    0;

  const player = await s.joinVoiceChannel({
    guildId,
    channelId,
    shardId,
    deaf: false,
    mute: false
  });

  // Force undeafen/unmute in case Discord marks it “defend”
  try {
    await player.connection.setDeaf(false);
    await player.connection.setMute(false);
  } catch {
    // ignore
  }

  return player;
}

export async function leavePlayer(client: Client, guildId: string): Promise<void> {
  const s = getShoukaku(client);
  await s.leaveVoiceChannel(guildId);
}
