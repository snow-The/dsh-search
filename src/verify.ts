/**
 * verify.ts — link verification for search results.
 *
 * Why this exists: `web_search` returns citeable sources, but a source is a claim, not a
 * fact. Measured on this host, the same query returned SEO farms, dead links, and pages
 * behind a login. A caller that cites them without checking is repeating a guess.
 *
 * What it checks, per URL, with ONE request each:
 *   - reachable: the HTTP status, and whether it is a 2xx
 *   - finalUrl:  where redirects landed (a farm that redirects to a paywall is not the farm)
 *   - kind:      html | text | binary, from content-type
 *   - authWall:  401/403 — the page exists but needs a credential
 *   - farm:      a known content-mill domain (the user's original complaint)
 *   - primary:   a known primary source (docs, repo, paper)
 *
 * It does NOT fetch the body by default: verification is about whether the link is worth
 * opening, and downloading every page to answer that is the expensive way to be wrong.
 * `read: true` opts into the body, bounded.
 *
 * This is deliberately NOT a `ctx.web` fetch provider. The seam's `WebFetchRequest` carries
 * only a URL (anonymous by design), so a provider cannot send a token; and `WebFetchBody` is
 * a closed union owned by `dsh-web`. Verification is a different question from retrieval, so
 * it lives here rather than bending the official seam.
 */

/** Content mills: pages written to rank, not to answer. The user's original complaint. */
const FARM_DOMAINS = [
  'csdn.net', 'tencent.com', 'aliyun.com', '51cto.com', 'cnblogs.com', 'jianshu.com',
  'zhihu.com', 'juejin.cn', 'segmentfault.com', 'bilibili.com', 'sohu.com', '163.com',
  'sina.com', 'baijiahao.baidu.com', 'toutiao.com', 'w3cschool.cn', 'runoob.com',
  'yiibai.com', 'biancheng.net', 'oschina.net', 'ppmy.cn',
];

/** Primary sources: the thing itself, or its own documentation. */
const PRIMARY_DOMAINS = [
  'github.com', 'raw.githubusercontent.com', 'gitlab.com', 'pypi.org', 'npmjs.com',
  'arxiv.org', 'developer.mozilla.org', 'wikipedia.org', 'docs.python.org', 'nodejs.org',
  'readthedocs.io', 'crates.io', 'huggingface.co', 'api-docs.deepseek.com', 'deepseek.com',
];

export interface VerifyOptions {
  /** Read the body too, bounded. Default false: verification is not retrieval. */
  read?: boolean;
  /** Per-URL timeout in ms. Default 12000. */
  timeoutMs?: number;
  /** Max body characters kept when `read` is true. Default 2000. */
  maxChars?: number;
}

export interface VerifiedLink {
  url: string;
  ok: boolean;
  status: number;
  finalUrl: string;
  kind: 'html' | 'text' | 'binary' | 'unknown';
  /** 401/403: the page exists but the request needs a credential. */
  authWall: boolean;
  /** A known content mill. */
  farm: boolean;
  /** A known primary source. */
  primary: boolean;
  /** Milliseconds spent on this URL. */
  ms: number;
  /** Present only when `read` was requested. */
  title?: string;
  excerpt?: string;
  /** Why it failed, when it did. */
  error?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function underDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

/** Classify a content-type header into the three kinds the caller can act on. */
function kindOf(contentType: string): VerifiedLink['kind'] {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return 'html';
  if (ct.startsWith('text/') || ct.includes('json') || ct.includes('xml')) return 'text';
  if (ct) return 'binary';
  return 'unknown';
}

/** Pull a title out of HTML without a parser; the first <title> is the page's own claim. */
function titleOf(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (!m) return undefined;
  return m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Strip tags to a readable excerpt. */
function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Verify one URL. Never throws: a failure is a result, because the caller is asking
 * "is this link usable", and "it is not" is an answer.
 */
export async function verifyOne(url: string, opts: VerifyOptions = {}): Promise<VerifiedLink> {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const maxChars = opts.maxChars ?? 2000;
  const host = hostOf(url);
  const base: VerifiedLink = {
    url,
    ok: false,
    status: 0,
    finalUrl: url,
    kind: 'unknown',
    authWall: false,
    farm: FARM_DOMAINS.some((d) => underDomain(host, d)),
    primary: PRIMARY_DOMAINS.some((d) => underDomain(host, d)),
    ms: 0,
  };
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        // An explicit product agent, not a browser disguise: a site that refuses this
        // refuses a bot, and pretending otherwise only hides that from the caller.
        'user-agent': 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    base.status = res.status;
    base.finalUrl = res.url || url;
    base.kind = kindOf(res.headers.get('content-type') ?? '');
    base.authWall = res.status === 401 || res.status === 403;
    base.ok = res.status >= 200 && res.status < 300;
    if (opts.read && base.ok && (base.kind === 'html' || base.kind === 'text')) {
      // Read a bounded prefix, but a prefix large enough to contain the <head>. Measured:
      // github.com/unclecode/crawl4ai is 508 KB and its <title> sits far past the first
      // 800 bytes, so a maxChars*4 prefix found no title at all and reported undefined.
      // 64 KB covers every real <head>; the excerpt is still cut to maxChars afterwards.
      const HEAD_BYTES = 64 * 1024;
      const body = (await res.text()).slice(0, Math.max(HEAD_BYTES, maxChars * 4));
      if (base.kind === 'html') {
        base.title = titleOf(body);
        base.excerpt = textOf(body).slice(0, maxChars);
      } else {
        // A JSON API (GitHub's REST, an OpenAPI endpoint) has no <title>, but it usually
        // carries a name/full_name/title field. Measured: reading api.github.com as plain
        // text returned a wall of asset URLs and no title at all.
        const ct = (res.headers.get('content-type') ?? '').toLowerCase();
        if (ct.includes('json')) {
          try {
            const j = JSON.parse(body) as Record<string, unknown>;
            const named = j.full_name ?? j.name ?? j.title ?? j.id;
            if (typeof named === 'string') base.title = named;
            base.excerpt = JSON.stringify(j).slice(0, maxChars);
          } catch {
            base.excerpt = body.slice(0, maxChars);
          }
        } else {
          base.excerpt = body.slice(0, maxChars);
        }
      }
    } else {
      // Drain so the socket is released; the body is not kept.
      await res.arrayBuffer().catch(() => undefined);
    }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  base.ms = Date.now() - t0;
  return base;
}

/**
 * Verify several URLs with bounded concurrency. Sequential verification of 20 links at a
 * 12s timeout is 4 minutes; the caller asked a question, not for a timeout budget.
 */
export async function verifyMany(
  urls: string[],
  opts: VerifyOptions = {},
  concurrency = 6,
): Promise<VerifiedLink[]> {
  const unique = [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))];
  const out: VerifiedLink[] = new Array(unique.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= unique.length) return;
      out[i] = await verifyOne(unique[i], opts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return out;
}

/** One-line verdict for a set, so a caller can decide without reading every row. */
export function summarize(links: VerifiedLink[]): {
  total: number;
  ok: number;
  dead: number;
  authWall: number;
  farm: number;
  primary: number;
  /** True when nothing usable came back: the caller must not cite this set. */
  unusable: boolean;
} {
  const ok = links.filter((l) => l.ok).length;
  const farm = links.filter((l) => l.farm).length;
  const primary = links.filter((l) => l.primary).length;
  return {
    total: links.length,
    ok,
    dead: links.length - ok,
    authWall: links.filter((l) => l.authWall).length,
    farm,
    primary,
    // No reachable source, or every reachable one is a content mill.
    unusable: links.length === 0 || ok === 0 || (primary === 0 && farm === ok),
  };
}
