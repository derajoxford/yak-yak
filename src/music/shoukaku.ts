// src/music/shoukaku.ts
import { Shoukaku, Connectors, type NodeOption } from "shoukaku";
import type { Client } from "discord.js";

let shoukaku: Shoukaku | null = null;

export function getShoukaku(client: Client) {
  if (shoukaku) return shoukaku;

  const pass = process.env.LAVALINK_PASSWORD;
  if (!pass) throw new Error("LAVALINK_PASSWORD env var missing");

  const nodes: NodeOption[] = [
    {
      name: "local",
      url: "127.0.0.1:2333",
      auth: pass,
      secure: false,
    },
  ];

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5,
    restTimeout: 15,
    voiceConnectionTimeout: 15,
  });

  shoukaku.on("ready", (name) => {
    console.log(`[MUSIC] Lavalink node ready: ${name}`);
  });
  shoukaku.on("error", (name, err) => {
    console.error(`[MUSIC] Lavalink node error: ${name}`, err);
  });
  shoukaku.on("close", (name, code, reason) => {
    console.warn(`[MUSIC] Lavalink node closed: ${name} ${code} ${reason}`);
  });
  shoukaku.on("reconnecting", (name) => {
    console.warn(`[MUSIC] Lavalink node reconnecting: ${name}`);
  });

  return shoukaku;
}
