import type { IncomingMessage, ServerResponse } from 'node:http';
type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;
/** Route table: [METHOD, pathname, handler]. Exported so tests drive the real table. */
export declare const ROUTES: ReadonlyArray<readonly [string, string, Handler]>;
/**
 * The daemon's request handler (native node:http — no Hono, no Fetch bridge).
 * Unknown path -> 404; known path with a different method -> 405 + allow.
 */
export declare function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function maybeStartServer(): (() => void) | null;
export {};
