import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath =
  process.env.DB_PATH ||
  path.join(process.cwd(), "data", "social-credit.db");

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
`);

function now(): number {
  return Math.floor(Date.now() / 1000);
}

// --- Role gating ---

export function getFunRoles(guildId: string): string[] {
  const rows = db
    .prepare("SELECT role_id FROM role_gates WHERE guild_id = ?")
    .all(guildId) as { role_id: string }[];
  return rows.map((r) => r.role_id);
}

export function addFunRole(guildId: string, roleId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO role_gates (guild_id, role_id) VALUES (?, ?)`,
  ).run(guildId, roleId);
}

export function removeFunRole(guildId: string, roleId: string): void {
  db.prepare(
    `DELETE FROM role_gates WHERE guild_id = ? AND role_id = ?`,
  ).run(guildId, roleId);
}

// --- Scores / leaderboard ---

export function getScore(guildId: string, userId: string): number {
  const row = db
    .prepare(
      "SELECT score FROM social_scores WHERE guild_id = ? AND user_id = ?",
    )
    .get(guildId, userId) as { score: number } | undefined;
  return row?.score ?? 0;
}

export function setScore(guildId: string, userId: string, score: number): void {
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
