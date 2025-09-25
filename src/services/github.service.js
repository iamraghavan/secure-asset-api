// src/services/github.service.js
import axios from 'axios';

const gh = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    'User-Agent': 'secure-asset-api',
    Accept: 'application/vnd.github+json'
  },
  timeout: 20000
});

// Get repo info (verifies repo + token + returns default_branch)
export async function getRepoInfo(owner, repo) {
  const { data } = await gh.get(`/repos/${owner}/${repo}`);
  return data; // includes .default_branch and .size (0 if empty)
}

// Try to get branch; return null on 404 instead of throwing
async function tryGetBranch(owner, repo, branch) {
  try {
    const { data } = await gh.get(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
    return data;
  } catch (e) {
    if (e?.response?.status === 404) return null;
    throw e;
  }
}

/**
 * Upload a file to GitHub (create/update).
 * - Auto-detect default branch if none provided
 * - If requested branch doesn't exist, fall back to default branch
 * - If repo is empty (size === 0), explain clearly (contents API cannot create the first commit)
 */
export async function uploadToGitHub({ owner, repo, branch, path, contentBase64, message, committer }) {
  const info = await getRepoInfo(owner, repo); // throws 404 if bad owner/repo or no access
  const defaultBranch = info.default_branch;   // e.g., 'main' or 'master'
  const repoIsEmpty = (info.size === 0);

  if (repoIsEmpty) {
    // The Contents API cannot create the very first commit in an empty repo.
    const help = `GitHub repo '${owner}/${repo}' is empty. Initialize it with any file (README.md) on GitHub first.`;
    const err = new Error(help);
    err.code = 'EMPTY_REPO';
    throw err;
  }

  // Resolve the branch
  let targetBranch = branch || defaultBranch;
  // If user supplied a custom branch that doesn't exist, fall back to default
  const branchExists = await tryGetBranch(owner, repo, targetBranch);
  if (!branchExists) {
    targetBranch = defaultBranch;
  }

  // Determine if file already exists (to include sha)
  let sha = undefined;
  try {
    const { data } = await gh.get(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(targetBranch)}`
    );
    sha = data.sha;
  } catch (e) {
    // 404 here = new file; that's fine
    if (e?.response?.status && e.response.status !== 404) throw e;
  }

  const payload = {
    message: message || `chore(asset): upload ${path}`,
    content: contentBase64,
    branch: targetBranch,
    sha,
    committer: committer || { name: owner, email: `${owner}@users.noreply.github.com` }
  };

  const { data } = await gh.put(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    payload
  );

  return { contentUrl: data.content?.html_url, sha: data.content?.sha, branch: targetBranch };
}

export function makeCdnUrl({ owner, repo, branch, path }) {
  const base = process.env.ASSET_CDN_BASE || 'https://cdn.jsdelivr.net/gh';
  const b = branch || process.env.ASSET_DEFAULT_BRANCH || 'main';
  return `${base}/${owner}/${repo}@${b}/${path}`.replace(/([^:]\/)\/+/g, '$1');
}


// Delete a file from GitHub repo via Contents API (requires sha).
export async function deleteFromGitHub({ owner, repo, branch, path, message, committer }) {
  // resolve default branch
  const info = await getRepoInfo(owner, repo);
  const targetBranch = branch || info.default_branch;

  // find current blob sha
  let sha;
  try {
    const { data } = await gh.get(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(targetBranch)}`
    );
    sha = data.sha;
  } catch (e) {
    if (e?.response?.status === 404) {
      const err = new Error('File not found in repository');
      err.code = 'FILE_NOT_FOUND';
      throw err;
    }
    throw e;
  }

  const payload = {
    message: message || `chore(asset): delete ${path}`,
    sha,
    branch: targetBranch,
    committer: committer || { name: owner, email: `${owner}@users.noreply.github.com` }
  };

  const { data } = await gh.delete(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    { data: payload }
  );

  return {
    path,
    branch: targetBranch,
    commit_sha: data.commit?.sha,
    commit_url: data.commit?.html_url
  };
}
