/**
 * OpenAPI 3.x generic API caller for dsh-search.
 *
 * Loads an OpenAPI document (JSON or YAML, v2/3.0/3.1), resolves an operation
 * by operationId or "METHOD /path", and executes it against the spec's server
 * with path/query/header/body params and optional auth.
 *
 * Spec source can be: an http(s) URL, a local file path, a JSON/YAML string,
 * or an already-parsed object.
 */
import { parse as yamlParse } from 'yaml';
import { readFileSync, existsSync } from 'node:fs';

interface SpecDoc {
  openapi?: string;
  swagger?: string;
  servers?: { url: string; [k: string]: unknown }[];
  paths?: Record<string, Record<string, unknown>>;
  components?: { securitySchemes?: Record<string, unknown>; schemas?: Record<string, unknown> };
  security?: unknown[];
}

interface ResolvedOperation {
  pathTemplate: string;
  method: string;
  operation: Record<string, unknown>;
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^file:\/\//i.test(s);
}

async function loadSpecText(spec: string): Promise<string> {
  if (looksLikeUrl(spec)) {
    const res = await fetch(spec, {
      headers: { 'User-Agent': 'dsh-search', Accept: 'application/json, application/yaml, text/yaml, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('spec fetch failed: HTTP ' + res.status + ' ' + spec);
    return await res.text();
  }
  if (existsSync(spec)) {
    return readFileSync(spec, 'utf8');
  }
  return spec;
}

export async function parseSpec(spec: string | Record<string, unknown>): Promise<SpecDoc> {
  if (typeof spec !== 'string') return spec as SpecDoc;
  const text = await loadSpecText(spec);
  const trimmed = text.trim();
  if (!trimmed) throw new Error('empty spec');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as SpecDoc;
  }
  try {
    return yamlParse(text) as SpecDoc;
  } catch (e) {
    try { return JSON.parse(trimmed) as SpecDoc; }
    catch { throw new Error('spec parse failed: ' + String((e as Error).message)); }
  }
}

function findOpByOperationId(doc: SpecDoc, operationId: string): ResolvedOperation | null {
  const paths = doc.paths ?? {};
  for (const pathTemplate of Object.keys(paths)) {
    const item = paths[pathTemplate] ?? {};
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = item[method];
      if (op && typeof op === 'object' && (op as { operationId?: string }).operationId === operationId) {
        return { pathTemplate, method, operation: op as Record<string, unknown> };
      }
    }
  }
  return null;
}

export function resolveOperation(doc: SpecDoc, operation: string): ResolvedOperation {
  const m = /^\s*(get|post|put|patch|delete|head|options)\s+(\/\S*)\s*$/i.exec(operation);
  if (m) {
    const method = m[1].toLowerCase();
    const pathTemplate = m[2];
    const op = (doc.paths?.[pathTemplate]?.[method]) as Record<string, unknown> | undefined;
    if (!op) throw new Error('operation not found: ' + method.toUpperCase() + ' ' + pathTemplate);
    return { pathTemplate, method, operation: op };
  }
  const pathOnly = /^\s*(\/\S*)\s*$/.exec(operation);
  if (pathOnly) {
    const pathTemplate = pathOnly[1];
    const op = (doc.paths?.[pathTemplate]?.get) as Record<string, unknown> | undefined;
    if (!op) throw new Error('GET ' + pathTemplate + ' not found');
    return { pathTemplate, method: 'get', operation: op };
  }
  const byId = findOpByOperationId(doc, operation.trim());
  if (byId) return byId;
  throw new Error('operation not found (not operationId, nor "METHOD /path"): ' + operation);
}

function collectParams(doc: SpecDoc, op: ResolvedOperation): any[] {
  const item = doc.paths?.[op.pathTemplate] ?? {};
  const list: any[] = [];
  const push = (p: unknown) => {
    if (p && typeof p === 'object' && (p as { $ref?: string }).$ref) {
      const ref = (p as { $ref: string }).$ref.replace(/^#\//, '').split('/');
      let cur: any = doc;
      for (const seg of ref) cur = cur?.[decodeURIComponent(seg)];
      if (cur && typeof cur === 'object') push(cur);
      return;
    }
    if (p && typeof p === 'object') list.push(p);
  };
  const pathParams = Array.isArray(item.parameters) ? item.parameters : [];
  const opParams = Array.isArray(op.operation.parameters) ? op.operation.parameters : [];
  for (const p of pathParams) push(p);
  for (const p of opParams) push(p);
  return list;
}

function resolveAuthToken(auth: string | undefined): string | undefined {
  if (!auth) return undefined;
  if (auth.startsWith('env:')) {
    return process.env[auth.slice(4)] || undefined;
  }
  if (auth === 'github' || auth === 'gh') {
    try {
      const { execSync } = require('node:child_process') as typeof import('node:child_process');
      const t = execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return t || undefined;
    } catch {
      return process.env.GITHUB_TOKEN || process.env.GH_PAT || undefined;
    }
  }
  return auth;
}

export function buildRequest(
  doc: SpecDoc,
  op: ResolvedOperation,
  params: Record<string, unknown>,
  opts: { server?: string; auth?: string } = {},
) {
  const baseUrl = opts.server
    ? opts.server.replace(/\/+$/, '')
    : ((doc.servers?.[0]?.url) || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('no server URL in spec — pass server= override');

  let path = op.pathTemplate;
  const query: string[] = [];
  const headers: Record<string, string> = { 'User-Agent': 'dsh-search/openapi', Accept: 'application/json' };
  let body: string | undefined;
  const securitySchemes = doc.components?.securitySchemes ?? {};

  for (const p of collectParams(doc, op)) {
    const name = String(p.name ?? '');
    const where = String(p.in ?? '');
    const val = params[name];
    if (val === undefined) continue;
    if (where === 'path') {
      path = path.replaceAll('{' + name + '}', encodeURIComponent(String(val)));
    } else if (where === 'query') {
      query.push(encodeURIComponent(name) + '=' + encodeURIComponent(typeof val === 'object' ? JSON.stringify(val) : String(val)));
    } else if (where === 'header') {
      headers[name] = String(val);
    }
  }

  const missing = [...path.matchAll(/\{([^}]+)\}/g)].map((mm) => mm[1]);
  if (missing.length) throw new Error('missing path params: ' + missing.join(', ') + ' (pass params= {name: value})');

  const rb = op.operation.requestBody as { content?: Record<string, { schema?: unknown }> } | { $ref?: string } | undefined;
  const bodyObj = params.body ?? params.requestBody;
  if (rb && bodyObj !== undefined) {
    let content: Record<string, { schema?: unknown }> | undefined;
    if ((rb as { $ref?: string }).$ref) {
      const ref = (rb as { $ref: string }).$ref.replace(/^#\//, '').split('/');
      let cur: any = doc;
      for (const seg of ref) cur = cur?.[decodeURIComponent(seg)];
      content = (cur as { content?: Record<string, { schema?: unknown }> })?.content;
    } else {
      content = (rb as { content?: Record<string, { schema?: unknown }> }).content;
    }
    const ctype = Object.keys(content ?? {}).find((c) => c.includes('json')) ?? Object.keys(content ?? {})[0];
    if (ctype) {
      if (ctype.includes('json')) {
        headers['Content-Type'] = 'application/json';
        body = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
      } else if (ctype.includes('x-www-form-urlencoded')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(Object.entries(bodyObj as Record<string, string>)).toString();
      }
    }
  }

  const authToken = resolveAuthToken(opts.auth);
  const opSecurity = (op.operation.security as unknown[]) ?? doc.security;
  const schemeRef = Array.isArray(opSecurity) && opSecurity.length
    ? Object.keys(opSecurity[0] as Record<string, unknown>)[0]
    : undefined;
  const scheme = schemeRef ? (securitySchemes[schemeRef] as { type?: string; name?: string; in?: string; scheme?: string } | undefined) : undefined;
  if (authToken) {
    if (scheme?.type === 'apiKey') {
      const keyName = scheme.name ?? 'Authorization';
      if (scheme.in === 'query') query.push(encodeURIComponent(keyName) + '=' + encodeURIComponent(authToken));
      else if (scheme.in === 'header') headers[keyName] = authToken;
    } else if (scheme?.scheme === 'basic') {
      headers.Authorization = 'Basic ' + Buffer.from(authToken + ':x-oauth-basic').toString('base64');
    } else {
      headers.Authorization = 'Bearer ' + authToken;
    }
  }

  const qs = query.length ? '?' + query.join('&') : '';
  return { url: baseUrl + path + qs, method: op.method.toUpperCase(), headers, body };
}

export function formatResult(status: number, headers: Headers, json: unknown): string {
  const lines: string[] = [];
  lines.push('HTTP ' + status + (headers.get('x-ratelimit-remaining') ? ' | rate-limit-remaining: ' + headers.get('x-ratelimit-remaining') : ''));
  if (json === null || json === undefined) return lines.join('\n');
  if (Array.isArray(json)) {
    lines.push('[' + json.length + ' items]');
    for (const it of json.slice(0, 20)) {
      if (it && typeof it === 'object') {
        const o = it as Record<string, unknown>;
        const title = o.full_name || o.name || o.title || o.login || o.path || o.id || (Object.values(o)[0] ?? '');
        lines.push('• ' + String(title).slice(0, 200));
      } else {
        lines.push('• ' + String(it).slice(0, 200));
      }
    }
    if (json.length > 20) lines.push('… +' + (json.length - 20) + ' more');
    return lines.join('\n');
  }
  if (typeof json === 'object') {
    const s = JSON.stringify(json, null, 2);
    return s.length > 4000 ? s.slice(0, 4000) + '\n… (truncated)' : s;
  }
  return String(json).slice(0, 4000);
}

export interface OpenApiCallArgs {
  spec: string | Record<string, unknown>;
  operation: string;
  params?: Record<string, unknown>;
  server?: string;
  auth?: string;
  timeoutMs?: number;
}

export async function callOpenApi(args: OpenApiCallArgs): Promise<string> {
  const doc = await parseSpec(args.spec);
  const op = resolveOperation(doc, args.operation);
  const req = buildRequest(doc, op, args.params ?? {}, { server: args.server, auth: args.auth });
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: AbortSignal.timeout(args.timeoutMs ?? 60000),
  });
  const text = await res.text();
  let json: unknown = text;
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  return formatResult(res.status, res.headers, json);
}
