// src/commands/music.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type GuildMember,
} from "discord.js";
import { getShoukaku } from "../music/shoukaku.js";

type QTrack = {
  encoded: string;
  info: {
    title: string;
    uri: string;
    author: string;
    length: number;
  };
  requesterId: string;
};

type LoopMode = "off" | "track" | "queue";

type MusicState = {
  player: any | null;
  queue: QTrack[];
  loop: LoopMode;
  volume: number;
  boundEvents: boolean;
};

const states = new Map<string, MusicState>();

function getState(guildId: string): MusicState {
  let st = states.get(guildId);
  if (!st) {
    st = { player: null, queue: [], loop: "off", volume: 100, boundEvents: false };
    states.set(guildId, st);
  }
  return st;
}

async function ensurePlayer(i: ChatInputCommandInteraction) {
  const guild = i.guild!;
  const member = i.member as GuildMember;
  const vc = member.voice.channel;

  if (!vc) throw new Error("Join a voice channel first.");
  if (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice) {
    throw new Error("That voice channel type isn't supported.");
  }

  const shoukaku = getShoukaku(i.client);
  const st = getState(guild.id);

  if (!st.player || st.player.connection?.channelId !== vc.id) {
    st.player = await shoukaku.joinVoiceChannel({
      guildId: guild.id,
      channelId: vc.id,
      shardId: guild.shardId ?? 0,
    });
    st.boundEvents = false;
  }

  if (!st.boundEvents) {
    st.boundEvents = true;
    st.player.on("end", async () => playNext(guild.id));
    st.player.on("stuck", async () => playNext(guild.id));
    st.player.on("exception", async () => playNext(guild.id));
  }

  return st.player;
}

async function resolveTracks(player: any, queryOrUrl: string) {
  const node = player.node;
  const ident =
    queryOrUrl.startsWith("http://") || queryOrUrl.startsWith("https://")
      ? queryOrUrl
      : `ytsearch:${queryOrUrl}`;

  const res: any = await node.rest.resolve(ident);
  const tracks: any[] = res?.tracks ?? res?.data ?? [];
  return tracks as QTrack[];
}

async function playNext(guildId: string) {
  const st = getState(guildId);
  const player = st.player;
  if (!player) return;

  if (st.loop === "track" && player.track) {
    await player.playTrack({ track: { encoded: player.track.encoded } });
    await player.setGlobalVolume(st.volume);
    return;
  }

  const finished = st.queue.shift();
  if (finished && st.loop === "queue") st.queue.push(finished);

  const next = st.queue[0];
  if (!next) {
    try {
      const shoukaku = getShoukaku(player.node.manager.client);
      shoukaku.leaveVoiceChannel(guildId);
    } catch {}
    st.player = null;
    return;
  }

  await player.playTrack({ track: { encoded: next.encoded } });
  await player.setGlobalVolume(st.volume);
}

function nowPlayingEmbed(track: QTrack, st: MusicState) {
  const durSec = Math.floor(track.info.length / 1000);
  const mins = Math.floor(durSec / 60);
  const secs = String(durSec % 60).padStart(2, "0");

  return new EmbedBuilder()
    .setTitle("🎶 Now Playing")
    .setDescription(`[${track.info.title}](${track.info.uri})`)
    .addFields(
      { name: "By", value: track.info.author || "Unknown", inline: true },
      { name: "Duration", value: `${mins}:${secs}`, inline: true },
      { name: "Loop", value: st.loop === "off" ? "Off" : st.loop, inline: true }
    );
}

function controlsRow(st: MusicState) {
  const paused = !!st.player?.paused;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music:toggle")
      .setLabel(paused ? "Resume" : "Pause")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("music:skip")
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("music:loop")
      .setLabel("Loop")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:queue")
      .setLabel("Queue")
      .setStyle(ButtonStyle.Secondary)
  );
}

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Yak Yak music player")
  .addSubcommand((s) => s.setName("join").setDescription("Join your voice channel"))
  .addSubcommand((s) =>
    s
      .setName("play")
      .setDescription("Play a song or add it to the queue")
      .addStringOption((o) =>
        o.setName("query").setDescription("Song name or URL").setRequired(true)
      )
  )
  .addSubcommand((s) => s.setName("pause").setDescription("Pause playback"))
  .addSubcommand((s) => s.setName("resume").setDescription("Resume playback"))
  .addSubcommand((s) => s.setName("skip").setDescription("Skip current track"))
  .addSubcommand((s) => s.setName("stop").setDescription("Stop and clear the queue"))
  .addSubcommand((s) => s.setName("queue").setDescription("Show the queue"));

export async function execute(i: ChatInputCommandInteraction) {
  const sub = i.options.getSubcommand();
  const guildId = i.guildId!;
  const st = getState(guildId);

  try {
    if (sub === "join") {
      await ensurePlayer(i);
      await i.reply({ content: "✅ Joined your voice channel." });
      return;
    }

    if (sub === "play") {
      const q = i.options.getString("query", true);
      const player = await ensurePlayer(i);
      const tracks = await resolveTracks(player, q);

      if (!tracks.length) {
        await i.reply({ content: "❌ No results." });
        return;
      }

      const picked = tracks[0];
      picked.requesterId = i.user.id;

      st.queue.push(picked);

      if (!player.track) {
        await player.playTrack({ track: { encoded: picked.encoded } });
        await player.setGlobalVolume(st.volume);
      }

      const emb = nowPlayingEmbed(picked, st);
      await i.reply({ embeds: [emb], components: [controlsRow(st)] });
      return;
    }

    if (sub === "pause") {
      const player = await ensurePlayer(i);
      await player.setPaused(true);
      await i.reply({ content: "⏸️ Paused." });
      return;
    }

    if (sub === "resume") {
      const player = await ensurePlayer(i);
      await player.setPaused(false);
      await i.reply({ content: "▶️ Resumed." });
      return;
    }

    if (sub === "skip") {
      const player = await ensurePlayer(i);
      await player.stopTrack();
      await i.reply({ content: "⏭️ Skipped." });
      return;
    }

    if (sub === "stop") {
      if (st.player) {
        st.queue = [];
        await st.player.stopTrack();
        getShoukaku(i.client).leaveVoiceChannel(guildId);
        st.player = null;
      }
      await i.reply({ content: "⏹️ Stopped and cleared queue." });
      return;
    }

    if (sub === "queue") {
      if (!st.queue.length) {
        await i.reply({ content: "Queue is empty." });
        return;
      }
      const lines = st.queue.slice(0, 10).map((t, idx) => {
        const by = t.info.author ? ` — ${t.info.author}` : "";
        return `${idx + 1}. ${t.info.title}${by}`;
      });

      await i.reply({
        embeds: [new EmbedBuilder().setTitle("📜 Queue").setDescription(lines.join("\n"))],
      });
      return;
    }
  } catch (err: any) {
    await i.reply({
      content: `❌ ${err?.message ?? "Something went wrong."}`,
      ephemeral: true,
    });
  }
}

export async function handleMusicButton(i: ButtonInteraction) {
  const guildId = i.guildId!;
  const st = getState(guildId);
  const player = st.player;
  if (!player) {
    await i.reply({ content: "Nothing playing.", ephemeral: true });
    return;
  }

  const id = i.customId;

  if (id === "music:toggle") {
    await player.setPaused(!player.paused);
    await i.deferUpdate();
    return;
  }

  if (id === "music:skip") {
    await player.stopTrack();
    await i.deferUpdate();
    return;
  }

  if (id === "music:stop") {
    st.queue = [];
    await player.stopTrack();
    getShoukaku(i.client).leaveVoiceChannel(guildId);
    st.player = null;
    await i.deferUpdate();
    return;
  }

  if (id === "music:loop") {
    st.loop = st.loop === "off" ? "track" : st.loop === "track" ? "queue" : "off";
    await i.reply({ content: `🔁 Loop set to **${st.loop}**.`, ephemeral: true });
    return;
  }

  if (id === "music:queue") {
    const lines = st.queue.slice(0, 10).map((t, idx) => {
      const by = t.info.author ? ` — ${t.info.author}` : "";
      return `${idx + 1}. ${t.info.title}${by}`;
    });
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📜 Queue")
          .setDescription(lines.join("\n") || "Queue empty."),
      ],
      ephemeral: true,
    });
  }
}
