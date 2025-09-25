// src/models/asset.model.js (Firebase RTDB)
import { rtdb } from '../db/firebase.js';
import dayjs from 'dayjs';

/**
 * Data layout in RTDB
 * /assets/{id} => full asset object
 * /slugs/{slug} => { id: '...' }  (quick slug lookup)
 * Soft delete: asset.deleted_at set to ISO string
 */

// normalize booleans consistently
const toBool = (v) => v === true || v === 'true' || v === 1 || v === '1';

function normalizeAsset(a) {
  if (!a) return null;
  return {
    id: a.id,
    label: a.label,
    slug: a.slug,
    filename: a.filename,
    disk: a.disk,
    path: a.path,
    repo: a.repo ?? null,
    branch: a.branch ?? null,
    mime: a.mime ?? null,
    size: a.size ?? null,
    sha256: a.sha256 ?? null,
    verify_hash: toBool(a.verify_hash),
    disposition: a.disposition || 'inline',
    visibility: a.visibility || 'public',
    github_url: a.github_url ?? null,
    cdn_url: a.cdn_url ?? null,
    created_at: a.created_at,
    updated_at: a.updated_at ?? null,
    deleted_at: a.deleted_at ?? null
  };
}

async function getAssetById(id) {
  const snap = await rtdb.ref(`/assets/${id}`).get();
  return normalizeAsset(snap.val());
}

async function setAsset(id, data) {
  await rtdb.ref(`/assets/${id}`).set(data);
}

async function reserveSlug(slug, id) {
  // write if empty; prevents collisions
  const ref = rtdb.ref(`/slugs/${slug}`);
  const res = await ref.transaction((current) => {
    if (current === null) {
      return { id };
    }
    return; // abort (collision)
  });
  return res.committed;
}

async function releaseSlug(slug) {
  await rtdb.ref(`/slugs/${slug}`).remove();
}

async function getIdBySlug(slug) {
  const snap = await rtdb.ref(`/slugs/${slug}`).get();
  return snap.val()?.id || null;
}

async function fetchAllAssetsRaw() {
  const snap = await rtdb.ref('/assets').get();
  const obj = snap.val() || {};
  return Object.values(obj).map(normalizeAsset);
}

// ---------------- Public model API ----------------

export async function insertAsset(asset) {
  const now = dayjs().toISOString();
  const data = normalizeAsset({ ...asset, created_at: now, updated_at: null, deleted_at: null });

  // reserve slug (unique)
  const ok = await reserveSlug(data.slug, data.id);
  if (!ok) {
    const err = new Error('Slug already exists');
    err.code = 'SLUG_EXISTS';
    throw err;
  }

  try {
    await setAsset(data.id, data);
    return data;
  } catch (e) {
    // rollback slug reservation on failure
    await releaseSlug(data.slug);
    throw e;
  }
}

export async function findBySlug(slug) {
  const id = await getIdBySlug(slug);
  if (!id) return null;
  const a = await getAssetById(id);
  if (!a || a.deleted_at) return null;
  return a;
}

export async function recentAssets({ label, disk, visibility, limit = 10 }) {
  // RTDB queries are limited; fetch then filter in memory for flexibility
  let list = await fetchAllAssetsRaw();
  list = list.filter(a => !a.deleted_at);

  if (label) list = list.filter(a => a.label?.toLowerCase().includes(String(label).toLowerCase()));
  if (disk) list = list.filter(a => a.disk === disk);
  if (visibility) list = list.filter(a => a.visibility === visibility);

  // sort by created_at desc
  list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return list.slice(0, Math.max(1, Math.min(100, +limit)));
}

export async function getAllAssets({ label, disk, visibility } = {}) {
  let list = await fetchAllAssetsRaw();
  list = list.filter(a => !a.deleted_at);

  if (label) list = list.filter(a => a.label?.toLowerCase().includes(String(label).toLowerCase()));
  if (disk) list = list.filter(a => a.disk === disk);
  if (visibility) list = list.filter(a => a.visibility === visibility);

  return list;
}

// Advanced list with search/sort/pagination (server-side in memory)
export async function listAssets({
  q, label, disk, visibility,
  includeDeleted = false,
  sort = 'created_at',
  order = 'desc',
  limit = 20,
  offset = 0
}) {
  const allowedSort = new Set(['created_at', 'label', 'slug', 'disk', 'visibility', 'filename']);
  const sortKey = allowedSort.has(String(sort)) ? String(sort) : 'created_at';
  const dir = String(order).toLowerCase() === 'asc' ? 1 : -1;

  let list = await fetchAllAssetsRaw();
  if (!includeDeleted) list = list.filter(a => !a.deleted_at);

  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter(a =>
      a.label?.toLowerCase().includes(s) ||
      a.slug?.toLowerCase().includes(s) ||
      a.filename?.toLowerCase().includes(s)
    );
  }
  if (label) list = list.filter(a => a.label?.toLowerCase().includes(String(label).toLowerCase()));
  if (disk) list = list.filter(a => a.disk === disk);
  if (visibility) list = list.filter(a => a.visibility === visibility);

  list.sort((a, b) => {
    const av = (a[sortKey] ?? '').toString();
    const bv = (b[sortKey] ?? '').toString();
    return dir * av.localeCompare(bv);
  });

  const total = list.length;
  const start = Math.max(0, Number(offset) || 0);
  const end = start + Math.max(1, Math.min(100, Number(limit) || 20));
  const items = list.slice(start, end);

  return { items, total };
}

export async function countAssets(filters = {}) {
  const { items, total } = await listAssets({ ...filters, limit: 1, offset: 0 });
  return total;
}

// Optional: updates & soft-delete if you need full CRUD later
export async function updateAsset(id, patch) {
  const cur = await getAssetById(id);
  if (!cur || cur.deleted_at) return null;

  // handle slug change: re-index
  if (patch.slug && patch.slug !== cur.slug) {
    const ok = await reserveSlug(patch.slug, id);
    if (!ok) {
      const err = new Error('Slug already exists');
      err.code = 'SLUG_EXISTS';
      throw err;
    }
    await releaseSlug(cur.slug);
  }

  const updated = normalizeAsset({
    ...cur,
    ...patch,
    verify_hash: patch.verify_hash ?? cur.verify_hash,
    updated_at: dayjs().toISOString()
  });

  await setAsset(id, updated);
  return updated;
}

export async function softDeleteAsset(id) {
  const cur = await getAssetById(id);
  if (!cur || cur.deleted_at) return false;

  cur.deleted_at = dayjs().toISOString();
  await setAsset(id, cur);
  // keep slug reserved to avoid reuse (change this if you prefer freeing)
  return true;
}

export async function restoreAsset(id) {
  const cur = await getAssetById(id);
  if (!cur || !cur.deleted_at) return false;
  cur.deleted_at = null;
  await setAsset(id, cur);
  return true;
}

export async function getById(id) {
  return getAssetById(id);
}
