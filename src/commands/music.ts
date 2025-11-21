// src/commands/music.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  ChannelType,
  EmbedBuilder,
} from "discord.js";
import type { Player, Track } from "shoukaku";
import { getShoukaku, joinOrGetPlayer, leaveVoiceChannel } from "../music/shoukaku.js";

type QueueItem = {
  encoded: string;
  title: string;
  author: string;
  length: number;
  uri?: string;
  artworkUrl?: string;
  requesterId: string;
};

const queues = new Map<string, QueueItem[]>();
const players = new Map<string, Player>();
const wired = new Set<string>(); // guildIds we've wired events for

function qFor(guildId: string) {
  if (!queues.has(guildId)) queues.set(guildId, []);
  return queues.get(guildId)!;
}

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

async function ensurePlayer(
  interaction: ChatInputCommandInteraction,
): Promise<Player> {
  const guild = interaction.guild;
  if (!guild) throw new Error("Guild missing");

  const member = interaction.member;
  // @ts-ignore - discord.js runtime provides voice
  const vc = member?.voice?.channel;
  if (!vc || vc.type !== ChannelType.GuildVoice) {
    throw new Error("You must be in a voice channel.");
  }

  const player = await joinOrGetPlayer(
    interaction.client,
    guild.id,
    vc.id,
  );
  players.set(guild.id, player);

  if (!wired.has(guild.id)) {
    wired.add(guild.id);

    player.on("end", async () => {
      await playNext(guild.id, interaction.client).catch(() => {});
    });

    player.on("stuck", async () => {
      await playNext(guild.id, interaction.client).catch(() => {});
    });

    player.on("exception", async () => {
      await playNext(guild.id, interaction.client).catch(() => {});
    });
  }

  return player;
}

async function playNext(guildId: string, client: any) {
  const queue = qFor(guildId);
  const next = queue.shift();
  if (!next) {
    const p = players.get(guildId);
    if (p) await p.stopTrack().catch(() => {});
    return;
  }

  const s = getShoukaku(client);
  const player = players.get(guildId) ?? s.players.get(guildId);
  if (!player) return;

  await player.playTrack({ track: { encoded: next.encoded } });
  await player.setGlobalVolume(100);

  console.log(`[MUSIC] Now playing in ${guildId}: ${next.title}`);
}

async function resolveFirstTrack(
  interaction: ChatInputCommandInteraction,
  query: string,
): Promise<Track | null> {
  const s = getShoukaku(interaction.client);
  const node = s.getNode(); // picks best node

  const identifier =
    query.startsWith("http://") || query.startsWith("https://")
      ? query
      : `ytsearch:${query}`;

  const res = await node.rest.resolve(identifier);

  if (!res) return null;

  if (res.loadType === "track" && res.data) return res.data as Track;
  if (res.loadType === "search" && Array.isArray(res.data) && res.data.length)
    return res.data[0] as Track;
  if (res.loadType === "playlist" && res.data?.tracks?.length)
    return res.data.tracks[0] as Track;

  return null;
}

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Yak Yak music player")
  .addSubcommand((s) =>
    s.setName("join").setDescription("Join your voice channel"),
  )
  .addSubcommand((s) =>
    s
      .setName("play")
      .setDescription("Play a song (search or URL)")
      .addStringOption((o) =>
        o.setName("query").setDescription("Search or URL").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("pause").setDescription("Pause"),
  )
  .addSubcommand((s) =>
    s.setName("resume").setDescription("Resume"),
  )
  .addSubcommand((s) =>
    s.setName("skip").setDescription("Skip current"),
  )
  .addSubcommand((s) =>
    s.setName("stop").setDescription("Stop and leave"),
  )
  .addSubcommand((s) =>
    s.setName("queue").setDescription("Show queue"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();

  try {
    if (sub === "join") {
      await ensurePlayer(interaction);
      await interaction.reply({ content: "✅ Joined your voice channel.", ephemeral: true });
      return;
    }

    if (sub === "play") {
      const query = interaction.options.getString("query", true);
      const player = await ensurePlayer(interaction);

      const t = await resolveFirstTrack(interaction, query);
      if (!t) {
        await interaction.reply({ content: "❌ No results.", ephemeral: true });
        return;
      }

      const item: QueueItem = {
        encoded: t.encoded,
        title: t.info.title,
        author: t.info.author,
        length: t.info.length,
        uri: t.info.uri ?? undefined,
        artworkUrl: t.info.artworkUrl ?? undefined,
        requesterId: interaction.user.id,
      };

      const queue = qFor(interaction.guildId!);
      queue.push(item);

      // If nothing currently playing, kick off playback
      const isPlaying = player.track != null;
      if (!isPlaying) {
        await playNext(interaction.guildId!, interaction.client);
      }

      await interaction.reply({
        content: `✅ Queued **${item.title}** — ${queue.length} track(s) in queue.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "pause") {
      const p = players.get(interaction.guildId!);
      if (p) await p.setPaused(true);
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    }

    if (sub === "resume") {
      const p = players.get(interaction.guildId!);
      if (p) await p.setPaused(false);
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    }

    if (sub === "skip") {
      const p = players.get(interaction.guildId!);
      if (p) await p.stopTrack();
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    }

    if (sub === "stop") {
      const gid = interaction.guildId!;
      const p = players.get(gid);
      if (p) await p.stopTrack().catch(() => {});
      queues.set(gid, []);
      players.delete(gid);
      wired.delete(gid);
      await leaveVoiceChannel(gid);
      await interaction.reply({ content: "⏹️ Stopped and left VC.", ephemeral: true });
      return;
    }

    if (sub === "queue") {
      const queue = qFor(interaction.guildId!);
      const lines =
        queue.length === 0
          ? "Queue empty."
          : queue
              .slice(0, 15)
              .map((q, i) => `${i + 1}. **${q.title}** (${fmtMs(q.length)})`)
              .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("Yak Yak Queue")
        .setDescription(lines);

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  } catch (err: any) {
    console.error("[MUSIC] execute crash:", err);
    await interaction.reply({
      content: `❌ ${err?.message ?? "Music command crashed. Check logs."}`,
      ephemeral: true,
    }).catch(() => {});
  }
}

/**
 * Button router (src/index.ts already forwards music:* here)
 */
export async function handleMusicButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const gid = interaction.guildId!;
  const id = interaction.customId;

  try {
    if (id === "music:pause") {
      const p = players.get(gid);
      if (p) await p.setPaused(true);
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
      return;
    }

    if (id === "music:resume") {
      const p = players.get(gid);
      if (p) await p.setPaused(false);
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
      return;
    }

    if (id === "music:skip") {
      const p = players.get(gid);
      if (p) await p.stopTrack();
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
      return;
    }

    if (id === "music:stop") {
      const p = players.get(gid);
      if (p) await p.stopTrack().catch(() => {});
      queues.set(gid, []);
      players.delete(gid);
      wired.delete(gid);
      await leaveVoiceChannel(gid);
      await interaction.reply({ content: "⏹️ Stopped.", ephemeral: true });
      return;
    }

    await interaction.reply({ content: "Unknown music button.", ephemeral: true });
  } catch (err) {
    console.error("[MUSIC] button crash:", err);
    await interaction.reply({ content: "Music button crashed. Check logs.", ephemeral: true }).catch(() => {});
  }
}
