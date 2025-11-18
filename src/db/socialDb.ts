// src/db/socialDb.ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath =
  process.env.DB_PATH ||
  path.join(process.cwd(), "data", "yak-yak-social.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS role_gates (
  guild_id TEXT NOT NULL,
  role_id  TEXT NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);

CREATE TABLE IF NOT EXISTS social_scores (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  score      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS social_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  actor_id   TEXT,
  target_id  TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS social_gifs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('positive', 'negative', 'sabotage')),
  url        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_triggers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  phrase         TEXT NOT NULL,
  delta          INTEGER NOT NULL,
  case_sensitive INTEGER NOT NULL DEFAULT 0
);
`);

// --- One-time migration: extend old social_gifs.kind CHECK to include 'sabotage' ---
const gifTableSqlRow = db
  .prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'social_gifs'",
  )
  .get() as { sql: string } | undefined;

if (gifTableSqlRow?.sql && !gifTableSqlRow.sql.includes("sabotage")) {
  // Old table only allowed 'positive' and 'negative'. Rebuild it to also allow 'sabotage'.
  db.exec(`
    PRAGMA foreign_keys=OFF;
    BEGIN TRANSACTION;
    CREATE TABLE IF NOT EXISTS social_gifs_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      kind       TEXT NOT NULL CHECK (kind IN ('positive', 'negative', 'sabotage')),
      url        TEXT NOT NULL
    );
    INSERT INTO social_gifs_new (id, guild_id, kind, url)
    SELECT id, guild_id, kind, url FROM social_gifs;
    DROP TABLE social_gifs;
    ALTER TABLE social_gifs_new RENAME TO social_gifs;
    COMMIT;
    PRAGMA foreign_keys=ON;
  `);
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

// Start of today in UTC, as Unix seconds
function startOfTodayUtc(): number {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  return Math.floor(Date.UTC(year, month, day) / 1000);
}

// -------- Role gates --------

export function getFunRoles(guildId: string): string[] {
  const rows = db
    .prepare("SELECT role_id FROM role_gates WHERE guild_id = ?")
    .all(guildId) as { role_id: string }[];
  return rows.map((r) => r.role_id);
}

export function addFunRole(guildId: string, roleId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO role_gates (guild_id, role_id) VALUES (?, ?)",
  ).run(guildId, roleId);
}

export function removeFunRole(guildId: string, roleId: string): void {
  db.prepare(
    "DELETE FROM role_gates WHERE guild_id = ? AND role_id = ?",
  ).run(guildId, roleId);
}

// -------- Scores / log / leaderboard --------

export function getScore(guildId: string, userId: string): number {
  const row = db
    .prepare(
      "SELECT score FROM social_scores WHERE guild_id = ? AND user_id = ?",
    )
    .get(guildId, userId) as { score: number } | undefined;
  return row?.score ?? 0;
}

export function setScore(
  guildId: string,
  userId: string,
  score: number,
): void {
  db.prepare(
    `
    INSERT INTO social_scores (guild_id, user_id, score, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      score = excluded.score,
      updated_at = excluded.updated_at
  `,
  ).run(guildId, userId, score, now());
}

export function logSocialChange(
  guildId: string,
  actorId: string | null,
  targetId: string,
  delta: number,
  reason: string | null,
): void {
  db.prepare(
    `
    INSERT INTO social_log (guild_id, actor_id, target_id, delta, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(guildId, actorId, targetId, delta, reason, now());
}

export function adjustScore(
  guildId: string,
  actorId: string | null,
  targetId: string,
  delta: number,
  reason: string | null,
): { previous: number; current: number } {
  const previous = getScore(guildId, targetId);
  const current = previous + delta;
  setScore(guildId, targetId, current);
  logSocialChange(guildId, actorId, targetId, delta, reason);
  return { previous, current };
}

export interface LeaderboardRow {
  userId: string;
  score: number;
}

export function getLeaderboard(
  guildId: string,
  direction: "top" | "bottom",
  limit: number,
): LeaderboardRow[] {
  const order = direction === "bottom" ? "ASC" : "DESC";
  const rows = db
    .prepare(
      `
      SELECT user_id AS userId, score
      FROM social_scores
      WHERE guild_id = ?
      ORDER BY score ${order}
      LIMIT ?
    `,
    )
    .all(guildId, limit) as LeaderboardRow[];
  return rows;
}

// Return how much Social Credit a user has earned *today* from
// activity-related sources ("Activity Bonus%" + "Reaction Bonus%").
export function getTodayActivityTotal(
  guildId: string,
  userId: string,
): number {
  const start = startOfTodayUtc();
  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(delta), 0) AS total
      FROM social_log
      WHERE guild_id = ?
        AND target_id = ?
        AND created_at >= ?
        AND (
          reason LIKE 'Activity Bonus%'
          OR reason LIKE 'Reaction Bonus%'
        )
    `,
    )
    .get(guildId, userId, start) as { total: number } | undefined;

  return row?.total ?? 0;
}

// Recent log entries for a user (for rapsheet)
export interface LogEntry {
  id: number;
  actorId: string | null;
  targetId: string;
  delta: number;
  reason: string | null;
  createdAt: number;
}

export function getRecentLogForUser(
  guildId: string,
  userId: string,
  limit: number,
): LogEntry[] {
  const rows = db
    .prepare(
      `
      SELECT
        id,
        actor_id    AS actorId,
        target_id   AS targetId,
        delta,
        reason,
        created_at  AS createdAt
      FROM social_log
      WHERE guild_id = ?
        AND target_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    )
    .all(guildId, userId, limit) as LogEntry[];

  return rows;
}

// Sabotage stats for "most sabotaged" board
export interface SabotageStatRow {
  targetId: string;
  hits: number;
  netDelta: number;
  totalLoss: number;
}

export function getSabotageStatsSince(
  guildId: string,
  since: number,
  limit: number,
): SabotageStatRow[] {
  const rows = db
    .prepare(
      `
      SELECT
        target_id AS targetId,
        COUNT(*)  AS hits,
        COALESCE(SUM(delta), 0) AS netDelta,
        COALESCE(
          SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END),
          0
        ) AS totalLoss
      FROM social_log
      WHERE guild_id = ?
        AND created_at >= ?
        AND reason LIKE 'Sabotage%'
      GROUP BY target_id
      ORDER BY totalLoss DESC, hits DESC
      LIMIT ?
    `,
    )
    .all(guildId, since, limit) as SabotageStatRow[];

  return rows;
}

// -------- GIF pools --------

export type GifKind = "positive" | "negative" | "sabotage";

export interface GifRow {
  id: number;
  guildId: string;
  kind: GifKind;
  url: string;
}

export function addGif(
  guildId: string,
  kind: GifKind,
  url: string,
): number {
  const info = db
    .prepare(
      `
      INSERT INTO social_gifs (guild_id, kind, url)
      VALUES (?, ?, ?)
    `,
    )
    .run(guildId, kind, url);
  return Number(info.lastInsertRowid);
}

export function removeGif(guildId: string, id: number): boolean {
  const info = db
    .prepare(
      "DELETE FROM social_gifs WHERE guild_id = ? AND id = ?",
    )
    .run(guildId, id);
  return info.changes > 0;
}

export function listGifs(
  guildId: string,
  kind?: GifKind,
): GifRow[] {
  let rows: {
    id: number;
    guild_id: string;
    kind: string;
    url: string;
  }[];
  if (kind) {
    rows = db
      .prepare(
        "SELECT id, guild_id, kind, url FROM social_gifs WHERE guild_id = ? AND kind = ? ORDER BY id ASC",
      )
      .all(guildId, kind) as any;
  } else {
    rows = db
      .prepare(
        "SELECT id, guild_id, kind, url FROM social_gifs WHERE guild_id = ? ORDER BY id ASC",
      )
      .all(guildId) as any;
  }

  return rows.map((r) => ({
    id: r.id,
    guildId: r.guild_id,
    kind: r.kind as GifKind,
    url: r.url,
  }));
}

export function getRandomGif(
  guildId: string,
  kind: GifKind,
): string | null {
  const row = db
    .prepare(
      `
      SELECT url
      FROM social_gifs
      WHERE guild_id = ? AND kind = ?
      ORDER BY RANDOM()
      LIMIT 1
    `,
    )
    .get(guildId, kind) as { url: string } | undefined;
  return row?.url ?? null;
}

// -------- Triggers --------

export interface TriggerRow {
  id: number;
  guildId: string;
  phrase: string;
  delta: number;
  caseSensitive: boolean;
}

export function addTrigger(
  guildId: string,
  phrase: string,
  delta: number,
  caseSensitive: boolean,
): number {
  const info = db
    .prepare(
      `
      INSERT INTO social_triggers (guild_id, phrase, delta, case_sensitive)
      VALUES (?, ?, ?, ?)
    `,
    )
    .run(guildId, phrase, delta, caseSensitive ? 1 : 0);
  return Number(info.lastInsertRowid);
}

export function removeTrigger(
  guildId: string,
  id: number,
): boolean {
  const info = db
    .prepare(
      "DELETE FROM social_triggers WHERE guild_id = ? AND id = ?",
    )
    .run(guildId, id);
  return info.changes > 0;
}

export function getTriggers(guildId: string): TriggerRow[] {
  const rows = db
    .prepare(
      `
      SELECT id, guild_id, phrase, delta, case_sensitive
      FROM social_triggers
      WHERE guild_id = ?
      ORDER BY id ASC
    `,
    )
    .all(guildId) as {
    id: number;
    guild_id: string;
    phrase: string;
    delta: number;
    case_sensitive: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    guildId: r.guild_id,
    phrase: r.phrase,
    delta: r.delta,
    caseSensitive: !!r.case_sensitive,
  }));
}
