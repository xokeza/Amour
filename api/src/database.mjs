import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(filename) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
      profile TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE,
      access_expires INTEGER NOT NULL, refresh_expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS used_refresh (
      token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS likes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, track_id TEXT NOT NULL REFERENCES tracks(id),
      liked_at TEXT NOT NULL, PRIMARY KEY(user_id, track_id)
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT, is_public INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY, playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id), position INTEGER NOT NULL, added_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS playlist_order ON playlist_items(playlist_id,position);
    CREATE TABLE IF NOT EXISTS collections (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, id TEXT NOT NULL,
      snapshot TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(user_id,kind,id)
    );
    CREATE TABLE IF NOT EXISTS playback (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL, track_id TEXT NOT NULL REFERENCES tracks(id), event TEXT NOT NULL, listened_at TEXT NOT NULL,
      UNIQUE(user_id,session_id)
    );
    CREATE INDEX IF NOT EXISTS playback_history ON playback(user_id,listened_at DESC);
    CREATE TABLE IF NOT EXISTS follows (
      follower TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(follower,followed), CHECK(follower != followed)
    );
    PRAGMA user_version=1;
  `);
  return db;
}

export function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
