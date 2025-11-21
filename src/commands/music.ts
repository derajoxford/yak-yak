// src/commands/music.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
} from "discord.js";
import type { Player, Track } from "shoukaku";
import { ensurePlayer, getPlayer, leaveGuild } from "../music/shoukaku.js";

type QueueItem = {
  encoded: string;
  title: string;
  uri: string;
  author: string;
  length: number;
  requesterId: string;
};

const queues = new Map<string, QueueItem[]>();
const nowPlaying = new Map<string, QueueItem | null>();
const hooked = new Set<string>();

function qFor(guildId: string) {
  let q = queues.get(guildId);
  if (!q) {
    q = [];
    queues.set(guildId, q);
  }
  return q;
}

async function forceAudible(player: Player) {
  // These are safe no-ops if already set
  await player.setGlobalVolume(100);
  await player.setPaused(false);
}

async function playNext(guildId: string, player: Player) {
  const q = qFor(guildId);
  const next = q.shift();

  if (!next) {
    nowPlaying.set(guildId, null);
    try { await player.stopTrack(); } catch {}
    return;
  }

  nowPlaying.set(guildId, next);

  await player.playTrack({
    track: { encoded: next.encoded },
  });
  await forceAudible(player);

  console.log(`[MUSIC] Now playing in ${guildId}: ${next.title}`);
}

function hookPlayer(guildId: string, player: Player) {
  if (hooked.has(guildId)) return;
  hooked.add(guildId);

  player.on("start", () => {
    const np = nowPlaying.get(guildId);
    console.log(`[MUSIC] track start: ${np?.title ?? "unknown"}`);
  });

  player.on("end", async () => {
    await playNext(guildId, player).catch((e) =>
      console.error("[MUSIC] playNext(end) err:", e),
    );
  });

  player.on("exception", async (e) => {
    console.error("[MUSIC] track exception:", e);
    await playNext(guildId, player).catch(() => {});
  });

  player.on("stuck", async (e) => {
    console.error("[MUSIC] track stuck:", e);
    await playNext(guildId, player).catch(() => {});
  });
}

function isUrl(s: string) {
  return /^https?:\/\//i.test(s);
}

async function resolveTracks(player: Player, query: string): Promise<Track[]> {
  const node = player.node;
  const search = isUrl(query) ? query : `ytsearch:${query}`;
  const res = await node.rest.resolve(search);

  if (!res || !("loadType" in res)) return [];

  switch (res.loadType) {
    case "track":
      return res.data ? [res.data] : [];
    case "search":
      return res.data ?? [];
    case "playlist":
      return res.data?.tracks ?? [];
    default:
      return [];
  }
}

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Play music in a voice channel via Lavalink")
  .addSubcommand((s) =>
    s.setName("join").setDescription("Join your voice channel"),
  )
  .addSubcommand((s) =>
    s
      .setName("play")
      .setDescription("Search/queue a track or playlist")
      .addStringOption((o) =>
        o
          .setName("query")
          .setDescription("YouTube link or search text")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("skip").setDescription("Skip the current track"),
  )
  .addSubcommand((s) =>
    s.setName("pause").setDescription("Pause playback"),
  )
  .addSubcommand((s) =>
    s.setName("resume").setDescription("Resume playback"),
  )
  .addSubcommand((s) =>
    s.setName("stop").setDescription("Stop and clear queue"),
  )
  .addSubcommand((s) =>
    s.setName("queue").setDescription("Show the queue"),
  )
  .addSubcommand((s) =>
    s.setName("now").setDescription("Show now playing"),
  )
  .addSubcommand((s) =>
    s.setName("leave").setDescription("Leave voice and clear queue"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const member = interaction.member as GuildMember | null;
  const vc = member?.voice?.channel;

  if (!interaction.guildId) {
    await interaction.reply({ content: "❌ Guild only.", ephemeral: true });
    return;
  }

  if (sub !== "queue" && sub !== "now") {
    if (!vc) {
      await interaction.reply({
        content: "❌ You must be in a voice channel.",
        ephemeral: true,
      });
      return;
    }
  }

  const guildId = interaction.guildId;
  const shardId = interaction.guild?.shardId ?? 0;

  if (sub === "join") {
    const player = await ensurePlayer({
      guildId,
      channelId: vc!.id,
      shardId,
    });
    hookPlayer(guildId, player);
    await forceAudible(player);

    await interaction.reply({
      content: "✅ Joined your voice channel.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "play") {
    const query = interaction.options.getString("query", true);

    const player = await ensurePlayer({
      guildId,
      channelId: vc!.id,
      shardId,
    });
    hookPlayer(guildId, player);

    const tracks = await resolveTracks(player, query);
    if (!tracks.length) {
      await interaction.reply({
        content: "❌ No tracks found.",
        ephemeral: true,
      });
      return;
    }

    const q = qFor(guildId);
    for (const t of tracks) {
      q.push({
        encoded: t.encoded,
        title: t.info.title,
        uri: t.info.uri,
        author: t.info.author ?? "Unknown",
        length: t.info.length ?? 0,
        requesterId: interaction.user.id,
      });
    }

    const np = nowPlaying.get(guildId);
    if (!np) {
      await playNext(guildId, player);
    }

    await interaction.reply({
      content: `✅ Queued **${tracks[0].info.title}** — ${tracks.length} track(s).`,
      ephemeral: true,
    });
    return;
  }

  const player = getPlayer(guildId);

  if (sub === "skip") {
    if (!player) {
      await interaction.reply({ content: "❌ Not playing.", ephemeral: true });
      return;
    }
    await player.stopTrack().catch(() => {});
    await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
    return;
  }

  if (sub === "pause") {
    if (!player) {
      await interaction.reply({ content: "❌ Not playing.", ephemeral: true });
      return;
    }
    await player.setPaused(true);
    await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
    return;
  }

  if (sub === "resume") {
    if (!player) {
      await interaction.reply({ content: "❌ Not playing.", ephemeral: true });
      return;
    }
    await player.setPaused(false);
    await forceAudible(player);
    await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
    return;
  }

  if (sub === "stop") {
    if (player) {
      await player.stopTrack().catch(() => {});
    }
    qFor(guildId).length = 0;
    nowPlaying.set(guildId, null);

    await interaction.reply({
      content: "🛑 Stopped and cleared queue.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "queue") {
    const q = qFor(guildId);
    const lines = q.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}`);
    const desc = lines.length ? lines.join("\n") : "Queue empty.";

    const embed = new EmbedBuilder()
      .setTitle("Music Queue")
      .setDescription(desc);

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "now") {
    const np = nowPlaying.get(guildId);
    const embed = new EmbedBuilder()
      .setTitle("Now Playing")
      .setDescription(np ? `**${np.title}**\n${np.uri}` : "Nothing playing.");

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "leave") {
    qFor(guildId).length = 0;
    nowPlaying.set(guildId, null);
    leaveGuild(guildId);

    await interaction.reply({
      content: "👋 Left voice and cleared queue.",
      ephemeral: true,
    });
    return;
  }
}

export async function handleMusicButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const player = getPlayer(guildId);

  const id = interaction.customId;

  try {
    if (id === "music:skip" && player) {
      await player.stopTrack().catch(() => {});
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    }

    if (id === "music:pause" && player) {
      await player.setPaused(true);
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    }

    if (id === "music:resume" && player) {
      await player.setPaused(false);
      await forceAudible(player);
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    }

    if (id === "music:stop") {
      if (player) await player.stopTrack().catch(() => {});
      qFor(guildId).length = 0;
      nowPlaying.set(guildId, null);
      await interaction.reply({ content: "🛑 Stopped.", ephemeral: true });
      return;
    }

    if (id === "music:leave") {
      qFor(guildId).length = 0;
      nowPlaying.set(guildId, null);
      leaveGuild(guildId);
      await interaction.reply({ content: "👋 Left VC.", ephemeral: true });
      return;
    }
  } catch (e) {
    console.error("[MUSIC] button err:", e);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Music action failed.",
        ephemeral: true,
      });
    }
  }
}
