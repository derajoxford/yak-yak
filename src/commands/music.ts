// src/commands/music.ts
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import {
  LoadType,
  PlayerEventType,
  type Track,
  type Player,
} from "shoukaku";
import {
  getShoukaku,
  getIdealNode,
  joinOrGetPlayer,
  leavePlayer,
} from "../music/shoukaku.js";

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Play music in voice using Lavalink")
  .addSubcommand((s) =>
    s.setName("join").setDescription("Join your voice channel"),
  )
  .addSubcommand((s) =>
    s
      .setName("play")
      .setDescription("Search or play a URL")
      .addStringOption((o) =>
        o
          .setName("query")
          .setDescription("YouTube/URL or search terms")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("skip").setDescription("Skip current track"),
  )
  .addSubcommand((s) =>
    s.setName("stop").setDescription("Stop and clear the queue"),
  )
  .addSubcommand((s) =>
    s.setName("pause").setDescription("Pause playback"),
  )
  .addSubcommand((s) =>
    s.setName("resume").setDescription("Resume playback"),
  )
  .addSubcommand((s) =>
    s.setName("queue").setDescription("Show the queue"),
  )
  .addSubcommand((s) =>
    s
      .setName("volume")
      .setDescription("Set volume (0-200)")
      .addIntegerOption((o) =>
        o
          .setName("amount")
          .setDescription("Volume percent")
          .setMinValue(0)
          .setMaxValue(200)
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("leave").setDescription("Leave voice and clear state"),
  );

interface QueueItem {
  encoded: string;
  title: string;
  uri: string;
  lengthMs: number;
}

const queues = new Map<string, QueueItem[]>();
const nowPlaying = new Map<string, QueueItem | null>();
const boundPlayers = new Set<string>();

function getQueue(guildId: string): QueueItem[] {
  if (!queues.has(guildId)) queues.set(guildId, []);
  return queues.get(guildId)!;
}

function ensurePlayerEvents(player: Player) {
  const gid = player.guildId;
  if (boundPlayers.has(gid)) return;
  boundPlayers.add(gid);

  player.on(PlayerEventType.TRACK_END_EVENT, async (ev: any) => {
    if (
      ev?.reason === "finished" ||
      ev?.reason === "stopped" ||
      ev?.reason === "cleanup"
    ) {
      await playNext(gid, player).catch(() => {});
    }
  });

  player.on(PlayerEventType.TRACK_EXCEPTION_EVENT, async () => {
    await playNext(gid, player).catch(() => {});
  });

  player.on(PlayerEventType.TRACK_STUCK_EVENT, async () => {
    await playNext(gid, player).catch(() => {});
  });
}

async function playNext(guildId: string, player: Player) {
  const q = getQueue(guildId);
  const next = q.shift();
  if (!next) {
    nowPlaying.set(guildId, null);
    try {
      await player.stopTrack();
    } catch {}
    return;
  }

  nowPlaying.set(guildId, next);

  await player.playTrack({ track: next.encoded });
  await player.setVolume(100).catch(() => {});
}

function buildControls(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music:pause")
      .setEmoji("⏸️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:resume")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:skip")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:stop")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger),
  );
}

async function getMemberVoiceChannelId(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<string | null> {
  const member: any = interaction.member;
  const channelId = member?.voice?.channelId;
  return channelId ?? null;
}

async function ensureJoined(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<Player | null> {
  const guildId = interaction.guildId;
  if (!guildId) return null;

  const channelId = await getMemberVoiceChannelId(interaction);
  if (!channelId) return null;

  const shardId = interaction.guild?.shardId ?? 0;

  // Shoukaku must already be initialized in src/index.ts
  getShoukaku();

  const player = await joinOrGetPlayer({ guildId, channelId, shardId });
  ensurePlayerEvents(player);

  return player;
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: "This command only works in a server.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "join") {
    const player = await ensureJoined(interaction);
    if (!player) {
      await interaction.reply({
        content: "Join a voice channel first.",
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({
      content: "✅ Joined your voice channel.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "leave") {
    await leavePlayer(guildId);
    queues.delete(guildId);
    nowPlaying.delete(guildId);
    boundPlayers.delete(guildId);
    await interaction.reply({
      content: "👋 Left voice and cleared queue.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "play") {
    const player = await ensureJoined(interaction);
    if (!player) {
      await interaction.reply({
        content: "Join a voice channel first.",
        ephemeral: true,
      });
      return;
    }

    // Let voice session PATCH settle before starting track.
    await new Promise((r) => setTimeout(r, 500));

    const query = interaction.options.getString("query", true).trim();
    const identifier = /^https?:\/\//i.test(query)
      ? query
      : `ytsearch:${query}`;

    const node = getIdealNode();
    const result = await node.rest.resolve(identifier);

    let tracks: Track[] = [];

    // Shoukaku v4 resolve() returns unions with loadType + data. :contentReference[oaicite:3]{index=3}
    switch (result.loadType) {
      case LoadType.TRACK:
        tracks = [result.data as Track];
        break;
      case LoadType.SEARCH:
        tracks = result.data as Track[];
        break;
      case LoadType.PLAYLIST:
        tracks = (result.data as any).tracks as Track[];
        break;
      case LoadType.EMPTY:
        tracks = [];
        break;
      case LoadType.ERROR:
      default:
        tracks = [];
        break;
    }

    if (!tracks.length) {
      await interaction.reply({ content: "❌ No results.", ephemeral: true });
      return;
    }

    const q = getQueue(guildId);
    for (const t of tracks) {
      q.push({
        encoded: t.encoded,
        title: t.info.title ?? "track",
        uri: t.info.uri ?? "",
        lengthMs: t.info.length ?? 0,
      });
    }

    // If nothing currently playing, start.
    const cur = nowPlaying.get(guildId);
    if (!cur) {
      await playNext(guildId, player);
    }

    const first = tracks[0];
    const playlistCount = tracks.length;

    await interaction.reply({
      content: `✅ Queued **${first.info.title ?? "track"}** — ${playlistCount} track(s).`,
      components: [buildControls()],
      ephemeral: true,
    });
    return;
  }

  // Everything else wants a player already in the guild.
  const s = getShoukaku();
  const player = s.players.get(guildId); // players map moved to shoukaku.players in v4. :contentReference[oaicite:4]{index=4}

  if (!player) {
    await interaction.reply({
      content: "No active player. Use /music join first.",
      ephemeral: true,
    });
    return;
  }
  ensurePlayerEvents(player);

  if (sub === "skip") {
    await player.stopTrack();
    await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
    return;
  }

  if (sub === "stop") {
    getQueue(guildId).length = 0;
    nowPlaying.set(guildId, null);
    await player.stopTrack();
    await interaction.reply({
      content: "⏹️ Stopped and cleared queue.",
      ephemeral: true,
    });
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

  if (sub === "volume") {
    const amount = interaction.options.getInteger("amount", true);
    await player.setVolume(amount);
    await interaction.reply({
      content: `🔊 Volume set to ${amount}%.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === "queue") {
    const q = getQueue(guildId);
    if (!q.length) {
      await interaction.reply({ content: "Queue empty.", ephemeral: true });
      return;
    }

    const lines = q.slice(0, 10).map((it, i) => `${i + 1}. ${it.title}`);
    const embed = new EmbedBuilder()
      .setTitle("Music Queue")
      .setDescription(lines.join("\n"))
      .setFooter({ text: q.length > 10 ? `and ${q.length - 10} more…` : "" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
}

// Button interactions from src/index.ts
export async function handleMusicButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const action = interaction.customId.split(":")[1];
  const guildId = interaction.guildId;
  if (!guildId) return;

  const s = getShoukaku();
  const player = s.players.get(guildId);

  if (!player) {
    await interaction.reply({ content: "No active player.", ephemeral: true });
    return;
  }

  try {
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
        getQueue(guildId).length = 0;
        nowPlaying.set(guildId, null);
        await player.stopTrack();
        await interaction.reply({ content: "⏹️ Stopped.", ephemeral: true });
        return;
      default:
        await interaction.reply({ content: "Unknown action.", ephemeral: true });
        return;
    }
  } catch (err) {
    console.error("[MUSIC] button crash:", err);
    try {
      await interaction.reply({
        content: "Music action failed.",
        ephemeral: true,
      });
    } catch {}
  }
}
