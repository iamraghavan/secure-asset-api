import fs from 'fs-extra';
import { join } from 'path';
import dayjs from 'dayjs';

const { readJSON, writeJSON, pathExists } = fs;
const DB_PATH = join(process.cwd(), 'data', 'assets.json');

export async function loadDB() {
  if (!(await pathExists(DB_PATH))) {
    await writeJSON(DB_PATH, { assets: [] }, { spaces: 2 });
  }
  return readJSON(DB_PATH);
}

export async function saveDB(db) {
  return writeJSON(DB_PATH, db, { spaces: 2 });
}

export async function insertAsset(asset) {
  const db = await loadDB();
  db.assets.unshift({ ...asset, created_at: dayjs().toISOString() });
  await saveDB(db);
  return asset;
}

export async function findBySlug(slug) {
  const db = await loadDB();
  return db.assets.find(a => a.slug === slug);
}

export async function recentAssets({ label, disk, visibility, limit = 10 }) {
  const db = await loadDB();
  let list = db.assets;
  if (label) list = list.filter(a => a.label?.toLowerCase().includes(label.toLowerCase()));
  if (disk) list = list.filter(a => a.disk === disk);
  if (visibility) list = list.filter(a => a.visibility === visibility);
  return list.slice(0, Math.max(1, Math.min(100, +limit)));
}
