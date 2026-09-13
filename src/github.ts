/**
 * GitHub first-party search — direct GitHub REST API, no Google.
 * Endpoints: /search/repositories | /search/code | /search/issues | /search/commits
 * Auth: GITHUB_TOKEN / GH_PAT env, or refs in ~/.dsh/.credentials.yaml (line-based parse).
 * Code search REQUIRES auth (GitHub API rule); commits search needs a preview header.
 */
import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.github.com';
const ENDPOINTS: Record<GitHubKind, string> = { repo: 'repositories', code: 'code', issue: 'issues', commit: 'commits' };
const UA = { 'User-Agent': 'dsh-search', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

export type GitHubKind = 'repo' | 'code' | 'issue' | 'commit';

export interface GitHubHit {
  kind: GitHubKind;
  title: string;
  url: string;
  detail: string;
  extra?: Record<string, unknown>;
}

/** Token lookup: env first, then credentials file refs, then gh CLI keyring (gh auth token). */
export function githubToken(): string {
  const env = process.env.GITHUB_TOKEN || process.env.GH_PAT;
  if (env) return env;
  try {
    const p = join(homedir(), '.dsh', '.credentials.yaml');
    if (!existsSync(p)) return '';
    const lines = readFileSync(p, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const m = /^([A-Z0-9_]+)\s*:\s*(\S+)\s*$/.exec(t);
      if (m && (m[1] === 'GITHUB_TOKEN' || m[1] === 'GH_PAT')) return m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* noop */ }
  // gh CLI keyring fallback (best-effort; gh may not be installed)
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const t = execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (t) return t;
  } catch { /* no gh */ }
  return '';
}

function mapHit(kind: GitHubKind, item: any): GitHubHit {
  switch (kind) {
    case 'repo':
      return {
        kind,
        title: item.full_name ?? item.name ?? '',
        url: item.html_url ?? '',
        detail: [item.description ?? '', '★' + (item.stargazers_count ?? 0) + ' · ' + (item.language ?? '')].filter(Boolean).join(' '),
        extra: { stars: item.stargazers_count ?? 0, forks: item.forks_count ?? 0, updated: item.updated_at ?? '' },
      };
    case 'code':
      return {
        kind,
        title: (item.repository?.full_name ?? '') + ' — ' + item.name,
        url: item.html_url ?? '',
        detail: item.path ?? '',
      };
    case 'issue':
      return {
        kind,
        title: (item.repository_url ?? '').replace('https://api.github.com/repos/', '') + ' #' + item.number + ' ' + (item.title ?? ''),
        url: item.html_url ?? '',
        detail: '[' + (item.state ?? '') + '] ' + (item.body ?? '').replace(/\s+/g, ' ').slice(0, 220),
      };
    case 'commit':
      return {
        kind,
        title: (item.repository?.full_name ?? '') + ' ' + String(item.sha ?? '').slice(0, 7),
        url: item.html_url ?? '',
        detail: (item.commit?.message ?? '').replace(/\s+/g, ' ').slice(0, 220),
        extra: { author: item.commit?.author?.name ?? '', date: item.commit?.author?.date ?? '' },
      };
  }
}

/** Query one GitHub search endpoint. Returns {hits, total, rateLimited, authRequired}. */
/** Human-readable quota state from GitHub's own headers (remaining / reset / retry-after). */
export function rateLimitNote(res: Response): string {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const retryAfter = Number(res.headers.get('retry-after'));
  const bits: string[] = [];
  if (remaining != null) bits.push('remaining ' + remaining);
  if (Number.isFinite(reset) && reset > 0) bits.push('resets in ' + Math.max(0, Math.round((reset * 1000 - Date.now()) / 1000)) + 's');
  if (Number.isFinite(retryAfter) && retryAfter > 0) bits.push('retry-after ' + retryAfter + 's');
  return bits.length ? ' [' + bits.join(', ') + ']' : '';
}

export async function githubSearch(
  kind: GitHubKind,
  q: string,
  opts: { perPage?: number; sort?: string; order?: string } = {},
): Promise<{ hits: GitHubHit[]; total: number; error?: string; note?: string }> {
  const perPage = Math.min(Math.max(opts.perPage ?? 10, 1), 50);
  const token = githubToken();
  const params = new URLSearchParams({ q, per_page: String(perPage) });
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.order) params.set('order', opts.order);
  const headers: Record<string, string> = { ...UA };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (kind === 'commit') headers.Accept = 'application/vnd.github+json';
  let res: Response;
  try {
    res = await fetch(API + '/search/' + ENDPOINTS[kind] + '?' + params, { headers, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return { hits: [], total: 0, error: 'network: ' + String((e as Error).message) };
  }
  if (res.status === 401) return { hits: [], total: 0, error: 'GitHub 401 — ' + (kind === 'code' ? 'code search requires a token (GITHUB_TOKEN/GH_PAT)' : 'token invalid or missing') };
  // "rate limited" is only actionable if it says HOW limited and WHEN it resets. GitHub sends both
  // in headers, and retry-after on a secondary limit; throwing them away leaves the caller unable to
  // tell "wait 20 seconds" from "you are out for an hour".
  if (res.status === 403 || res.status === 429) {
    return { hits: [], total: 0, error: 'GitHub ' + res.status + ' — rate limited' + rateLimitNote(res) + (token ? '' : ' (no token: search is 10/min; a GITHUB_TOKEN raises it to 30/min)') };
  }
  if (res.status === 422) return { hits: [], total: 0, error: 'GitHub 422 — invalid query syntax' };
  if (!res.ok) return { hits: [], total: 0, error: 'GitHub ' + res.status + rateLimitNote(res) };
  const note = rateLimitNote(res);
  const j = await res.json().catch(() => null) as { total_count?: number; items?: unknown[] } | null;
  if (!j || !Array.isArray(j.items)) return { hits: [], total: 0, error: 'bad payload' };
  return { hits: j.items.map((it) => mapHit(kind, it)), total: j.total_count ?? 0, ...(note ? { note: 'quota' + note } : {}) };
}
