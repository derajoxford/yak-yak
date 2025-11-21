// src/music/shoukaku.ts
import type { Client, VoiceBasedChannel } from "discord.js";
import {
  Shoukaku,
  Connectors,
  type NodeOption,
  type ShoukakuOptions,
  type LavalinkPlayerVoiceOptions,
  type Player,
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

  const options: ShoukakuOptions = {
    moveOnDisconnect: false,
    resumable: true,
    resumableTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5,
    restTimeout: 10_000,
  };

  // IMPORTANT: Shoukaku must be created BEFORE client.login()
  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, options);

  shoukaku.on("ready", (name: string) => {
    console.log(`[lavalink] node ready: ${name}`);
  });

  shoukaku.on("error", (name: string, err: unknown) => {
    console.error(`[lavalink] node error: ${name}`, err);
  });

  shoukaku.on("close", (name: string, code: number, reason: string) => {
    console.warn(
      `[lavalink] node closed: ${name} code=${code} reason=${reason}`,
    );
  });

  shoukaku.on("reconnecting", (name: string, attemptsLeft: number) => {
    console.warn(`[lavalink] reconnecting ${name}, left=${attemptsLeft}`);
  });

  return shoukaku;
}

export function getShoukaku(): Shoukaku {
  if (!shoukaku) {
    throw new Error(
      "Shoukaku not initialized. Call initShoukaku(client) before client.login().",
    );
  }
  return shoukaku;
}

export async function joinPlayer(
  client: Client,
  channel: VoiceBasedChannel,
): Promise<Player> {
  const s = shoukaku ?? initShoukaku(client);

  const guildId = channel.guild.id;
  const channelId = channel.id;

  const shardId =
    (channel.guild as any).shardId ??
    (client.shard?.ids?.[0] ?? 0);

  const opts: LavalinkPlayerVoiceOptions = {
    guildId,
    channelId,
    shardId,
    deaf: true,
  };

  const joinOnce = () => s.joinVoiceChannel(opts);

  try {
    return await joinOnce();
  } catch (err: unknown) {
    const msg = String((err as any)?.message ?? err);
    if (msg.toLowerCase().includes("missing session id")) {
      await new Promise((r) => setTimeout(r, 750));
      return await joinOnce();
    }
    throw err;
  }
}

export async function leavePlayer(guildId: string): Promise<void> {
  if (!shoukaku) return;
  await shoukaku.leaveVoiceChannel(guildId).catch(() => {});
}
