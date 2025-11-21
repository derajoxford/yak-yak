// src/commands/music.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  EmbedBuilder,
} from "discord.js";
import {
  initShoukaku,
  getOrCreatePlayer,
  leavePlayer,
  getShoukaku,
} from "../music/shoukaku.js";
import { LoadType, type Track, type VoiceChannelOptions } from "shoukaku";

type QueueItem = {
  track: Track;
  requestedBy: string;
};

const queues = new Map<string, QueueItem[]>();
const listenersBound = new Set<string>();

function getQueue(guildId: string): QueueItem[] {
  let q = queues.get(guildId);
  if (!q) {
    q = [];
    queues.set(guildId, q);
  }
  return q;
}

async function ensurePlayerForInteraction(
  interaction: ChatInputCommandInteraction,
) {
  const guildId = interaction.guildId!;
  const memberVoice = (interaction.member as any)?.voice;
  const channelId: string | null = memberVoice?.channelId ?? null;

  if (!channelId) throw new Error("Join a voice channel first.");

  initShoukaku(interaction.client);

  const shardId = interaction.guild?.shardId ?? 0;

  const opts: VoiceChannelOptions = {
    guildId,
    channelId,
    shardId,
    deaf: true, // ✅ v4 type uses deaf, not deafened
  };

  const player = await getOrCreatePlayer(opts);

  if (!listenersBound.has(guildId)) {
    listenersBound.add(guildId);

    player.on("end", async () => playNext(guildId));
    player.on("exception", async (evt) => {
      console.warn("[music] exception:", evt);
      await playNext(guildId);
    });
    player.on("stuck", async (evt) => {
      console.warn("[music] stuck:", evt);
      await playNext(guildId);
    });
  }

  return { player, guildId, channelId };
}

async function playNext(guildId: string) {
  const sk = getShoukaku();
  const player = sk.players.get(guildId);
  if (!player) return;

  const q = getQueue(guildId);
  const next = q.shift();
  queues.set(guildId, q);

  if (!next) {
    try {
      await player.stopTrack();
      await player.setPaused(true);
    } catch {}
    return;
  }

  await player.playTrack({ track: { encoded: next.track.encoded } });
}

async function resolveTracks(playerNode: any, query: string): Promise<Track[]> {
  const isUrl = /^https?:\/\//i.test(query);
  const search = isUrl ? query : `ytsearch:${query}`;

  const res = await playerNode.rest.resolve(search);

  switch (res.loadType) {
    case LoadType.TRACK:
      return res.data ? [res.data] : [];
    case LoadType.SEARCH:
      return Array.isArray(res.data) ? res.data : [];
    case LoadType.PLAYLIST:
      return Array.isArray(res.data?.tracks) ? res.data.tracks : [];
    default:
      return [];
  }
}

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Play music in voice via Lavalink")
  .addSubcommand((s) =>
    s.setName("join").setDescription("Join your voice channel"),
  )
  .addSubcommand((s) =>
    s
      .setName("play")
      .setDescription("Play a track or add to queue")
      .addStringOption((o) =>
        o
          .setName("query")
          .setDescription("YouTube URL or search text")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName("pause").setDescription("Pause playback"))
  .addSubcommand((s) => s.setName("resume").setDescription("Resume playback"))
  .addSubcommand((s) => s.setName("skip").setDescription("Skip current track"))
  .addSubcommand((s) => s.setName("stop").setDescription("Stop + clear queue"))
  .addSubcommand((s) => s.setName("queue").setDescription("Show queue"))
  .addSubcommand((s) => s.setName("leave").setDescription("Leave voice"));

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  try {
    switch (sub) {
      case "join": {
        await interaction.deferReply({ ephemeral: true });
        await ensurePlayerForInteraction(interaction);
        await interaction.editReply("✅ Joined your voice channel.");
        return;
      }

      case "leave": {
        await interaction.deferReply({ ephemeral: true });
        await leavePlayer(guildId);
        queues.delete(guildId);
        listenersBound.delete(guildId);
        await interaction.editReply("👋 Left voice and cleared queue.");
        return;
      }

      case "play": {
        const query = interaction.options.getString("query", true);
        await interaction.deferReply();

        const { player } = await ensurePlayerForInteraction(interaction);
        const tracks = await resolveTracks(player.node, query);

        if (!tracks.length) {
          await interaction.editReply("❌ No tracks found.");
          return;
        }

        const q = getQueue(guildId);
        for (const t of tracks) {
          q.push({ track: t, requestedBy: interaction.user.id });
        }

        if (!player.track) await playNext(guildId);

        const first = tracks[0];
        const title = first.info?.title ?? "Unknown Track";
        const author = first.info?.author ?? "Unknown Artist";

        await interaction.editReply(
          `✅ Queued **${title}** — *${author}* (${tracks.length} track${
            tracks.length === 1 ? "" : "s"
          })`,
        );
        return;
      }

      case "pause": {
        await interaction.deferReply({ ephemeral: true });
        const player = getShoukaku().players.get(guildId);
        if (!player) {
          await interaction.editReply("❌ Not connected.");
          return;
        }
        await player.setPaused(true);
        await interaction.editReply("⏸️ Paused.");
        return;
      }

      case "resume": {
        await interaction.deferReply({ ephemeral: true });
        const player = getShoukaku().players.get(guildId);
        if (!player) {
          await interaction.editReply("❌ Not connected.");
          return;
        }
        await player.setPaused(false);
        await interaction.editReply("▶️ Resumed.");
        return;
      }

      case "skip": {
        await interaction.deferReply({ ephemeral: true });
        const player = getShoukaku().players.get(guildId);
        if (!player) {
          await interaction.editReply("❌ Not connected.");
          return;
        }
        await player.stopTrack();
        await interaction.editReply("⏭️ Skipped.");
        return;
      }

      case "stop": {
        await interaction.deferReply({ ephemeral: true });
        const player = getShoukaku().players.get(guildId);
        if (!player) {
          await interaction.editReply("❌ Not connected.");
          return;
        }
        queues.set(guildId, []);
        await player.stopTrack();
        await interaction.editReply("🛑 Stopped and cleared queue.");
        return;
      }

      case "queue": {
        const q = getQueue(guildId);
        if (!q.length) {
          await interaction.reply("Queue empty.");
          return;
        }

        const lines = q.slice(0, 10).map((it, i) => {
          const t = it.track.info?.title ?? "Unknown Track";
          return `${i + 1}. ${t}`;
        });

        const embed = new EmbedBuilder()
          .setTitle("🎶 Queue")
          .setDescription(lines.join("\n"));

        await interaction.reply({ embeds: [embed] });
        return;
      }

      default:
        await interaction.reply({
          content: "Unknown subcommand.",
          ephemeral: true,
        });
        return;
    }
  } catch (err: any) {
    const msg = err?.message ?? "Something went wrong in /music.";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: `❌ ${msg}`, ephemeral: true });
    } else {
      await interaction.reply({ content: `❌ ${msg}`, ephemeral: true });
    }
  }
}

// Button handler wired in src/index.ts
export async function handleMusicButton(interaction: ButtonInteraction) {
  const [_, action] = interaction.customId.split(":");
  const guildId = interaction.guildId!;
  const player = getShoukaku().players.get(guildId);

  if (!player) {
    await interaction.reply({ content: "❌ Not connected.", ephemeral: true });
    return;
  }

  switch (action) {
    case "pause":
      await player.setPaused(true);
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    case "resume":
      await player.setPaused(false);
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    case "skip":
      await player.stopTrack();
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    case "stop":
      queues.set(guildId, []);
      await player.stopTrack();
      await interaction.reply({
        content: "🛑 Stopped + cleared queue.",
        ephemeral: true,
      });
      return;
    default:
      await interaction.reply({ content: "Unknown action.", ephemeral: true });
      return;
  }
}
