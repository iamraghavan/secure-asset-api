// src/models/asset.model.js
import db from '../db/sqlite.js';
import dayjs from 'dayjs';

// Helpers to map boolean to int and back
const b2i = (b) => (b ? 1 : 0);
const i2b = (i) => i === 1;

function rowToAsset(r) {
  if (!r) return null;
  return {
    id: r.id,
    label: r.label,
    slug: r.slug,
    filename: r.filename,
    disk: r.disk,
    path: r.path,
    repo: r.repo || null,
    branch: r.branch || null,
    mime: r.mime || null,
    size: r.size ?? null,
    sha256: r.sha256 || null,
    verify_hash: i2b(r.verify_hash),
    disposition: r.disposition,
    visibility: r.visibility,
    github_url: r.github_url || null,
    cdn_url: r.cdn_url || null,
    created_at: r.created_at,
    updated_at: r.updated_at || null,
    deleted_at: r.deleted_at || null
  };
}

// --- CREATE ------------------------------------------------------------------
export async function insertAsset(asset) {
  const now = dayjs().toISOString();
  const stmt = db.prepare(`
    INSERT INTO assets (
      id, label, slug, filename, disk, path, repo, branch, mime, size, sha256,
      verify_hash, disposition, visibility, github_url, cdn_url, created_at, updated_at, deleted_at
    ) VALUES (
      @id, @label, @slug, @filename, @disk, @path, @repo, @branch, @mime, @size, @sha256,
      @verify_hash, @disposition, @visibility, @github_url, @cdn_url, @created_at, @updated_at, @deleted_at
    )
  `);

  stmt.run({
    id: asset.id,
    label: asset.label,
    slug: asset.slug,
    filename: asset.filename,
    disk: asset.disk,
    path: asset.path,
    repo: asset.repo ?? null,
    branch: asset.branch ?? null,
    mime: asset.mime ?? null,
    size: asset.size ?? null,
    sha256: asset.sha256 ?? null,
    verify_hash: b2i(!!asset.verify_hash),
    disposition: asset.disposition || 'inline',
    visibility: asset.visibility || 'public',
    github_url: asset.github_url ?? null,
    cdn_url: asset.cdn_url ?? null,
    created_at: now,
    updated_at: null,
    deleted_at: null
  });

  return { ...asset, created_at: now };
}

// --- READ (by slug) ----------------------------------------------------------
export async function findBySlug(slug) {
  const r = db.prepare(`
    SELECT * FROM assets WHERE slug = ? AND deleted_at IS NULL LIMIT 1
  `).get(slug);
  return rowToAsset(r);
}

// --- READ (recent / filtered) ------------------------------------------------
export async function recentAssets({ label, disk, visibility, limit = 10 }) {
  const clauses = ['deleted_at IS NULL'];
  const params = [];

  if (label) { clauses.push('LOWER(label) LIKE ?'); params.push(`%${String(label).toLowerCase()}%`); }
  if (disk) { clauses.push('disk = ?'); params.push(disk); }
  if (visibility) { clauses.push('visibility = ?'); params.push(visibility); }

  const sql = `
    SELECT * FROM assets
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  params.push(Math.max(1, Math.min(100, +limit)));

  const rows = db.prepare(sql).all(...params);
  return rows.map(rowToAsset);
}

// (Optional extra helpers if you expand to full CRUD later)
export async function getById(id) {
  const r = db.prepare(`SELECT * FROM assets WHERE id = ? LIMIT 1`).get(id);
  return rowToAsset(r);
}
export async function updateAsset(id, patch) {
  // Build dynamic UPDATE from allowed fields
  const fields = [];
  const params = [];
  const allowed = ['label','filename','slug','disposition','visibility','verify_hash','mime','size','branch','repo','path','github_url','cdn_url','sha256'];

  for (const k of allowed) {
    if (k in patch) {
      fields.push(`${k} = ?`);
      params.push(k === 'verify_hash' ? b2i(!!patch[k]) : patch[k]);
    }
  }
  fields.push(`updated_at = ?`);
  params.push(dayjs().toISOString());
  params.push(id);
  const sql = `UPDATE assets SET ${fields.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...params);

  return getById(id);
}
export async function softDeleteAsset(id) {
  db.prepare(`UPDATE assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(dayjs().toISOString(), id);
}
export async function restoreAsset(id) {
  db.prepare(`UPDATE assets SET deleted_at = NULL WHERE id = ?`).run(id);
}


// List with filters, sorting, pagination
export async function listAssets({ q, label, disk, visibility, includeDeleted = false, sort = 'created_at', order = 'desc', limit = 20, offset = 0 }) {
  const allowedSort = new Set(['created_at', 'label', 'slug', 'disk', 'visibility', 'filename']);
  const sortCol = allowedSort.has(String(sort)) ? String(sort) : 'created_at';
  const dir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const where = [];
  const params = [];

  if (!includeDeleted) where.push('deleted_at IS NULL');
  if (q)       { where.push('(LOWER(label) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(filename) LIKE ?)'); const s = `%${String(q).toLowerCase()}%`; params.push(s, s, s); }
  if (label)   { where.push('LOWER(label) LIKE ?'); params.push(`%${String(label).toLowerCase()}%`); }
  if (disk)    { where.push('disk = ?'); params.push(disk); }
  if (visibility) { where.push('visibility = ?'); params.push(visibility); }

  const sql = `
    SELECT * FROM assets
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${sortCol} ${dir}
    LIMIT ? OFFSET ?
  `;

  params.push(Math.max(1, Math.min(100, Number(limit) || 20)));
  params.push(Math.max(0, Number(offset) || 0));

  const rows = db.prepare(sql).all(...params);
  return rows.map(rowToAsset);
}

export async function countAssets(filters = {}) {
  const { q, label, disk, visibility, includeDeleted = false } = filters;
  const where = [];
  const params = [];

  if (!includeDeleted) where.push('deleted_at IS NULL');
  if (q)       { where.push('(LOWER(label) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(filename) LIKE ?)'); const s = `%${String(q).toLowerCase()}%`; params.push(s, s, s); }
  if (label)   { where.push('LOWER(label) LIKE ?'); params.push(`%${String(label).toLowerCase()}%`); }
  if (disk)    { where.push('disk = ?'); params.push(disk); }
  if (visibility) { where.push('visibility = ?'); params.push(visibility); }

  const sql = `SELECT COUNT(*) as cnt FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const r = db.prepare(sql).get(...params);
  return r?.cnt || 0;
}


export async function getAllAssets({ label, disk, visibility } = {}) {
  const db = await loadDB();
  let list = db.assets;
  if (label) list = list.filter(a => a.label?.toLowerCase().includes(label.toLowerCase()));
  if (disk) list = list.filter(a => a.disk === disk);
  if (visibility) list = list.filter(a => a.visibility === visibility);
  return list; // no limit applied
}