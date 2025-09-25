// src/controllers/assets.controller.js
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { insertAsset, findBySlug, recentAssets } from '../models/asset.model.js';
import { slugify } from '../utils/slugify.js';
import { sha256Hex } from '../utils/hash.js';
import { uploadToGitHub, makeCdnUrl } from '../services/github.service.js';
import { extname } from 'path';
import mime from 'mime-types';
import { readFileSync, unlinkSync } from 'fs';
import { deleteFromGitHub } from '../services/github.service.js'; // top of file


// ---- env / config -----------------------------------------------------------
const ALLOWED_EXT = (process.env.ASSET_ALLOWED_EXT || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const ALLOWLIST = (process.env.ASSET_REMOTE_ALLOWLIST || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const GH_OWNER  = process.env.ASSET_GH_OWNER;
const GH_REPO   = process.env.ASSET_GH_REPO;
const GH_BRANCH = process.env.ASSET_DEFAULT_BRANCH || 'main';

// ---- helpers ----------------------------------------------------------------
const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['true','1','on','yes'].includes(v.toLowerCase());
  if (typeof v === 'number') return v === 1;
  return false;
};

function guessFilename(pathOrUrl) {
  try {
    const u = new URL(pathOrUrl);
    const p = u.pathname.split('/').filter(Boolean).pop();
    return p || null;
  } catch {
    const parts = (pathOrUrl || '').split('/').filter(Boolean);
    return parts.pop() || null;
  }
}

function publicUrlFromAsset(a) {
  if (a.disk === 'github') {
    const branch = a.branch || GH_BRANCH;
    return makeCdnUrl({ owner: GH_OWNER, repo: GH_REPO, branch, path: a.path });
  }
  if (a.disk === 'remote') return a.path;
  // You can extend for local/s3 streaming later.
  return a.path;
}

// ---- schemas ----------------------------------------------------------------
const registerSchema = z.object({
  label: z.string().min(1),
  filename: z.string().optional(),
  slug: z.string().optional(),
  disk: z.enum(['remote','local','s3','github']),
  path: z.string().min(1),
  mime: z.string().optional(),
  size: z.number().optional(),
  sha256: z.string().length(64).optional(),
  verify_hash: z.preprocess(toBool, z.boolean().optional().default(false)),
  disposition: z.enum(['inline','attachment']).optional().default('inline'),
  visibility: z.string().optional().default('public')
});

// ---- controllers ------------------------------------------------------------

/**
 * POST /api/v1/assets/register
 * Registers an existing asset (remote/local/github reference).
 */
export async function registerExisting(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ ok: false, error: parsed.error.flatten() });
  }
  const v = parsed.data;

  const slug = v.slug ? slugify(v.slug) : (slugify(v.label) || nanoid(8));
  const filename = v.filename || guessFilename(v.path) || `${slug}.bin`;
  const ext = (extname(filename) || '').slice(1).toLowerCase();

  if (ALLOWED_EXT.length && !ALLOWED_EXT.includes(ext)) {
    return res.status(400).json({ ok: false, error: `File extension .${ext} not allowed` });
  }

  // remote allowlist guard
  if (v.disk === 'remote') {
    try {
      const u = new URL(v.path);
      const host = u.host.toLowerCase();
      const ok = ALLOWLIST.length === 0 || ALLOWLIST.some(d => host.endsWith(d));
      if (!ok) return res.status(400).json({ ok: false, error: 'Remote host not in allowlist' });
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid remote URL' });
    }
  }

  const mimeType = v.mime || (mime.lookup(filename) || 'application/octet-stream');

  const asset = {
    id: nanoid(12),
    label: v.label,
    slug,
    filename,
    disk: v.disk,
    path: v.path,
    mime: mimeType,
    size: v.size ?? null,
    sha256: v.sha256 ?? null,
    verify_hash: v.verify_hash,
    disposition: v.disposition,
    visibility: v.visibility
  };

  await insertAsset(asset);
  return res.json({ ok: true, asset, public_url: publicUrlFromAsset(asset) });
}

/**
 * POST /api/v1/assets/github
 * Multipart: file + metadata; uploads file to GitHub and registers asset.
 * Fields: file, label, filename?, slug?, repo_path, branch?, disposition?, visibility?, verify_hash?
 */
export async function uploadGithubRegister(req, res) {
  try {
    const { file } = req;
    if (!file) return res.status(400).json({ ok: false, error: 'file is required' });

    const schema = z.object({
      label: z.string().min(1),
      filename: z.string().optional(),
      slug: z.string().optional(),
      repo_path: z.string().min(1),
      branch: z.string().optional().default(GH_BRANCH),
      disposition: z.enum(['inline','attachment']).optional().default('inline'),
      visibility: z.string().optional().default('public'),
      verify_hash: z.preprocess(toBool, z.boolean().optional().default(false))
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ ok: false, error: parsed.error.flatten() });
    }
    const v = parsed.data;

    const filename = v.filename || file.originalname;
    const ext = (extname(filename) || '').slice(1).toLowerCase();

    if (ALLOWED_EXT.length && !ALLOWED_EXT.includes(ext)) {
      return res.status(400).json({ ok: false, error: `File extension .${ext} not allowed` });
    }

    // ensure repo_path has an extension (append from uploaded filename)
    let repoPath = v.repo_path;
    if (!/\.[a-z0-9]{1,10}$/i.test(repoPath)) {
      repoPath = `${repoPath}.${ext}`;
    }

    const slug = v.slug ? slugify(v.slug) : (slugify(v.label) || nanoid(8));
    const buf = readFileSync(file.path);
    const contentBase64 = buf.toString('base64');
    const sha256 = sha256Hex(buf);

    const { contentUrl } = await uploadToGitHub({
      owner: GH_OWNER,
      repo: GH_REPO,
      branch: v.branch,
      path: repoPath,
      contentBase64,
      message: `Add asset ${filename}`
    });

    const cdn = makeCdnUrl({ owner: GH_OWNER, repo: GH_REPO, branch: v.branch, path: repoPath });

    const asset = {
      id: nanoid(12),
      label: v.label,
      slug,
      filename,
      disk: 'github',
      path: repoPath,
      repo: `${GH_OWNER}/${GH_REPO}`,
      branch: v.branch,
      mime: file.mimetype,
      size: file.size,
      sha256,
      verify_hash: v.verify_hash,
      disposition: v.disposition,
      visibility: v.visibility,
      github_url: contentUrl,
      cdn_url: cdn
    };

    await insertAsset(asset);
    return res.json({ ok: true, asset, public_url: publicUrlFromAsset(asset) });
  } catch (e) {
    // prefer detailed GH error if available
    console.error(e?.response?.data || e);
    return res.status(500).json({ ok: false, error: 'GitHub upload failed' });
  } finally {
    // cleanup temp upload
    try { if (req.file?.path) unlinkSync(req.file.path); } catch {}
  }
}

/**
 * GET /api/v1/assets/recent?label=&disk=&visibility=&limit=10
 */
export async function listRecent(req, res) {
  const { label, disk, visibility, limit } = req.query;
  const items = await recentAssets({ label, disk, visibility, limit });
  return res.json({ ok: true, items });
}

/**
 * GET /api/v1/assets/:slug
 */
export async function resolveBySlug(req, res) {
  const { slug } = req.params;
  const a = await findBySlug(slug);
  if (!a) return res.status(404).json({ ok: false, error: 'Not found' });
  return res.json({ ok: true, public_url: publicUrlFromAsset(a), asset: a });
}

// DELETE /api/v1/assets/github
// Body: { repo_path, branch?, message?, owner?, repo? }
export async function deleteGithubAsset(req, res) {
  const schema = z.object({
    owner: z.string().optional(),
    repo: z.string().optional(),
    repo_path: z.string().min(1, 'repo_path is required'),
    branch: z.string().optional(),
    message: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ ok: false, error: parsed.error.flatten() });
  }

  try {
    const owner = parsed.data.owner || GH_OWNER;
    const repo  = parsed.data.repo  || GH_REPO;
    const { repo_path, branch, message } = parsed.data;

    const result = await deleteFromGitHub({
      owner, repo, branch, path: repo_path, message
    });

    return res.status(200).json({
      ok: true,
      deleted: true,
      path: result.path,
      branch: result.branch,
      commit_sha: result.commit_sha,
      commit_url: result.commit_url
    });
  } catch (e) {
    if (e?.code === 'FILE_NOT_FOUND') {
      return res.status(404).json({ ok: false, error: 'File not found in repository' });
    }
    const ghPayload = e?.response?.data;
    if (ghPayload) return res.status(502).json({ ok: false, error: ghPayload }); // Bad Gateway to reflect upstream error
    return res.status(500).json({ ok: false, error: e?.message || 'GitHub delete failed' });
  }
}