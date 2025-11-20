// src/afterdarkStore.ts
import { promises as fs } from "node:fs";
import path from "node:path";

type StoreShape = Record<string, Record<string, string[]>>;
// guildId -> keyword -> [messageContent]

const DATA_FILE = path.join(process.cwd(), "data", "afterdark_keywords.json");

let store: StoreShape = {};
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;

  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    store = JSON.parse(raw) as StoreShape;
  } catch {
    store = {};
  }

  loaded = true;
}

async function save() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

/**
 * Add a new content entry to a keyword's pool for this guild.
 */
export async function addKeywordContent(
  guildId: string,
  keyword: string,
  content: string,
): Promise<void> {
  await ensureLoaded();

  if (!store[guildId]) {
    store[guildId] = {};
  }
  const guildStore = store[guildId];

  if (!guildStore[keyword]) {
    guildStore[keyword] = [];
  }

  guildStore[keyword].push(content);
  await save();
}

/**
 * Pick a random content entry from a keyword's pool for this guild.
 */
export async function getRandomKeywordContent(
  guildId: string,
  keyword: string,
): Promise<string | undefined> {
  await ensureLoaded();

  const guildStore = store[guildId];
  if (!guildStore) return undefined;

  const pool = guildStore[keyword];
  if (!pool || pool.length === 0) return undefined;

  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

/**
 * Delete an entire keyword (and its pool) from this guild.
 */
export async function deleteKeyword(
  guildId: string,
  keyword: string,
): Promise<boolean> {
  await ensureLoaded();

  const guildStore = store[guildId];
  if (!guildStore || !guildStore[keyword]) return false;

  delete guildStore[keyword];
  await save();
  return true;
}

/**
 * List all keywords configured for this guild.
 */
export async function listKeywords(guildId: string): Promise<string[]> {
  await ensureLoaded();

  const guildStore = store[guildId];
  if (!guildStore) return [];
  return Object.keys(guildStore);
}
