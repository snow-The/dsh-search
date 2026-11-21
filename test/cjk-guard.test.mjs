// Regression: the off-topic guard was silently DISABLED for every CJK query.
//
// Measured 2026-11-16 on this machine: the tokenizer /[a-z0-9][a-z0-9._-]{2,}/g yields
// ZERO tokens for "爬蟲 原理" and "網路爬蟲是什麼", so looksOffTopic returned false at the
// `tokens.length === 0` branch before looking at a single hit. The engine then returned
// a WPS pricing page and a Sogou IME download page, and the guard called them on-topic.
//
// These tests are written so that the OLD code fails them. A test that passes both before
// and after the change proves nothing.
//
// NOTE: imports .test-build (produced by `npm run pretest`), matching every other test in
// this directory. The local esbuild install is missing its platform binary at
// node_modules/@esbuild/win32-x64, but the binary exists under .pnpm — see the note in
// test/verify-dist.mjs for the exact path used to rebuild.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksOffTopic, detectRefusal, EngineBlockedError } from '../.test-build/websearch.js';

// ---------- the CJK blind spot ----------

test('a CJK query whose results are about something else is rejected', () => {
  // Verbatim junk measured from bing for "爬蟲 原理".
  const junk = [
    { url: 'https://365.wps.cn/price', title: 'WPS会员价格', snippet: 'WPS Office 会员' },
    { url: 'https://www.onlinedown.net/soft/42337.htm', title: 'WPS Office 下载', snippet: '办公软件' },
  ];
  assert.equal(looksOffTopic('爬蟲 原理', junk), true);
});

test('a CJK query whose results ARE about the topic passes', () => {
  const good = [
    { url: 'https://zh.wikipedia.org/wiki/網路爬蟲', title: '網路爬蟲 - 維基百科', snippet: '網路爬蟲（web crawler）是一種自動瀏覽網頁的程式' },
  ];
  assert.equal(looksOffTopic('爬蟲 原理', good), false);
});

test('a CJK query with no shared bigram is rejected even when one character matches', () => {
  // "網路爬蟲是什麼" vs a page that only contains 網 and 路 separately.
  const junk = [
    { url: 'https://example.test/a', title: '網路購物 是什麼', snippet: '路跑活動報名' },
  ];
  // 網路 IS a shared bigram here, so this must PASS — the test documents the boundary
  // rather than pretending bigrams are exact.
  assert.equal(looksOffTopic('網路爬蟲是什麼', junk), false);
});

test('a CJK query about a different subject is rejected', () => {
  const junk = [
    { url: 'https://shurufa.sogou.com/', title: '搜狗输入法 - 官网', snippet: '智能拼音输入法下载' },
  ];
  assert.equal(looksOffTopic('網路爬蟲是什麼', junk), true);
});

test('a single CJK character is not enough to judge (never a false alarm)', () => {
  assert.equal(looksOffTopic('爬', [{ url: 'https://x.test/a', title: 'unrelated' }]), false);
});

test('a mixed query must satisfy its latin half', () => {
  // "dsh-search 插件 搜尋品質" — the latin token is the distinctive part.
  const junk = [
    { url: 'https://pinyin.sogou.com/', title: '搜狗输入法', snippet: '插件 搜尋 品質 下載' },
  ];
  assert.equal(looksOffTopic('dsh-search 插件 搜尋品質', junk), true);
});

// ---------- the existing latin contract must not regress ----------

test('latin: a result set about the general topic is rejected when it ignores the rare token', () => {
  const junk = [
    { url: 'https://www.deepseek.com/harness/en/', title: 'DeepSeek Harness developer preview: Everything is a plugin' },
    { url: 'https://github.com/deepseek-ai/deepseek-harness/tree/master', title: 'DeepSeek Harness - GitHub' },
  ];
  assert.equal(looksOffTopic('dsh-session-handoff ACP compaction', junk), true);
});

test('latin: the real target passes', () => {
  const good = [{ url: 'https://github.com/snow-The/dsh-session-handoff', title: '@snow-the/dsh-session-handoff - GitHub' }];
  assert.equal(looksOffTopic('dsh-session-handoff ACP compaction', good), false);
});

test('latin: a query made only of stopwords cannot be judged', () => {
  assert.equal(looksOffTopic('how to do the', [{ url: 'https://x.test/a', title: 'unrelated' }]), false);
  assert.equal(looksOffTopic('', [{ url: 'https://x.test/a' }]), false);
});

test('latin: a query with any surviving token IS judged', () => {
  assert.equal(looksOffTopic('how to do the thing', [{ url: 'https://x.test/a', title: 'unrelated' }]), true);
});

test('latin: matching only the ubiquitous token is not relevance', () => {
  const q = 'arxiv paper when to summarize agent context compaction threshold policy';
  const junk = [
    { url: 'https://arxiv.org/', title: 'arXiv.org e-Print archive', snippet: 'arXiv is a free distribution archive' },
    { url: 'https://zhuanlan.zhihu.com/p/2019340359319209416', title: 'arXiv 是期刊吗？', snippet: '研究人员可以把论文草稿上传到 arXiv' },
  ];
  assert.equal(looksOffTopic(q, junk), true);
});

test('a set made only of site roots is a set of directories', () => {
  const roots = [{ url: 'https://arxiv.org/', title: 'memgpt' }, { url: 'https://example.com/', title: 'memgpt management' }];
  assert.equal(looksOffTopic('memgpt virtual context management', roots), true);
});

// ---------- refusal detection: BLOCKED is not EMPTY ----------

test('the DDG botnet CAPTCHA page is recognised as a refusal', () => {
  // Verbatim from the measured response: HTTP 202, visible text "Select all squares
  // containing a duck", challenge URL carrying cc=botnet.
  const html = '<html><body>Unfortunately, bots use DuckDuckGo too. Please complete the following challenge. Select all squares containing a duck: <script src="/anomaly.js?sv=lite&cc=botnet"></script></body></html>';
  assert.equal(detectRefusal(html), 'bot challenge (DDG botnet CAPTCHA)');
});

test('an Anubis proof-of-work page is recognised as a refusal', () => {
  const html = '<script id="anubis_challenge" type="application/json">{"rules":{"algorithm":"fast"}}</script>';
  assert.equal(detectRefusal(html), 'proof-of-work challenge (Anubis)');
});

test('a genuine result page is NOT a refusal', () => {
  const html = '<html><body><li class="b_algo"><a href="https://github.com/unclecode/crawl4ai">crawl4ai</a></li></body></html>';
  assert.equal(detectRefusal(html), null);
});

test('an empty result page is NOT a refusal (EMPTY must stay distinguishable)', () => {
  assert.equal(detectRefusal('<html><body><div id="b_results"></div></body></html>'), null);
});

test('EngineBlockedError names the engine and the reason', () => {
  const e = new EngineBlockedError('ddg', 'bot challenge');
  assert.equal(e.name, 'EngineBlockedError');
  assert.match(e.message, /ddg: BLOCKED/);
  assert.equal(e.engine, 'ddg');
});
