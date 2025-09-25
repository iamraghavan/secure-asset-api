// src/db/sqlite.js
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const FILE = process.env.SQLITE_FILE || path.join(process.cwd(), 'data', 'app.sqlite');

// ensure folder exists
fs.mkdirSync(path.dirname(FILE), { recursive: true });

const db = new Database(FILE, { fileMustExist: false });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// schema (id is text; created_at/updated_at ISO-8601 strings)
db.exec(`
CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,
  disk         TEXT NOT NULL CHECK (disk IN ('remote','local','s3','github')),
  path         TEXT NOT NULL,
  repo         TEXT,
  branch       TEXT,
  mime         TEXT,
  size         INTEGER,
  sha256       TEXT,
  verify_hash  INTEGER NOT NULL DEFAULT 0,
  disposition  TEXT NOT NULL DEFAULT 'inline',
  visibility   TEXT NOT NULL DEFAULT 'public',
  github_url   TEXT,
  cdn_url      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT,
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_visibility ON assets (visibility);
CREATE INDEX IF NOT EXISTS idx_assets_disk ON assets (disk);
`);

export default db;
