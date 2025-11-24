// src/commands/music.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  type ButtonInteraction,
} from "discord.js";
import { type Player } from "shoukaku";
import {
  joinOrGetPlayer,
  leavePlayer,
  resolveTracks,
} from "../music/shoukaku.js";

type QueueItem = {
  encoded: string;
  title: string;
  uri: string;
  length: number;
  author?: string;
  thumbnail?: string;
  requesterId: string;
};

const queues = new Map<string, QueueItem[]>();

function q(guildId: string): QueueItem[] {
  let arr = queues.get(guildId);
  if (!arr) {
    arr = [];
    queues.set(guildId, arr);
  }
  return arr;
}

async function playNext(guildId: string, player: Player) {
  const queue = q(guildId);
  const next = queue.shift();

  if (!next) {
    await player.playTrack({ track: { encoded: null } }).catch(() => {});
    return;
  }

  await player.playTrack({ track: { encoded: next.encoded } });
  await (player as any).setGlobalVolume?.(100).catch(() => {});
}

function attachOnce(guildId: string, player: Player) {
  const pAny = player as any;
  if (pAny.__yak_music_events) return;
  pAny.__yak_music_events = true;

  pAny.on("TrackEndEvent", async (ev: any) => {
    if (ev?.reason === "REPLACED") return;
    await playNext(guildId, player).catch(() => {});
  });

  pAny.on("TrackExceptionEvent", async () => {
    await playNext(guildId, player).catch(() => {});
  });

  pAny.on("TrackStuckEvent", async () => {
    await playNext(guildId, player).catch(() => {});
  });
}

function nowEmbed(player: Player) {
  const cur = (player as any).track;
  const embed = new EmbedBuilder().setTitle("Now Playing");

  if (!cur) {
    embed.setDescription("Nothing playing.");
    return embed;
  }

  const info = cur.info ?? {};
  embed.setDescription(
    `**${info.title ?? "track"}**\nby ${info.author ?? "unknown"}`,
  );

  if (info.uri) embed.addFields({ name: "Link", value: info.uri });
  if (info.length)
    embed.addFields({
      name: "Length",
      value: `${Math.floor(info.length / 1000)}s`,
    });
  if (info.artworkUrl) embed.setThumbnail(info.artworkUrl);

  return embed;
}

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Play music via Lavalink")
  .addSubcommand((sc) =>
    sc.setName("join").setDescription("Join your voice channel"),
  )
  .addSubcommand((sc) =>
    sc
      .setName("play")
      .setDescription("Search or play a URL")
      .addStringOption((o) =>
        o.setName("query").setDescription("Song or URL").setRequired(true),
      ),
  )
  .addSubcommand((sc) => sc.setName("skip").setDescription("Skip current track"))
  .addSubcommand((sc) => sc.setName("pause").setDescription("Pause playback"))
  .addSubcommand((sc) => sc.setName("resume").setDescription("Resume playback"))
  .addSubcommand((sc) =>
    sc.setName("stop").setDescription("Stop and clear queue"),
  )
  .addSubcommand((sc) =>
    sc
      .setName("volume")
      .setDescription("Set volume 0-200")
      .addIntegerOption((o) =>
        o
          .setName("amount")
          .setDescription("Volume")
          .setMinValue(0)
          .setMaxValue(200)
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) => sc.setName("now").setDescription("Show now playing"))
  .addSubcommand((sc) => sc.setName("queue").setDescription("Show queue"))
  .addSubcommand((sc) =>
    sc.setName("leave").setDescription("Leave voice and clear queue"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.guildId) {
    await interaction.reply({ content: "Guild only.", ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand(true);
  const member = await guild.members.fetch(interaction.user.id);
  const vc = member.voice.channel;

  async function requirePlayer(): Promise<Player | null> {
    if (!vc) {
      await interaction.reply({
        content: "Join a voice channel first.",
        ephemeral: true,
      });
      return null;
    }

    // TS doesn't narrow captured vars inside closures reliably.
    const shardId = guild!.shardId ?? 0;

    const player = await joinOrGetPlayer({
      guildId: interaction.guildId!,
      channelId: vc.id,
      shardId,
    });

    attachOnce(interaction.guildId!, player);
    return player;
  }

  try {
    if (sub === "join") {
      const player = await requirePlayer();
      if (!player) return;
      await interaction.reply({
        content: "✅ Joined your voice channel.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "leave") {
      leavePlayer(interaction.guildId!);
      queues.delete(interaction.guildId!);
      await interaction.reply({
        content: "👋 Left voice and cleared queue.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "play") {
      const player = await requirePlayer();
      if (!player) return;

      const query = interaction.options.getString("query", true).trim();
      const identifier = /^https?:\/\//i.test(query)
        ? query
        : `ytsearch:${query}`;

      const { tracks } = await resolveTracks(identifier);

      if (!tracks.length) {
        await interaction.reply({
          content: "❌ No tracks found.",
          ephemeral: true,
        });
        return;
      }

      const queue = q(interaction.guildId!);

      for (const t of tracks as any[]) {
        queue.push({
          encoded: t.encoded,
          title: t.info?.title ?? "track",
          uri: t.info?.uri ?? "",
          length: t.info?.length ?? 0,
          author: t.info?.author,
          thumbnail: t.info?.artworkUrl,
          requesterId: interaction.user.id,
        });
      }

      const cur = (player as any).track;
      if (!cur) {
        await playNext(interaction.guildId!, player);
      }

      const firstTitle = (tracks as any[])[0]?.info?.title ?? "track";
      await interaction.reply({
        content: `✅ Queued **${firstTitle}** — ${tracks.length} track(s).`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "skip") {
      const player = await requirePlayer();
      if (!player) return;
      await playNext(interaction.guildId!, player);
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    }

    if (sub === "pause") {
      const player = await requirePlayer();
      if (!player) return;
      await (player as any).setPaused(true).catch(() => {});
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    }

    if (sub === "resume") {
      const player = await requirePlayer();
      if (!player) return;
      await (player as any).setPaused(false).catch(() => {});
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    }

    if (sub === "stop") {
      const player = await requirePlayer();
      if (!player) return;
      q(interaction.guildId!).length = 0;
      await player.playTrack({ track: { encoded: null } }).catch(() => {});
      await interaction.reply({
        content: "⏹️ Stopped and cleared queue.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "volume") {
      const player = await requirePlayer();
      if (!player) return;
      const amount = interaction.options.getInteger("amount", true);
      await (player as any).setGlobalVolume(amount).catch(() => {});
      await interaction.reply({
        content: `🔊 Volume set to ${amount}.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "now") {
      const player = await requirePlayer();
      if (!player) return;
      await interaction.reply({
        embeds: [nowEmbed(player)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "queue") {
      const queue = q(interaction.guildId!);
      if (!queue.length) {
        await interaction.reply({ content: "Queue empty.", ephemeral: true });
        return;
      }

      const lines = queue
        .slice(0, 15)
        .map((it, i) => `${i + 1}. ${it.title}`);
      await interaction.reply({
        content: `**Queue:**\n${lines.join("\n")}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  } catch (err) {
    console.error("[MUSIC] execute crash:", err);
    if (!interaction.deferred && !interaction.replied) {
      await interaction
        .reply({
          content: "Music command crashed. Check logs.",
          ephemeral: true,
        })
        .catch(() => {});
    }
  }
}

// Button router used by src/index.ts
export async function handleMusicButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const [_, action] = interaction.customId.split(":");
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guildId || !guild) return;

  const member = await guild.members.fetch(interaction.user.id);
  const vc = member.voice.channel;
  if (!vc) {
    await interaction.reply({
      content: "Join a voice channel first.",
      ephemeral: true,
    });
    return;
  }

  const player = await joinOrGetPlayer({
    guildId,
    channelId: vc.id,
    shardId: guild.shardId ?? 0,
  });
  attachOnce(guildId, player);

  switch (action) {
    case "pause":
      await (player as any).setPaused(true).catch(() => {});
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    case "resume":
      await (player as any).setPaused(false).catch(() => {});
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    case "skip":
      await playNext(guildId, player).catch(() => {});
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    case "stop":
      q(guildId).length = 0;
      await player.playTrack({ track: { encoded: null } }).catch(() => {});
      await interaction.reply({ content: "⏹️ Stopped.", ephemeral: true });
      return;
    case "leave":
      leavePlayer(guildId);
      queues.delete(guildId);
      await interaction.reply({ content: "👋 Left voice.", ephemeral: true });
      return;
    default:
      await interaction.reply({ content: "Unknown button.", ephemeral: true });
  }
}
