// src/commands/music.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import {
  PlayerEventType,
  type Track,
  type TrackEndEvent,
} from "shoukaku";
import { joinPlayer, leavePlayer, getShoukaku } from "../music/shoukaku.js";

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Play music in voice channels (Lavalink).")
  .addSubcommand((s) =>
    s
      .setName("play")
      .setDescription("Play or queue a track")
      .addStringOption((o) =>
        o
          .setName("query")
          .setDescription("YouTube/Spotify/SoundCloud URL or search text")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName("skip").setDescription("Skip current track"))
  .addSubcommand((s) => s.setName("pause").setDescription("Pause playback"))
  .addSubcommand((s) => s.setName("resume").setDescription("Resume playback"))
  .addSubcommand((s) => s.setName("stop").setDescription("Stop & clear queue"))
  .addSubcommand((s) => s.setName("queue").setDescription("Show queue"))
  .addSubcommand((s) => s.setName("leave").setDescription("Leave voice"));

const queues = new Map<string, Track[]>();
const attachedPlayers = new Set<string>();

function getQueue(guildId: string): Track[] {
  let q = queues.get(guildId);
  if (!q) {
    q = [];
    queues.set(guildId, q);
  }
  return q;
}

async function ensurePlayer(
  interaction: ChatInputCommandInteraction,
) {
  const guild = interaction.guild!;
  const member = await guild.members.fetch(interaction.user.id);
  const voice = member.voice.channel;
  if (!voice) {
    throw new Error("Join a voice channel first.");
  }

  const player = await joinPlayer(interaction.client, voice);

  if (!attachedPlayers.has(player.guildId)) {
    attachedPlayers.add(player.guildId);

    player.on(
      PlayerEventType.TRACK_END_EVENT,
      async (_: TrackEndEvent) => {
        await playNext(player.guildId);
      },
    );

    player.on(
      PlayerEventType.TRACK_EXCEPTION_EVENT,
      async () => {
        await playNext(player.guildId);
      },
    );

    player.on(
      PlayerEventType.TRACK_STUCK_EVENT,
      async () => {
        await playNext(player.guildId);
      },
    );
  }

  return player;
}

async function playNext(guildId: string) {
  const s = getShoukaku();
  const player = s.players.get(guildId);
  if (!player) return;

  const q = getQueue(guildId);
  const next = q.shift();
  if (!next) {
    await player.stopTrack().catch(() => {});
    return;
  }

  await player.playTrack({
    track: { encoded: next.encoded },
  });
}

function nowPlayingEmbed(track: Track | null) {
  if (!track) {
    return new EmbedBuilder()
      .setTitle("Now Playing")
      .setDescription("Nothing playing.");
  }

  const info: any = (track as any).info ?? {};
  return new EmbedBuilder()
    .setTitle("Now Playing")
    .setDescription(`**${info.title ?? "Unknown"}**`)
    .setURL(info.uri ?? undefined)
    .setThumbnail(info.artworkUrl ?? undefined)
    .addFields(
      { name: "Author", value: info.author ?? "Unknown", inline: true },
      {
        name: "Length",
        value: info.length ? `${Math.round(info.length / 1000)}s` : "Unknown",
        inline: true,
      },
    );
}

function musicButtons(paused: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music:pause")
      .setLabel(paused ? "Resume" : "Pause")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:skip")
      .setLabel("Skip")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("music:stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("music:leave")
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  try {
    if (sub === "play") {
      const query = interaction.options.getString("query", true);
      const player = await ensurePlayer(interaction);

      const search =
        query.startsWith("http://") || query.startsWith("https://")
          ? query
          : `ytsearch:${query}`;

      const res = await player.node.rest.resolve(search);
      const tracks = Array.isArray((res as any).data)
        ? ((res as any).data as Track[])
        : [];

      if (tracks.length === 0) {
        await interaction.reply({
          content: "No results.",
          ephemeral: true,
        });
        return;
      }

      const track = tracks[0];
      const q = getQueue(guildId);

      if (!player.track) {
        await player.playTrack({ track: { encoded: track.encoded } });
        await interaction.reply({
          embeds: [nowPlayingEmbed(track)],
          components: [musicButtons(!!player.paused)],
        });
      } else {
        q.push(track);
        const info: any = (track as any).info ?? {};
        await interaction.reply(
          `Queued **${info.title ?? "Unknown"}**. Position: ${q.length}`,
        );
      }
      return;
    }

    if (sub === "skip") {
      const s = getShoukaku();
      const player = s.players.get(guildId);
      if (!player) {
        await interaction.reply({ content: "Not playing.", ephemeral: true });
        return;
      }
      await player.stopTrack();
      await interaction.reply("Skipped.");
      return;
    }

    if (sub === "pause" || sub === "resume") {
      const s = getShoukaku();
      const player = s.players.get(guildId);
      if (!player) {
        await interaction.reply({ content: "Not playing.", ephemeral: true });
        return;
      }
      await player.setPaused(sub === "pause");
      await interaction.reply(sub === "pause" ? "Paused." : "Resumed.");
      return;
    }

    if (sub === "stop") {
      const s = getShoukaku();
      const player = s.players.get(guildId);
      getQueue(guildId).splice(0);
      if (player) await player.stopTrack().catch(() => {});
      await interaction.reply("Stopped and cleared queue.");
      return;
    }

    if (sub === "queue") {
      const s = getShoukaku();
      const player = s.players.get(guildId);
      const q = getQueue(guildId);

      const lines = q.map((t, i) => {
        const info: any = (t as any).info ?? {};
        return `${i + 1}. ${info.title ?? "Unknown"}`;
      });

      const embed = nowPlayingEmbed((player?.track as any) ?? null)
        .addFields({
          name: "Up Next",
          value: lines.join("\n") || "Queue empty.",
        });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === "leave") {
      getQueue(guildId).splice(0);
      await leavePlayer(guildId);
      await interaction.reply("Left voice.");
      return;
    }
  } catch (err: any) {
    await interaction.reply({
      content: String(err?.message ?? err),
      ephemeral: true,
    });
  }
}

export async function handleMusicButton(interaction: ButtonInteraction) {
  const guildId = interaction.guildId!;
  const s = getShoukaku();
  const player = s.players.get(guildId);

  const id = interaction.customId;

  try {
    if (id === "music:pause") {
      if (!player) return interaction.reply({ content: "Not playing.", ephemeral: true });
      const next = !player.paused;
      await player.setPaused(next);
      await interaction.update({
        components: [musicButtons(!!player.paused)],
      });
      return;
    }

    if (id === "music:skip") {
      if (!player) return interaction.reply({ content: "Not playing.", ephemeral: true });
      await player.stopTrack();
      await interaction.reply({ content: "Skipped.", ephemeral: true });
      return;
    }

    if (id === "music:stop") {
      getQueue(guildId).splice(0);
      if (player) await player.stopTrack().catch(() => {});
      await interaction.reply({ content: "Stopped.", ephemeral: true });
      return;
    }

    if (id === "music:leave") {
      getQueue(guildId).splice(0);
      await leavePlayer(guildId);
      await interaction.reply({ content: "Left voice.", ephemeral: true });
      return;
    }
  } catch (err) {
    console.error("music button error", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Music action failed.", ephemeral: true });
    }
  }
}
