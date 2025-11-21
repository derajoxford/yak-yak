// src/commands/music.ts
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type GuildMember,
} from "discord.js";
import type { Player, Track } from "shoukaku";
import { getShoukaku, joinOrGetPlayer, leavePlayer } from "../music/shoukaku.js";

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Play music in voice via Lavalink")
  .addSubcommand((s) =>
    s.setName("join").setDescription("Join your voice channel"),
  )
  .addSubcommand((s) =>
    s
      .setName("play")
      .setDescription("Play or queue a track")
      .addStringOption((o) =>
        o
          .setName("query")
          .setDescription("YouTube search or URL")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("skip").setDescription("Skip current track"),
  )
  .addSubcommand((s) =>
    s.setName("stop").setDescription("Stop and clear queue"),
  )
  .addSubcommand((s) =>
    s.setName("queue").setDescription("Show queue"),
  )
  .addSubcommand((s) =>
    s.setName("now").setDescription("Show now playing"),
  )
  .addSubcommand((s) =>
    s.setName("leave").setDescription("Leave voice"),
  );

interface QueueItem {
  encoded: string;
  title: string;
  uri?: string;
  author?: string;
  length: number;
  requestedBy: string;
}

const queues = new Map<string, QueueItem[]>();

function getQueue(guildId: string): QueueItem[] {
  const q = queues.get(guildId);
  if (q) return q;
  const fresh: QueueItem[] = [];
  queues.set(guildId, fresh);
  return fresh;
}

async function resolveTracks(node: any, query: string): Promise<Track[]> {
  const identifier =
    query.startsWith("http://") || query.startsWith("https://")
      ? query
      : `ytsearch:${query}`;

  const res = await node.rest.resolve(identifier);

  if (!res || res.loadType === "empty" || res.loadType === "error")
    return [];

  if (res.loadType === "track") return [res.data];

  if (res.loadType === "search") return res.data ?? [];

  if (res.loadType === "playlist") return res.data.tracks ?? [];

  return [];
}

async function playNext(guildId: string, player: Player) {
  const q = getQueue(guildId);
  const next = q.shift();
  queues.set(guildId, q);

  if (!next) {
    await player.stopTrack();
    return null;
  }

  await player.playTrack({ track: next.encoded }, false);
  await player.setGlobalVolume(100);

  return next;
}

function musicControlsRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music:skip")
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("music:queue")
      .setLabel("Queue")
      .setStyle(ButtonStyle.Primary),
  );
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Guild only.", ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const voice = member.voice.channel;
  const guildId = guild.id;
  const shardId = guild.shardId ?? 0;

  const s = getShoukaku(interaction.client);
  const node = s.nodes.get("local") ?? [...s.nodes.values()][0];
  if (!node) {
    await interaction.reply({
      content: "No Lavalink node available.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "join") {
    if (!voice) {
      await interaction.reply({
        content: "Join a voice channel first.",
        ephemeral: true,
      });
      return;
    }

    await joinOrGetPlayer(interaction.client, guildId, voice.id, shardId);
    await interaction.reply({
      content: "✅ Joined your voice channel.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "leave") {
    await leavePlayer(guildId);
    queues.set(guildId, []);
    await interaction.reply({ content: "👋 Left voice.", ephemeral: true });
    return;
  }

  if (sub === "queue") {
    const q = getQueue(guildId);
    const text =
      q.length === 0
        ? "Queue empty."
        : q
            .slice(0, 10)
            .map((t, i) => `${i + 1}. ${t.title}`)
            .join("\n");
    await interaction.reply({ content: text, ephemeral: true });
    return;
  }

  if (sub === "stop") {
    const player = s.players.get(guildId);
    queues.set(guildId, []);
    if (player) await player.stopTrack();
    await interaction.reply({ content: "⏹️ Stopped.", ephemeral: true });
    return;
  }

  if (sub === "skip") {
    const player = s.players.get(guildId);
    if (!player) {
      await interaction.reply({
        content: "Nothing playing.",
        ephemeral: true,
      });
      return;
    }
    await player.stopTrack();
    await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
    return;
  }

  if (sub === "now") {
    const player = s.players.get(guildId);
    const title = player?.track?.info?.title;
    await interaction.reply({
      content: title ? `🎶 Now playing: **${title}**` : "Nothing playing.",
      ephemeral: true,
    });
    return;
  }

  // ---- play ----
  if (!voice) {
    await interaction.reply({
      content: "Join a voice channel first.",
      ephemeral: true,
    });
    return;
  }

  const query = interaction.options.getString("query", true);
  const tracks = await resolveTracks(node, query);

  if (tracks.length === 0) {
    await interaction.reply({
      content: "No results.",
      ephemeral: true,
    });
    return;
  }

  const player = await joinOrGetPlayer(
    interaction.client,
    guildId,
    voice.id,
    shardId,
  );

  const q = getQueue(guildId);
  for (const t of tracks) {
    q.push({
      encoded: t.encoded,
      title: t.info.title,
      uri: t.info.uri,
      author: t.info.author,
      length: t.info.length,
      requestedBy: interaction.user.id,
    });
  }
  queues.set(guildId, q);

  // If nothing currently playing, start immediately
  if (!player.track) {
    const started = await playNext(guildId, player);

    const embed = new EmbedBuilder()
      .setTitle("✅ Now Playing")
      .setDescription(
        started
          ? `**${started.title}**`
          : "Queue empty.",
      );

    await interaction.reply({
      embeds: [embed],
      components: [musicControlsRow()],
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `✅ Queued **${tracks[0].info.title}** (${tracks.length} track(s)).`,
    ephemeral: true,
  });
}

export async function handleMusicButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const guildId = guild.id;
  const s = getShoukaku(interaction.client);
  const player = s.players.get(guildId);

  const id = interaction.customId;

  if (id === "music:queue") {
    const q = getQueue(guildId);
    const text =
      q.length === 0
        ? "Queue empty."
        : q
            .slice(0, 10)
            .map((t, i) => `${i + 1}. ${t.title}`)
            .join("\n");
    await interaction.reply({ content: text, ephemeral: true });
    return;
  }

  if (!player) {
    await interaction.reply({
      content: "No player for this guild.",
      ephemeral: true,
    });
    return;
  }

  if (id === "music:skip") {
    await player.stopTrack();
    await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
    return;
  }

  if (id === "music:stop") {
    queues.set(guildId, []);
    await player.stopTrack();
    await interaction.reply({ content: "⏹️ Stopped.", ephemeral: true });
    return;
  }
}
