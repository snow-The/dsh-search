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
export declare function createApp(): Hono;
export declare function maybeStartServer(): (() => void) | null;
