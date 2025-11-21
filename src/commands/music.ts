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

import {
  initShoukaku,
  getShoukaku,
  joinOrGetPlayer,
  leaveGuild,
} from "../music/shoukaku.js";

import type {
  Track,
  LavalinkResponse,
  SearchResult,
  TrackResult,
  PlaylistResult,
} from "shoukaku";

type QueueItem = {
  encoded: string;
  title: string;
  uri: string;
  author?: string;
  length?: number;
  artworkUrl?: string;
  requesterId: string;
};

const queues = new Map<string, QueueItem[]>();
const boundPlayers = new WeakSet<any>();

function getQueue(guildId: string) {
  let q = queues.get(guildId);
  if (!q) {
    q = [];
    queues.set(guildId, q);
  }
  return q;
}

function tracksFromResult(result: LavalinkResponse | null): Track[] {
  if (!result) return [];

  // v4 returns a discriminated union with data
  switch (result.loadType) {
    case "track":
      return [(result as TrackResult).data];
    case "search":
      return (result as SearchResult).data;
    case "playlist":
      return (result as PlaylistResult).data.tracks;
    default:
      return [];
  }
}

async function playNext(guildId: string, player: any) {
  const q = getQueue(guildId);
  const next = q.shift();
  if (!next) {
    await player.stopTrack().catch(() => {});
    return;
  }

  await player.playTrack({ track: next.encoded });
  await player.setVolume(100).catch(() => {});
}

function bindPlayerOnce(guildId: string, player: any) {
  if (boundPlayers.has(player)) return;
  boundPlayers.add(player);

  player.on("end", async () => {
    try {
      await playNext(guildId, player);
    } catch (e) {
      console.error("[MUSIC] playNext(end) failed:", e);
    }
  });

  player.on("exception", (e: any) => {
    console.error("[MUSIC] Track exception:", e);
  });

  player.on("stuck", (e: any) => {
    console.warn("[MUSIC] Track stuck:", e);
  });
}

async function ensureInVoice(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as GuildMember | null;
  const vc = member?.voice?.channel;

  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: "❌ Must be used in a guild.", ephemeral: true });
    return null;
  }

  if (!vc) {
    await interaction.reply({
      content: "❌ You need to be in a voice channel.",
      ephemeral: true,
    });
    return null;
  }

  // init shoukaku (once)
  initShoukaku(interaction.client);

  const shardId = interaction.guild.shardId ?? 0;

  const player = await joinOrGetPlayer(
    interaction.client,
    interaction.guildId,
    vc.id,
    shardId
  );

  bindPlayerOnce(interaction.guildId, player);

  return { player, vc };
}

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Yak Yak music player")
  .addSubcommand((s) =>
    s.setName("join").setDescription("Join your voice channel")
  )
  .addSubcommand((s) =>
    s
      .setName("play")
      .setDescription("Play or queue a track")
      .addStringOption((o) =>
        o
          .setName("query")
          .setDescription("URL or search text")
          .setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s.setName("skip").setDescription("Skip current track")
  )
  .addSubcommand((s) =>
    s.setName("pause").setDescription("Pause playback")
  )
  .addSubcommand((s) =>
    s.setName("resume").setDescription("Resume playback")
  )
  .addSubcommand((s) =>
    s.setName("stop").setDescription("Stop and clear queue, leave VC")
  )
  .addSubcommand((s) =>
    s.setName("queue").setDescription("Show the queue")
  );

export async function handleMusicButton(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;

  const s = getShoukaku();
  const player = s.players.get(interaction.guildId);

  if (!player) {
    await interaction.reply({ content: "❌ No active player.", ephemeral: true });
    return;
  }

  const action = interaction.customId.split(":")[1];

  try {
    if (action === "skip") {
      await player.stopTrack();
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
    } else if (action === "pause") {
      await player.setPaused(true);
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
    } else if (action === "resume") {
      await player.setPaused(false);
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
    } else if (action === "stop") {
      queues.set(interaction.guildId, []);
      await leaveGuild(interaction.guildId);
      await interaction.reply({ content: "⏹️ Stopped & left VC.", ephemeral: true });
    }
  } catch (e) {
    console.error("[MUSIC] button error:", e);
    await interaction.reply({ content: "❌ Button failed.", ephemeral: true });
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  try {
    if (sub === "join") {
      const joined = await ensureInVoice(interaction);
      if (!joined) return;

      await interaction.reply({
        content: "✅ Joined your voice channel.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "play") {
      const joined = await ensureInVoice(interaction);
      if (!joined) return;

      const { player } = joined;

      const query = interaction.options.getString("query", true).trim();
      const s = getShoukaku();
      const node = s.getNode(); // v4 API

      const identifier =
        query.startsWith("http://") || query.startsWith("https://")
          ? query
          : `ytsearch:${query}`;

      const res = await node.rest.resolve(identifier);
      const tracks = tracksFromResult(res);

      if (!tracks.length) {
        await interaction.reply({
          content: "❌ No results.",
          ephemeral: true,
        });
        return;
      }

      const q = getQueue(guildId);

      for (const t of tracks) {
        q.push({
          encoded: t.encoded,
          title: t.info.title ?? "track",
          uri: t.info.uri ?? "",
          author: t.info.author,
          length: t.info.length,
          artworkUrl: t.info.artworkUrl,
          requesterId: interaction.user.id,
        });
      }

      // If nothing currently playing, start immediately.
      if (!player.data?.track) {
        await playNext(guildId, player);
      }

      await interaction.reply({
        content: `✅ Queued **${tracks[0].info.title ?? "track"}** — ${tracks.length} track(s).`,
        ephemeral: true,
      });

      return;
    }

    // For the rest, we need an existing player
    const s = getShoukaku();
    const player = s.players.get(guildId);

    if (!player) {
      await interaction.reply({
        content: "❌ No active player. Use `/music join` or `/music play` first.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "skip") {
      await player.stopTrack();
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    }

    if (sub === "pause") {
      await player.setPaused(true);
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    }

    if (sub === "resume") {
      await player.setPaused(false);
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    }

    if (sub === "stop") {
      queues.set(guildId, []);
      await leaveGuild(guildId);
      await interaction.reply({ content: "⏹️ Stopped & left VC.", ephemeral: true });
      return;
    }

    if (sub === "queue") {
      const q = getQueue(guildId);
      if (!q.length) {
        await interaction.reply({ content: "Queue empty.", ephemeral: true });
        return;
      }

      const list = q
        .slice(0, 15)
        .map((it, i) => `${i + 1}. ${it.title}`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("Yak Yak Queue")
        .setDescription(list);

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  } catch (err) {
    console.error("[MUSIC] execute crash:", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "Music command crashed. Check logs.",
        ephemeral: true,
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: "Music command crashed. Check logs.",
        ephemeral: true,
      }).catch(() => {});
    }
  }
}
