/**
 * SQLite persistence layer (better-sqlite3, synchronous).
 *
 * Two tables:
 *   messages  - the raw archive of every monitored group message.
 *   digests   - one row per pipeline run (LLM output + push status), so the
 *               WebGUI can show history and we never re-process a window.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createLogger } from '../util/logger.js';

const log = createLogger('db');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'renecon.db');

let db;

export function initDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id   TEXT,
      group_id     TEXT NOT NULL,
      group_name   TEXT,
      sender_id    TEXT,
      sender_name  TEXT,
      content      TEXT NOT NULL,
      images       TEXT,                 -- JSON array of image URLs
      raw          TEXT,
      msg_time     INTEGER NOT NULL,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_time ON messages (msg_time);
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id);

    CREATE TABLE IF NOT EXISTS digests (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      window_start INTEGER NOT NULL,
      window_end   INTEGER NOT NULL,
      mode         TEXT NOT NULL,
      msg_count    INTEGER NOT NULL,
      status       TEXT NOT NULL,        -- success | empty | error
      result       TEXT,                 -- JSON string or markdown
      pushed       INTEGER NOT NULL DEFAULT 0,
      error        TEXT,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_digests_time ON digests (created_at);

    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS group_topics (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id   TEXT NOT NULL,
      topic_key  TEXT NOT NULL,
      signature  TEXT,
      summary    TEXT,
      hit_count  INTEGER NOT NULL DEFAULT 1,
      first_seen INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      UNIQUE (group_id, topic_key)
    );
    CREATE INDEX IF NOT EXISTS idx_topics_group ON group_topics (group_id, last_seen);
  `);
  migrate();
  log.info('Database ready at', DB_PATH);
  return db;
}

/** Lightweight additive migrations for databases created by older versions. */
function migrate() {
  const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!cols.includes('images')) {
    db.exec('ALTER TABLE messages ADD COLUMN images TEXT');
    log.info('Migrated: added messages.images column.');
  }
}

export function getDb() {
  if (!db) throw new Error('DB not initialised. Call initDb() first.');
  return db;
}

/* ---------------------------------------------------------------- messages */

/**
 * @param {object} m
 * @param {string} m.messageId
 * @param {string} m.groupId
 * @param {string} m.groupName
 * @param {string} m.senderId
 * @param {string} m.senderName
 * @param {string} m.content
 * @param {string[]} [m.images] image URLs in the message
 * @param {object} m.raw
 * @param {number} m.msgTime  unix seconds
 */
export function insertMessage(m) {
  return getDb()
    .prepare(
      `INSERT INTO messages
        (message_id, group_id, group_name, sender_id, sender_name, content, images, raw, msg_time, created_at)
       VALUES (@messageId, @groupId, @groupName, @senderId, @senderName, @content, @images, @raw, @msgTime, @createdAt)`,
    )
    .run({
      messageId: m.messageId ?? null,
      groupId: String(m.groupId),
      groupName: m.groupName ?? null,
      senderId: m.senderId ? String(m.senderId) : null,
      senderName: m.senderName ?? null,
      content: m.content,
      images: m.images && m.images.length ? JSON.stringify(m.images) : null,
      raw: m.raw ? JSON.stringify(m.raw) : null,
      msgTime: m.msgTime,
      createdAt: Math.floor(Date.now() / 1000),
    });
}

/**
 * Fetch messages whose msg_time is within [start, end).
 * @param {number} start unix seconds inclusive
 * @param {number} end   unix seconds exclusive
 * @param {string[]} [groupIds] optional filter
 */
export function getMessagesInWindow(start, end, groupIds) {
  let sql = 'SELECT * FROM messages WHERE msg_time >= ? AND msg_time < ?';
  const params = [start, end];
  if (groupIds && groupIds.length) {
    sql += ` AND group_id IN (${groupIds.map(() => '?').join(',')})`;
    params.push(...groupIds.map(String));
  }
  sql += ' ORDER BY msg_time ASC';
  return getDb().prepare(sql).all(...params);
}

/** Build a shared WHERE clause + params from filter options. */
function messageFilter({ groupId, keyword, sender } = {}) {
  const clauses = [];
  const params = [];
  if (groupId) { clauses.push('group_id = ?'); params.push(String(groupId)); }
  if (sender) { clauses.push('(sender_name LIKE ? OR sender_id LIKE ?)'); params.push(`%${sender}%`, `%${sender}%`); }
  if (keyword) { clauses.push('content LIKE ?'); params.push(`%${keyword}%`); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

/**
 * Paginated recent messages for the WebGUI viewer.
 * @param {object} opts { groupId, keyword, sender, limit, offset }
 */
export function queryMessages({ groupId, keyword, sender, limit = 100, offset = 0 } = {}) {
  const { where, params } = messageFilter({ groupId, keyword, sender });
  const sql = `SELECT * FROM messages${where} ORDER BY msg_time DESC LIMIT ? OFFSET ?`;
  return getDb().prepare(sql).all(...params, limit, offset);
}

export function countMessages({ groupId, keyword, sender } = {}) {
  const { where, params } = messageFilter({ groupId, keyword, sender });
  return getDb().prepare(`SELECT COUNT(*) c FROM messages${where}`).get(...params).c;
}

/**
 * Delete messages by id.
 * @param {Array<number|string>} ids
 * @returns {number} rows deleted
 */
export function deleteMessages(ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb()
    .prepare(`DELETE FROM messages WHERE id IN (${placeholders})`)
    .run(...ids.map(Number));
  return info.changes;
}

/** Per-group message counts for the dashboard. */
export function messageStatsByGroup() {
  return getDb()
    .prepare(
      `SELECT group_id, group_name, COUNT(*) c, MAX(msg_time) last_time
       FROM messages GROUP BY group_id ORDER BY c DESC`,
    )
    .all();
}

/* ----------------------------------------------------------------- digests */

export function insertDigest(d) {
  return getDb()
    .prepare(
      `INSERT INTO digests
        (window_start, window_end, mode, msg_count, status, result, pushed, error, created_at)
       VALUES (@windowStart, @windowEnd, @mode, @msgCount, @status, @result, @pushed, @error, @createdAt)`,
    )
    .run({
      windowStart: d.windowStart,
      windowEnd: d.windowEnd,
      mode: d.mode,
      msgCount: d.msgCount,
      status: d.status,
      result: d.result ?? null,
      pushed: d.pushed ? 1 : 0,
      error: d.error ?? null,
      createdAt: Math.floor(Date.now() / 1000),
    });
}

/* --------------------------------------------------------------- app_state */

/** Read a persisted state value, or null. */
export function getState(key) {
  const row = getDb().prepare('SELECT value FROM app_state WHERE key = ?').get(key);
  return row ? row.value : null;
}

/** Upsert a persisted state value (string). */
export function setState(key, value) {
  getDb()
    .prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, String(value));
}

/* ------------------------------------------------------------ group_topics */

/** Look up a stored topic for a group, or null. */
export function findTopic(groupId, topicKey) {
  return getDb()
    .prepare('SELECT * FROM group_topics WHERE group_id = ? AND topic_key = ?')
    .get(String(groupId), topicKey) || null;
}

/**
 * Insert or update a topic. Bumps hit_count and last_seen on repeat.
 * @param {object} t { groupId, topicKey, signature, summary, ts }
 */
export function upsertTopic(t) {
  getDb()
    .prepare(
      `INSERT INTO group_topics (group_id, topic_key, signature, summary, hit_count, first_seen, last_seen)
       VALUES (@groupId, @topicKey, @signature, @summary, 1, @ts, @ts)
       ON CONFLICT(group_id, topic_key) DO UPDATE SET
         signature = excluded.signature,
         summary   = excluded.summary,
         hit_count = hit_count + 1,
         last_seen = excluded.last_seen`,
    )
    .run({
      groupId: String(t.groupId),
      topicKey: t.topicKey,
      signature: t.signature ?? null,
      summary: t.summary ?? null,
      ts: t.ts,
    });
}

/** Keep only the `keep` most-recent topics per group; delete the rest. */
export function pruneTopics(groupId, keep) {
  getDb()
    .prepare(
      `DELETE FROM group_topics
       WHERE group_id = ?
         AND id NOT IN (
           SELECT id FROM group_topics WHERE group_id = ?
           ORDER BY last_seen DESC LIMIT ?
         )`,
    )
    .run(String(groupId), String(groupId), keep);
}

/** Recent topics for a group (for inspection). */
export function getGroupTopics(groupId, limit = 5) {
  return getDb()
    .prepare('SELECT * FROM group_topics WHERE group_id = ? ORDER BY last_seen DESC LIMIT ?')
    .all(String(groupId), limit);
}

export function queryDigests({ limit = 50, offset = 0 } = {}) {
  return getDb()
    .prepare('SELECT * FROM digests ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
}

export function countDigests() {
  return getDb().prepare('SELECT COUNT(*) c FROM digests').get().c;
}
