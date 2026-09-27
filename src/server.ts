/**
 * Optional local HTTP API for dsh-search — enabled via DSH_SEARCH_HTTP_PORT.
 * Loopback only (127.0.0.1). Endpoints:
 *   GET    /health
 *   GET    /fetch?url=...
 *   GET    /github?q=...&type=repo|code|issue|commit&perPage=10
 *   POST   /corpus      { urls: string[] }
 *   GET    /corpus/search?q=...&k=5
 *   DELETE /corpus
 *
 * 这不是 ctx.webServer 的重复: ctx.webServer 挂在 DSH 自己的 web GUI 端口上, 而这里是
 * 一个**自带端口、默认关闭**(DSH_SEARCH_HTTP_PORT 未设 = 不启动)的独立 loopback daemon,
 * 供外部消费者使用, 与 GUI 同源策略无关。两者生命周期/地址/鉴权模型都不同, 所以保留。
 *
 * 原实现是一个 Hono app + `app.fetch(new Request(...))` 的 Node↔Fetch 桥, 桥本身是
 * 载荷路径(每次请求都要把 IncomingMessage 转成 web Request)。官方 web 层本来就是
 * node:http, handler 拿原生 IncomingMessage/ServerResponse(见 dsh 源码
 * host/open-in-app/src/index.ts:193-204) —— 这个 daemon 也不例外: 直接写 res,
 * 于是 hono 与那座桥一起消失, 路由/状态码/响应体保持不变。
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extractText, chunkText, embedTexts, getStore, resetStore } from './query.js';
import { githubSearch } from './github.js';

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

const sendJson = (res: ServerResponse, status: number, value: unknown): void => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
};

/** Read the whole request body as UTF-8 — native replacement for Readable.toWeb(req). */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const BROWSER_HEADERS = { 'User-Agent': 'Mozilla/5.0 (dsh-search)' } as const;

const fetchPage = (url: string): Promise<Response> =>
  fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(25000) });

const isHttpUrl = (u: string): boolean => /^https?:\/\//i.test(u);

/** Route table: [METHOD, pathname, handler]. Exported so tests drive the real table. */
export const ROUTES: ReadonlyArray<readonly [string, string, Handler]> = [
  ['GET', '/health', (_req, res) => {
    sendJson(res, 200, { ok: true, chunks: getStore().count() });
  }],

  ['GET', '/fetch', async (_req, res, url) => {
    const target = url.searchParams.get('url') ?? '';
    if (!isHttpUrl(target)) {
      sendJson(res, 400, { error: 'url must start with http(s)://' });
      return;
    }
    const page = await fetchPage(target);
    if (!page.ok) {
      sendJson(res, page.status, { error: 'HTTP ' + page.status });
      return;
    }
    sendJson(res, 200, { url: target, text: extractText(await page.text()) });
  }],

  ['GET', '/github', async (_req, res, url) => {
    const q = url.searchParams.get('q') ?? '';
    const kind = (url.searchParams.get('type') ?? 'repo') as 'repo' | 'code' | 'issue' | 'commit';
    if (!q) {
      sendJson(res, 400, { error: 'q required' });
      return;
    }
    const r = await githubSearch(kind, q, { perPage: Number(url.searchParams.get('perPage')) || 10 });
    sendJson(res, 200, r);
  }],

  ['POST', '/corpus', async (req, res) => {
    let body: { urls?: string[] } = {};
    try {
      body = JSON.parse(await readBody(req)) as { urls?: string[] };
    } catch { /* malformed body -> treated as no urls (same as the old .catch fallback) */ }
    const urls = (body?.urls ?? []).filter((u: string) => isHttpUrl(u));
    if (!urls.length) {
      sendJson(res, 400, { error: 'no valid urls' });
      return;
    }
    const store = getStore();
    let indexed = 0;
    for (const u of urls) {
      try {
        const page = await fetchPage(u);
        if (!page.ok) continue;
        const chunks = chunkText(extractText(await page.text()));
        if (!chunks.length) continue;
        indexed += store.add(u, chunks, await embedTexts(chunks));
      } catch { /* skip */ }
    }
    sendJson(res, 200, { indexed, total: store.count() });
  }],

  ['GET', '/corpus/search', async (_req, res, url) => {
    const q = url.searchParams.get('q') ?? '';
    const k = Math.min(Number(url.searchParams.get('k') ?? 5) || 5, 20);
    if (!q.trim()) {
      sendJson(res, 400, { error: 'q required' });
      return;
    }
    const vec = (await embedTexts([q]))[0];
    sendJson(res, 200, { results: getStore().search(vec, k) });
  }],

  ['DELETE', '/corpus', (_req, res) => {
    getStore().clear();
    sendJson(res, 200, { cleared: true });
  }],
];

/**
 * The daemon's request handler (native node:http — no Hono, no Fetch bridge).
 * Unknown path -> 404; known path with a different method -> 405 + allow.
 */
export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const method = (req.method ?? 'GET').toUpperCase();
  const onPath = ROUTES.filter(([, path]) => path === url.pathname);
  const route = onPath.find(([m]) => m === method);
  if (!route) {
    if (onPath.length > 0) {
      res.statusCode = 405;
      res.setHeader('allow', onPath.map(([m]) => m).join(', '));
      res.end();
      return;
    }
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  try {
    await route[2](req, res, url);
  } catch (e) {
    sendJson(res, 500, { error: String((e as Error).message ?? e) });
  }
}

export function maybeStartServer(): (() => void) | null {
  const port = Number(process.env.DSH_SEARCH_HTTP_PORT ?? 0);
  if (!port) return null;
  const server = createServer((req, res) => { void handleRequest(req, res); });
  server.listen(port, '127.0.0.1');
  return () => {
    try { server.close(); } catch { /* noop */ }
    resetStore();
  };
}
