// Auth gate of the optional local HTTP daemon (src/server.ts).
//
// Why this file exists: the daemon is this plugin's ONLY HTTP surface, and the
// official ctx.webServer carries no fence of its own (dsh-host-webserver has no
// auth code at all). So the bearer gate is the entire access control, and it needs
// both directions proven: it must let the right token through AND stop everything
// else — a gate that rejects everyone would also "pass" a reject-only test.
//
// Imported from the pre-bundled build (npm run pretest) for the same reason as
// smoke.mjs: src uses .js specifiers for .ts modules, unresolvable for plain node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, isAuthorized, bearerToken, daemonConfigIssue, MIN_TOKEN_LENGTH } from '../.test-build/server.js';

const TOKEN = 'a'.repeat(MIN_TOKEN_LENGTH);

/** Fake node:http req/res pair — `headers` is what the gate reads. */
const call = async (method, path, headers = {}, token = TOKEN) => {
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    end(b) { this.body = b },
  };
  // Pass the token EXPLICITLY. The default is process.env.DSH_SEARCH_HTTP_TOKEN, and
  // this suite runs without it — which is itself the backward-compat contract (no env
  // token = no gate = smoke.mjs sees 200s), so never let the ambient env decide here.
  await handleRequest({ method, url: path, headers }, res, token);
  const text = String(res.body ?? '');
  return { status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text || 'null') };
};

// --- the gate itself ---------------------------------------------------------------

test('no token configured = no gate (backward compatible)', () => {
  assert.equal(isAuthorized({ headers: {} }, null), true);
  assert.equal(isAuthorized({ headers: {} }, undefined), true);
});

test('token configured: missing / wrong / malformed headers are all rejected', () => {
  assert.equal(isAuthorized({ headers: {} }, TOKEN), false, 'no header');
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer ' + 'b'.repeat(MIN_TOKEN_LENGTH) } }, TOKEN), false, 'wrong token');
  assert.equal(isAuthorized({ headers: { authorization: TOKEN } }, TOKEN), false, 'bare token, no Bearer scheme');
  assert.equal(isAuthorized({ headers: { authorization: 'Basic ' + TOKEN } }, TOKEN), false, 'wrong scheme');
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer ' } }, TOKEN), false, 'empty credential');
});

test('token configured: the right token passes, case-insensitive scheme', () => {
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer ' + TOKEN } }, TOKEN), true);
  assert.equal(isAuthorized({ headers: { authorization: 'bearer ' + TOKEN } }, TOKEN), true, 'RFC 7235 scheme is case-insensitive');
  assert.equal(isAuthorized({ headers: { authorization: 'BEARER ' + TOKEN } }, TOKEN), true);
  assert.equal(bearerToken({ headers: { authorization: 'Bearer  ' + TOKEN + ' ' } }), TOKEN, 'extra whitespace tolerated');
});

test('a token that is a prefix of the real one is rejected', () => {
  // Guards against a truncating/startswith comparison sneaking in.
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer ' + 'a'.repeat(MIN_TOKEN_LENGTH - 1) } }, TOKEN), false);
});

// --- the gate as wired into handleRequest -------------------------------------------

test('handleRequest: authorized request still reaches the route (401 is not blanket)', async () => {
  const r = await call('GET', '/health', { authorization: 'Bearer ' + TOKEN });
  assert.equal(r.status, 200);
  assert.equal(r.json().ok, true);
});

test('handleRequest: unauthorized request gets 401 + WWW-Authenticate, no route leak', async () => {
  for (const [method, path] of [['GET', '/health'], ['GET', '/fetch'], ['GET', '/nope'], ['DELETE', '/corpus']]) {
    const r = await call(method, path, {});
    assert.equal(r.status, 401, `${method} ${path} must be 401 without a token`);
    assert.equal(r.headers['www-authenticate'], 'Bearer');
    assert.equal(r.json().error, 'unauthorized');
    // An unknown path must NOT answer 404 while unauthenticated — that would leak
    // which paths exist to someone who cannot authenticate.
    assert.notEqual(r.json().error, 'not found', `${method} ${path} leaked route existence`);
  }
});

test('handleRequest: no token (explicit null) -> routes behave exactly as before', async () => {
  const absent = await call('GET', '/health', {}, null);
  assert.equal(absent.status, 200, 'null token = gate open, so smoke.mjs keeps working');
  // And the env-driven default: with DSH_SEARCH_HTTP_TOKEN unset (this suite's ambient
  // state) omitting the argument must behave identically.
  const saved = process.env.DSH_SEARCH_HTTP_TOKEN;
  delete process.env.DSH_SEARCH_HTTP_TOKEN;
  try {
    const res = { statusCode: 0, headers: {}, body: undefined, setHeader() {}, end(b) { this.body = b } };
    await handleRequest({ method: 'GET', url: '/health', headers: {} }, res);
    assert.equal(res.statusCode, 200, 'omitted token + unset env = gate open');
  } finally {
    if (saved !== undefined) process.env.DSH_SEARCH_HTTP_TOKEN = saved;
  }
});

// --- startup refusal ------------------------------------------------------------------

test('daemonConfigIssue: port without token refuses to start', () => {
  const saved = { port: process.env.DSH_SEARCH_HTTP_PORT, token: process.env.DSH_SEARCH_HTTP_TOKEN };
  try {
    delete process.env.DSH_SEARCH_HTTP_PORT;
    assert.equal(daemonConfigIssue(), null, 'no port requested = nothing to diagnose');

    process.env.DSH_SEARCH_HTTP_PORT = '7391';
    delete process.env.DSH_SEARCH_HTTP_TOKEN;
    assert.match(String(daemonConfigIssue()), /DSH_SEARCH_HTTP_TOKEN is not/);

    process.env.DSH_SEARCH_HTTP_TOKEN = 'short';
    assert.match(String(daemonConfigIssue()), /shorter than/);

    process.env.DSH_SEARCH_HTTP_TOKEN = TOKEN;
    assert.equal(daemonConfigIssue(), null, 'port + adequate token = startable');
  } finally {
    if (saved.port === undefined) delete process.env.DSH_SEARCH_HTTP_PORT; else process.env.DSH_SEARCH_HTTP_PORT = saved.port;
    if (saved.token === undefined) delete process.env.DSH_SEARCH_HTTP_TOKEN; else process.env.DSH_SEARCH_HTTP_TOKEN = saved.token;
  }
});
