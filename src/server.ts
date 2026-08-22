/**
 * Optional local HTTP API (hono) for dsh-search — enabled via DSH_SEARCH_HTTP_PORT.
 * Loopback only (127.0.0.1). Endpoints:
 *   GET  /health
 *   GET  /fetch?url=...
 *   POST /corpus      { urls: string[] }
 *   GET  /corpus/search?q=...&k=5
 *   DELETE /corpus
 */
import { Hono } from 'hono';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { extractText, chunkText, embedTexts, getStore, resetStore } from './query.js';
import { githubSearch } from './github.js';

export function createApp(): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, chunks: getStore().count() }));

  app.get('/fetch', async (c) => {
    const url = c.req.query('url') ?? '';
    if (!/^https?:\/\//i.test(url)) return new Response(JSON.stringify({ error: 'url must start with http(s)://' }), { status: 400 , headers: { 'Content-Type': 'application/json' } });
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (dsh-search)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return new Response(JSON.stringify({ error: 'HTTP ' + res.status }), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    return c.json({ url, text: extractText(await res.text()) });
  });

  app.get('/github', async (c) => {
    const q = c.req.query('q') ?? '';
    const kind = (c.req.query('type') ?? 'repo') as 'repo' | 'code' | 'issue' | 'commit';
    if (!q) return new Response(JSON.stringify({ error: 'q required' }), { status: 400 , headers: { 'Content-Type': 'application/json' } });
    const r = await githubSearch(kind, q, { perPage: Number(c.req.query('perPage')) || 10 });
    return c.json(r);
  });

  app.post('/corpus', async (c) => {
    const body = await c.req.json<{ urls?: string[] }>().catch(() => ({ urls: [] as string[] }));
    const urls = (body.urls ?? []).filter((u: string) => /^https?:\/\//i.test(u));
    if (!urls.length) return new Response(JSON.stringify({ error: 'no valid urls' }), { status: 400 , headers: { 'Content-Type': 'application/json' } });
    const store = getStore();
    let indexed = 0;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (dsh-search)' },
          redirect: 'follow',
          signal: AbortSignal.timeout(25000),
        });
        if (!res.ok) continue;
        const chunks = chunkText(extractText(await res.text()));
        if (!chunks.length) continue;
        indexed += store.add(url, chunks, await embedTexts(chunks));
      } catch { /* skip */ }
    }
    return c.json({ indexed, total: store.count() });
  });

  app.get('/corpus/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const k = Math.min(Number(c.req.query('k') ?? 5) || 5, 20);
    if (!q.trim()) return new Response(JSON.stringify({ error: 'q required' }), { status: 400 , headers: { 'Content-Type': 'application/json' } });
    const vec = (await embedTexts([q]))[0];
    return c.json({ results: getStore().search(vec, k) });
  });

  app.delete('/corpus', (c) => {
    getStore().clear();
    return c.json({ cleared: true });
  });

  return app;
}

export function maybeStartServer(): (() => void) | null {
  const port = Number(process.env.DSH_SEARCH_HTTP_PORT ?? 0);
  if (!port) return null;
  const app = createApp();
  const server = createServer((req, res) => {
    const url = 'http://127.0.0.1:' + port + (req.url ?? '/');
    const hasBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
    const init: RequestInit = {
      method: req.method,
      headers: req.headers as Record<string, string>,
    };
    if (hasBody) init.body = Readable.toWeb(req) as unknown as BodyInit;
    (async () => {
      try {
        const r = await app.fetch(new Request(url, init));
        res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
        res.end(await r.text());
      } catch (e) {
        res.writeHead(500);
        res.end(String((e as Error).message ?? e));
      }
    })();
  });
  server.listen(port, '127.0.0.1');
  return () => {
    try { server.close(); } catch { /* noop */ }
    resetStore();
  };
}
