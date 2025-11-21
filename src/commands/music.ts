// src/commands/music.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type ButtonInteraction,
} from "discord.js";
import {
  joinOrGetPlayer,
  leaveGuild,
  getGuildPlayer,
  getNodeForSearch,
} from "../music/shoukaku.js";

type QueueItem = {
  encoded: string;
  title: string;
  uri: string;
  author?: string;
};

const queues = new Map<string, QueueItem[]>();
const listenersAttached = new Set<string>();

function qFor(guildId: string): QueueItem[] {
  let q = queues.get(guildId);
  if (!q) {
    q = [];
    queues.set(guildId, q);
  }
  return q;
}

async function playNext(guildId: string, player: any): Promise<void> {
  const q = qFor(guildId);
  const next = q.shift();
  if (!next) {
    try {
      await player.stopTrack?.();
    } catch {}
    return;
  }

  try {
    await player.playTrack({ track: { encoded: next.encoded } });
    await player.setGlobalVolume?.(100).catch(() => {});
  } catch (err) {
    console.error("[MUSIC] playNext error:", err);
    // try the next one
    return playNext(guildId, player);
  }
}

function attachPlayerListeners(guildId: string, player: any): void {
  if (listenersAttached.has(guildId)) return;
  listenersAttached.add(guildId);

  // Shoukaku v4 player events are string keys
  player.on?.("end", async () => {
    await playNext(guildId, player);
  });
  player.on?.("exception", async () => {
    await playNext(guildId, player);
  });
  player.on?.("stuck", async () => {
    await playNext(guildId, player);
  });
}

async function ensurePlayer(
  interaction: ChatInputCommandInteraction,
): Promise<{ player: any; channel: any }> {
  const voice = (interaction.member as any)?.voice;
  const channel = voice?.channel;
  if (!channel) throw new Error("Join a voice channel first.");

  const shardId = interaction.guild?.shardId ?? 0;

  const player = await joinOrGetPlayer({
    guildId: interaction.guildId!,
    channelId: channel.id,
    shardId,
  });

  attachPlayerListeners(interaction.guildId!, player as any);

  return { player: player as any, channel };
}

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Play music in voice channels (Lavalink)")
  .addSubcommand((sc) =>
    sc.setName("join").setDescription("Join your voice channel"),
  )
  .addSubcommand((sc) =>
    sc.setName("leave").setDescription("Leave voice and clear queue"),
  )
  .addSubcommand((sc) =>
    sc
      .setName("play")
      .setDescription("Search and queue a track/playlist")
      .addStringOption((o) =>
        o
          .setName("query")
          .setDescription("Song name or URL")
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) => sc.setName("skip").setDescription("Skip current track"))
  .addSubcommand((sc) =>
    sc.setName("pause").setDescription("Pause playback"),
  )
  .addSubcommand((sc) =>
    sc.setName("resume").setDescription("Resume playback"),
  )
  .addSubcommand((sc) =>
    sc
      .setName("volume")
      .setDescription("Set volume 0-150")
      .addIntegerOption((o) =>
        o
          .setName("amount")
          .setDescription("Volume")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(150),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName("queue").setDescription("Show the queue"),
  )
  .addSubcommand((sc) =>
    sc.setName("now").setDescription("Show now playing"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Music only works in servers.",
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === "join") {
      const { channel } = await ensurePlayer(interaction);
      await interaction.reply({
        content: `✅ Joined **${channel.name}**.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "leave") {
      await leaveGuild(interaction.guildId);
      queues.delete(interaction.guildId);
      listenersAttached.delete(interaction.guildId);
      await interaction.reply({
        content: "👋 Left voice and cleared queue.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "play") {
      const query = interaction.options.getString("query", true);
      const { player } = await ensurePlayer(interaction);

      const node = getNodeForSearch();
      const identifier = /^(https?:\/\/)/i.test(query)
        ? query
        : `ytsearch:${query}`;

      const res: any = await node.rest.resolve(identifier);

      let tracks: any[] = [];

      // Lavalink v4 response shapes
      if (res?.loadType === "track" && res.data) {
        tracks = [res.data];
      } else if (res?.loadType === "playlist" && res.data?.tracks) {
        tracks = res.data.tracks;
      } else if (
        (res?.loadType === "search" || res?.loadType === "SEARCH_RESULT") &&
        Array.isArray(res.data)
      ) {
        tracks = res.data;
      } else if (Array.isArray(res?.tracks)) {
        // legacy fallback
        tracks = res.tracks;
      } else if (Array.isArray(res?.data)) {
        tracks = res.data;
      }

      if (!tracks.length) {
        await interaction.reply({
          content: "❌ No tracks found for that query.",
          ephemeral: true,
        });
        return;
      }

      const q = qFor(interaction.guildId);
      for (const t of tracks) {
        const info = t.info ?? {};
        q.push({
          encoded: t.encoded,
          title: info.title ?? "track",
          uri: info.uri ?? info.identifier ?? "",
          author: info.author ?? undefined,
        });
      }

      // If nothing is currently playing, kick off playback
      if (!player.track) {
        await playNext(interaction.guildId, player);
      }

      await interaction.reply({
        content: `✅ Queued **${
          tracks[0].info?.title ?? "track"
        }** — ${tracks.length} track(s).`,
        ephemeral: true,
      });
      return;
    }

    const player = getGuildPlayer(interaction.guildId) as any;
    if (!player) {
      await interaction.reply({
        content: "❌ I'm not in voice. Run `/music join` first.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "skip") {
      await playNext(interaction.guildId, player);
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    }

    if (sub === "pause") {
      await player.setPaused?.(true).catch(() => player.pause?.(true));
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    }

    if (sub === "resume") {
      await player.setPaused?.(false).catch(() => player.pause?.(false));
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    }

    if (sub === "volume") {
      const amount = interaction.options.getInteger("amount", true);
      if (typeof player.setGlobalVolume === "function") {
        await player.setGlobalVolume(amount);
      } else if (typeof player.setVolume === "function") {
        await player.setVolume(amount);
      } else {
        await player.update?.({ volume: amount });
      }

      await interaction.reply({
        content: `🔊 Volume set to ${amount}.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "queue") {
      const q = qFor(interaction.guildId);
      const desc = q.length
        ? q.slice(0, 10).map((it, i) => `${i + 1}. ${it.title}`).join("\n")
        : "Queue empty.";
      const embed = new EmbedBuilder()
        .setTitle("Music Queue")
        .setDescription(desc);

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "now") {
      const cur = player.track?.info?.title ?? "Nothing playing.";
      await interaction.reply({
        content: `🎶 Now playing: **${cur}**`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  } catch (err: any) {
    console.error("[MUSIC] execute crash:", err);

    const msg = err?.message?.includes("existing connection")
      ? "❌ I'm already in voice here. Try `/music leave` then `/music join`."
      : "❌ Music command crashed. Check logs.";

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: msg, ephemeral: true }).catch(
        () => {},
      );
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
}

// Button wiring — keeps your src/index.ts happy
export async function handleMusicButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  const [, action] = interaction.customId.split(":");

  const player = getGuildPlayer(interaction.guildId) as any;
  if (!player) {
    await interaction.reply({
      content: "❌ I'm not in voice.",
      ephemeral: true,
    });
    return;
  }

  try {
    if (action === "skip") {
      await playNext(interaction.guildId, player);
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    }
    if (action === "pause") {
      await player.setPaused?.(true).catch(() => player.pause?.(true));
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    }
    if (action === "resume") {
      await player.setPaused?.(false).catch(() => player.pause?.(false));
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    }
    if (action === "leave") {
      await leaveGuild(interaction.guildId);
      queues.delete(interaction.guildId);
      listenersAttached.delete(interaction.guildId);
      await interaction.reply({
        content: "👋 Left voice and cleared queue.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: "✅", ephemeral: true });
  } catch (e) {
    console.error("[MUSIC] button crash:", e);
    await interaction.reply({
      content: "❌ Button failed. Check logs.",
      ephemeral: true,
    });
  }
}
