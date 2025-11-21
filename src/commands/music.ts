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
import type { Node, Player, Track } from "shoukaku";
import {
  getShoukaku,
  joinOrGetPlayer,
  leavePlayer,
} from "../music/shoukaku.js";

interface QueueItem {
  encoded: string;
  title: string;
  uri: string;
  length: number;
  requesterId: string;
}

const queues = new Map<string, QueueItem[]>();
const playing = new Map<string, boolean>();
const listenersInstalled = new Set<string>();

function getQueue(guildId: string): QueueItem[] {
  let q = queues.get(guildId);
  if (!q) {
    q = [];
    queues.set(guildId, q);
  }
  return q;
}

function getUserVoiceChannelId(
  interaction: ChatInputCommandInteraction,
): string | null {
  const member = interaction.member as GuildMember | null;
  const vc = member?.voice?.channel;
  return vc?.id ?? null;
}

function pickNode(): Node {
  const s = getShoukaku();
  const node =
    s.options.nodeResolver?.(s.nodes) ?? [...s.nodes.values()][0];
  if (!node) throw new Error("No Lavalink node available");
  return node;
}

async function playNext(
  guildId: string,
  player: Player,
  node: Node,
): Promise<void> {
  const q = getQueue(guildId);
  const next = q.shift();
  queues.set(guildId, q);

  if (!next) {
    playing.set(guildId, false);
    return;
  }

  playing.set(guildId, true);

  await player.playTrack({ track: { encoded: next.encoded } });
  await player.setGlobalVolume(100);

  console.log(`[MUSIC] Now playing in ${guildId}: ${next.title}`);
}

function installListenersOnce(guildId: string, player: Player, node: Node) {
  if (listenersInstalled.has(guildId)) return;

  listenersInstalled.add(guildId);

  player.on("end", async () => {
    try {
      await playNext(guildId, player, node);
    } catch (err) {
      console.error("[MUSIC] playNext on end failed:", err);
      playing.set(guildId, false);
    }
  });

  player.on("exception", async (data: any) => {
    console.error("[MUSIC] Track exception:", data);
    try {
      await playNext(guildId, player, node);
    } catch {}
  });

  player.on("stuck", async (data: any) => {
    console.warn("[MUSIC] Track stuck:", data);
    try {
      await playNext(guildId, player, node);
    } catch {}
  });

  player.on("closed", () => {
    listenersInstalled.delete(guildId);
    playing.set(guildId, false);
  });
}

async function ensurePlayerAndNode(
  interaction: ChatInputCommandInteraction,
): Promise<{ player: Player; node: Node; channelId: string }> {
  const guildId = interaction.guildId!;
  const channelId = getUserVoiceChannelId(interaction);
  if (!channelId) {
    throw new Error("Join a voice channel first.");
  }

  const player = await joinOrGetPlayer(
    interaction.client,
    guildId,
    channelId,
  );
  const node = pickNode();

  installListenersOnce(guildId, player, node);

  return { player, node, channelId };
}

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Music playback (Lavalink)")
  .addSubcommand((s) =>
    s.setName("join").setDescription("Join your voice channel"),
  )
  .addSubcommand((s) =>
    s
      .setName("play")
      .setDescription("Search/queue a track")
      .addStringOption((o) =>
        o
          .setName("query")
          .setDescription("YouTube URL or search terms")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("pause").setDescription("Pause playback"),
  )
  .addSubcommand((s) =>
    s.setName("resume").setDescription("Resume playback"),
  )
  .addSubcommand((s) =>
    s.setName("skip").setDescription("Skip current track"),
  )
  .addSubcommand((s) =>
    s.setName("stop").setDescription("Stop & clear queue"),
  )
  .addSubcommand((s) =>
    s.setName("leave").setDescription("Leave voice channel"),
  )
  .addSubcommand((s) =>
    s.setName("queue").setDescription("Show queue"),
  )
  .addSubcommand((s) =>
    s
      .setName("volume")
      .setDescription("Set volume 0-200")
      .addIntegerOption((o) =>
        o
          .setName("value")
          .setDescription("Volume percent")
          .setMinValue(0)
          .setMaxValue(200)
          .setRequired(true),
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  try {
    if (sub === "join") {
      await ensurePlayerAndNode(interaction);
      await interaction.reply({
        content: "✅ Joined your voice channel.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "leave") {
      await leavePlayer(guildId);
      await interaction.reply({
        content: "👋 Left the voice channel.",
        ephemeral: true,
      });
      return;
    }

    const { player, node } = await ensurePlayerAndNode(interaction);

    if (sub === "play") {
      const query = interaction.options.getString("query", true).trim();
      const identifier =
        query.startsWith("http://") || query.startsWith("https://")
          ? query
          : `ytsearch:${query}`;

      const result = await node.rest.resolve(identifier); // v4 common usage :contentReference[oaicite:3]{index=3}
      if (!result || !result.tracks.length) {
        await interaction.reply({
          content: "❌ No tracks found.",
          ephemeral: true,
        });
        return;
      }

      const q = getQueue(guildId);

      // If playlist/search, enqueue all tracks
      for (const t of result.tracks) {
        const title = t.info.title ?? "Unknown title";
        const uri = t.info.uri ?? "";
        q.push({
          encoded: t.encoded,
          title,
          uri,
          length: t.info.length ?? 0,
          requesterId: interaction.user.id,
        });
      }

      queues.set(guildId, q);

      if (!playing.get(guildId)) {
        await playNext(guildId, player, node);
      }

      await interaction.reply({
        content: `✅ Queued **${result.tracks[0].info.title ?? "track"}** (${result.tracks.length} track(s)).`,
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

    if (sub === "skip") {
      await player.stopTrack();
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    }

    if (sub === "stop") {
      queues.set(guildId, []);
      playing.set(guildId, false);
      await player.stopTrack();
      await interaction.reply({
        content: "🛑 Stopped & cleared queue.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "volume") {
      const v = interaction.options.getInteger("value", true);
      await player.setGlobalVolume(v);
      await interaction.reply({
        content: `🔊 Volume set to ${v}%.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "queue") {
      const q = getQueue(guildId);
      const desc =
        q.length === 0
          ? "Queue empty."
          : q
              .slice(0, 20)
              .map((it, i) => `${i + 1}. ${it.title}`)
              .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("Music Queue")
        .setDescription(desc);

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  } catch (err: any) {
    console.error("[MUSIC] execute crash:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ ${err?.message ?? "Music command crashed. Check logs."}`,
        ephemeral: true,
      });
    }
  }
}

// Minimal button handler (index.ts calls this)
export async function handleMusicButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const s = getShoukaku();
  const node =
    s.options.nodeResolver?.(s.nodes) ?? [...s.nodes.values()][0];
  if (!node) {
    await interaction.reply({ content: "❌ No Lavalink node.", ephemeral: true });
    return;
  }

  const player = node.players.get(guildId);
  if (!player) {
    await interaction.reply({ content: "❌ Not in voice.", ephemeral: true });
    return;
  }

  const action = interaction.customId.split(":")[1];

  try {
    if (action === "pause") await player.setPaused(true);
    if (action === "resume") await player.setPaused(false);
    if (action === "skip") await player.stopTrack();
    if (action === "stop") {
      queues.set(guildId, []);
      playing.set(guildId, false);
      await player.stopTrack();
    }
    if (action === "leave") await leavePlayer(guildId);

    await interaction.reply({ content: "✅", ephemeral: true });
  } catch (err) {
    console.error("[MUSIC] button crash:", err);
    await interaction.reply({
      content: "❌ Music button failed.",
      ephemeral: true,
    });
  }
}
