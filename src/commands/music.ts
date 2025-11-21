// src/commands/music.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  EmbedBuilder,
  GuildMember,
} from "discord.js";

import {
  initShoukaku,
  joinOrGetPlayer,
  leavePlayer,
  getShoukaku,
} from "../music/shoukaku.js";

type QueueItem = {
  encoded: string;
  title: string;
  uri: string;
  length: number;
  author?: string;
  artworkUrl?: string;
  requesterId: string;
};

const queues = new Map<string, QueueItem[]>();
const nowPlaying = new Map<string, QueueItem | null>();
const listenersInstalled = new Set<string>();

function getQueue(guildId: string): QueueItem[] {
  const q = queues.get(guildId);
  if (q) return q;
  const fresh: QueueItem[] = [];
  queues.set(guildId, fresh);
  return fresh;
}

async function playNext(guildId: string, player: any) {
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
  await player.playTrack({ track: { encoded: next.encoded } });
  await player.setGlobalVolume(100);
  await player.setPaused(false);
}

function installPlayerListeners(guildId: string, player: any) {
  if (listenersInstalled.has(guildId)) return;

  player.on("end", async (evt: any) => {
    if (evt?.reason === "replaced") return;
    try {
      await playNext(guildId, player);
    } catch (e) {
      console.error("[MUSIC] playNext(end) err:", e);
    }
  });

  player.on("exception", async () => {
    try {
      await playNext(guildId, player);
    } catch (e) {
      console.error("[MUSIC] playNext(exception) err:", e);
    }
  });

  player.on("stuck", async () => {
    try {
      await playNext(guildId, player);
    } catch (e) {
      console.error("[MUSIC] playNext(stuck) err:", e);
    }
  });

  listenersInstalled.add(guildId);
}

async function requireVoiceChannel(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as GuildMember | null;
  const voice = member?.voice?.channel;
  if (!voice) {
    await interaction.reply({
      content: "❌ Join a voice channel first.",
      ephemeral: true,
    });
    return null;
  }
  return voice;
}

async function resolveTracks(
  interaction: ChatInputCommandInteraction,
  query: string,
) {
  // shoukaku already initialized in execute()
  const s = getShoukaku();
  const node = s.getIdealNode();
  if (!node) {
    await interaction.reply({
      content: "❌ No Lavalink node available.",
      ephemeral: true,
    });
    return null;
  }

  const result: any = await node.rest.resolve(query);

  if (
    !result ||
    result.loadType === "empty" ||
    result.loadType === "error"
  ) {
    await interaction.reply({
      content: "❌ Nothing found.",
      ephemeral: true,
    });
    return null;
  }

  return result;
}

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Play music in voice")
  .addSubcommand((sc) =>
    sc.setName("join").setDescription("Join your voice channel"),
  )
  .addSubcommand((sc) =>
    sc.setName("leave").setDescription("Leave voice"),
  )
  .addSubcommand((sc) =>
    sc
      .setName("play")
      .setDescription("Search/queue a track or playlist")
      .addStringOption((o) =>
        o.setName("query").setDescription("URL or search text").setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName("skip").setDescription("Skip current track"),
  )
  .addSubcommand((sc) =>
    sc.setName("stop").setDescription("Stop playback and clear queue"),
  )
  .addSubcommand((sc) =>
    sc.setName("pause").setDescription("Pause playback"),
  )
  .addSubcommand((sc) =>
    sc.setName("resume").setDescription("Resume playback"),
  )
  .addSubcommand((sc) =>
    sc.setName("queue").setDescription("Show queue"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;
  if (!guildId) return;

  // ✅ init once per command run
  initShoukaku(interaction.client);

  if (sub === "join") {
    const voice = await requireVoiceChannel(interaction);
    if (!voice) return;

    const player = await joinOrGetPlayer(
      interaction.client,
      guildId,
      voice.id,
    );
    installPlayerListeners(guildId, player);

    await interaction.reply({
      content: "✅ Joined your voice channel.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "leave") {
    await leavePlayer(interaction.client, guildId);
    queues.delete(guildId);
    nowPlaying.delete(guildId);
    listenersInstalled.delete(guildId);

    await interaction.reply({
      content: "✅ Left voice.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "play") {
    const voice = await requireVoiceChannel(interaction);
    if (!voice) return;

    const query = interaction.options.getString("query", true).trim();

    const player = await joinOrGetPlayer(
      interaction.client,
      guildId,
      voice.id,
    );
    installPlayerListeners(guildId, player);

    const result = await resolveTracks(interaction, query);
    if (!result) return;

    const q = getQueue(guildId);

    if (result.loadType === "playlist") {
      for (const t of result.data.tracks) {
        q.push({
          encoded: t.encoded,
          title: t.info.title,
          uri: t.info.uri ?? t.info.identifier ?? "unknown",
          length: t.info.length ?? 0,
          author: t.info.author,
          artworkUrl: t.info.artworkUrl,
          requesterId: interaction.user.id,
        });
      }

      await interaction.reply({
        content: `✅ Queued **${result.data.info.name}** — ${result.data.tracks.length} track(s).`,
        ephemeral: true,
      });
    } else {
      const t = result.data[0] ?? result.data;
      q.push({
        encoded: t.encoded,
        title: t.info.title,
        uri: t.info.uri ?? t.info.identifier ?? "unknown",
        length: t.info.length ?? 0,
        author: t.info.author,
        artworkUrl: t.info.artworkUrl,
        requesterId: interaction.user.id,
      });

      await interaction.reply({
        content: `✅ Queued **${t.info.title}**.`,
        ephemeral: true,
      });
    }

    if (!nowPlaying.get(guildId)) {
      await playNext(guildId, player);
    }

    return;
  }

  // everything below needs an existing player
  const s = getShoukaku();
  const player = s.players.get(guildId);

  if (!player) {
    await interaction.reply({
      content: "❌ Not connected. Use /music join first.",
      ephemeral: true,
    });
    return;
  }

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
    await player.setGlobalVolume(100);
    await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
    return;
  }

  if (sub === "queue") {
    const q = getQueue(guildId);
    const now = nowPlaying.get(guildId);

    const embed = new EmbedBuilder()
      .setTitle("Music Queue")
      .setDescription(
        [
          now ? `**Now:** ${now.title}` : "**Now:** (nothing)",
          "",
          q.length
            ? q.slice(0, 10).map((x, i) => `${i + 1}. ${x.title}`).join("\n")
            : "_Queue empty._",
        ].join("\n"),
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
}

export async function handleMusicButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  if (!guildId) return;

  initShoukaku(interaction.client);
  const s = getShoukaku();
  const player = s.players.get(guildId);

  if (!player) {
    await interaction.reply({
      content: "❌ Not connected.",
      ephemeral: true,
    });
    return;
  }

  const id = interaction.customId;

  try {
    if (id === "music:pause") {
      await player.setPaused(true);
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    }
    if (id === "music:resume") {
      await player.setPaused(false);
      await player.setGlobalVolume(100);
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    }
    if (id === "music:skip") {
      await player.stopTrack();
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    }
    if (id === "music:stop") {
      getQueue(guildId).length = 0;
      nowPlaying.set(guildId, null);
      await player.stopTrack();
      await interaction.reply({ content: "⏹️ Stopped.", ephemeral: true });
      return;
    }

    await interaction.reply({ content: "Unknown button.", ephemeral: true });
  } catch (e) {
    console.error("[MUSIC] button err", e);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Button failed.",
        ephemeral: true,
      });
    }
  }
}
