// src/afterdarkStore.ts
import { promises as fs } from "node:fs";
import path from "node:path";

export type KeywordConfig = {
  content?: string;
  // In future you could add: files?: string[];
};

type GuildStore = Record<string, KeywordConfig>;
type StoreShape = Record<string, GuildStore>;

const DATA_FILE = path.join(process.cwd(), "data", "afterdark_keywords.json");

let store: StoreShape = {};
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;

  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    store = JSON.parse(raw);
  } catch {
    store = {};
  }

  loaded = true;
}

async function save() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

export async function getKeyword(
  guildId: string,
  keyword: string,
): Promise<KeywordConfig | undefined> {
  await ensureLoaded();
  const guild = store[guildId];
  if (!guild) return undefined;
  return guild[keyword];
}

export async function setKeyword(
  guildId: string,
  keyword: string,
  config: KeywordConfig,
): Promise<void> {
  await ensureLoaded();
  if (!store[guildId]) store[guildId] = {};
  store[guildId][keyword] = config;
  await save();
}

export async function deleteKeyword(
  guildId: string,
  keyword: string,
): Promise<boolean> {
  await ensureLoaded();
  const guild = store[guildId];
  if (!guild || !guild[keyword]) return false;
  delete guild[keyword];
  await save();
  return true;
}

export async function listKeywords(guildId: string): Promise<string[]> {
  await ensureLoaded();
  const guild = store[guildId];
  if (!guild) return [];
  return Object.keys(guild);
}
