// src/music/shoukaku.ts
import { Shoukaku, Connectors, type NodeOption, type Player } from "shoukaku";
import type { Client } from "discord.js";

let shoukaku: Shoukaku | null = null;

// Player in v4 doesn't expose channelId, so we track our intended VC per guild.
const lastChannelByGuild = new Map<string, string>();

function buildNodes(): NodeOption[] {
  const auth = process.env.LAVALINK_PASSWORD;
  if (!auth) throw new Error("LAVALINK_PASSWORD env var missing");

  const url = process.env.LAVALINK_URL ?? "127.0.0.1:2333";
  const secure = (process.env.LAVALINK_SECURE ?? "false").toLowerCase() === "true";

  return [
    {
      name: "local",
      url,
      auth,
      secure,
    },
  ];
}

export function initShoukaku(client: Client): Shoukaku {
  if (shoukaku) return shoukaku;

  const nodes = buildNodes();

  shoukaku = new Shoukaku(
    new Connectors.DiscordJS(client),
    nodes,
    {
      // v4 option name is "resume" (not "resumable")
      resume: true,
      resumeTimeout: 60,
      resumeByLibrary: true,
      reconnectTries: 10,
      reconnectInterval: 5,
      restTimeout: 20,
      // pick lowest-penalty node
      nodeResolver: (ns) =>
        [...ns.values()].sort((a, b) => a.penalties - b.penalties)[0],
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
    console.warn(`[MUSIC] Lavalink reconnecting: ${name}`);
  });

  return shoukaku;
}

export function getShoukaku(): Shoukaku {
  if (!shoukaku) {
    throw new Error("Shoukaku not initialized. Call initShoukaku(client) once on startup.");
  }
  return shoukaku;
}

export function getIdealNode() {
  const s = getShoukaku();
  // getIdealNode exists in v4, but fall back to nodeResolver just in case.
  // @ts-ignore
  return (typeof (s as any).getIdealNode === "function"
    ? (s as any).getIdealNode()
    : null) ?? s.options.nodeResolver(s.nodes);
}

export async function joinOrGetPlayer(opts: {
  guildId: string;
  channelId: string;
  shardId: number;
}): Promise<Player> {
  const s = getShoukaku();
  const existing = s.players.get(opts.guildId);
  const haveChan = lastChannelByGuild.get(opts.guildId);

  // If we already intend to be in this VC, reuse the player.
  if (existing && haveChan === opts.channelId) {
    return existing;
  }

  // Otherwise, cleanly leave and rejoin once.
  if (existing) {
    try {
      await s.leaveVoiceChannel(opts.guildId);
    } catch {}
    s.players.delete(opts.guildId);
  }

  lastChannelByGuild.set(opts.guildId, opts.channelId);

  const player = await s.joinVoiceChannel({
    guildId: opts.guildId,
    channelId: opts.channelId,
    shardId: opts.shardId,
  });

  return player;
}

export async function leavePlayer(guildId: string): Promise<void> {
  const s = getShoukaku();
  lastChannelByGuild.delete(guildId);

  if (s.players.has(guildId)) {
    try {
      await s.leaveVoiceChannel(guildId);
    } catch {}
    s.players.delete(guildId);
  }
}
