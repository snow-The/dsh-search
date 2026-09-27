import type { IncomingMessage, ServerResponse } from 'node:http';
type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;
/** Shortest accepted DSH_SEARCH_HTTP_TOKEN — a short bearer secret is brute-forceable. */
export declare const MIN_TOKEN_LENGTH = 16;
/** The bearer token from a request, or null when the header is absent/malformed. */
export declare function bearerToken(req: IncomingMessage): string | null;
/**
 * Whether a request may reach the route table.
 * `token` null/undefined = no token configured = no gate (backward compatible).
 */
export declare function isAuthorized(req: IncomingMessage, token: string | null | undefined): boolean;
/** Route table: [METHOD, pathname, handler]. Exported so tests drive the real table. */
export declare const ROUTES: ReadonlyArray<readonly [string, string, Handler]>;
/**
 * The daemon's request handler (native node:http — no Hono, no Fetch bridge).
 * Auth gate first (no route-existence leak); unknown path -> 404; known path with a
 * different method -> 405 + allow.
 */
export declare function handleRequest(req: IncomingMessage, res: ServerResponse, token?: string | null): Promise<void>;
/**
 * Why the daemon did not start, or null when it is startable. Exported so the plugin
 * can surface a 1-line diagnosis instead of silently serving unauthenticated (the
 * port variable alone would otherwise silently start a tokenless daemon).
 */
export declare function daemonConfigIssue(): string | null;
export declare function maybeStartServer(): (() => void) | null;
export {};
