// "rate limited" without a number is not actionable: GitHub puts remaining / reset / retry-after in
// headers, and the client used to discard all three.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitNote } from '../.test-build/github.js';

test('GitHub quota headers are reported, not swallowed', () => {
  const res = new Response(null, { headers: {
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 42),
    'retry-after': '30',
  } });
  const note = rateLimitNote(res);
  assert.match(note, /remaining 0/, note);
  assert.match(note, /resets in 4[12]s/, note);
  assert.match(note, /retry-after 30s/, note);
});

test('no headers means no note (never invent a quota)', () => {
  assert.equal(rateLimitNote(new Response(null)), '');
});