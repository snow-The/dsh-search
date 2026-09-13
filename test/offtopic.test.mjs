// Regression: "不同上下文串到了" — an engine whose parser ignores the distinctive query
// token returned a page about the general topic and the caller could not tell.
// Measured: query "dsh-session-handoff ACP compaction" -> bing gave deepseek.com/harness
// (a different context), ddg gave github.com/snow-The/dsh-session-handoff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksOffTopic } from '../.test-build/websearch.js';

test('a result set about the general topic is rejected when it ignores the rare token', () => {
  const q = 'dsh-session-handoff ACP compaction';
  const junk = [
    { url: 'https://www.deepseek.com/harness/en/', title: 'DeepSeek Harness developer preview: Everything is a plugin' },
    { url: 'https://github.com/deepseek-ai/deepseek-harness/tree/master', title: 'DeepSeek Harness - GitHub' },
  ];
  assert.equal(looksOffTopic(q, junk), true);
});

test('the real target passes', () => {
  const q = 'dsh-session-handoff ACP compaction';
  const good = [{ url: 'https://github.com/snow-The/dsh-session-handoff', title: '@snow-the/dsh-session-handoff - GitHub' }];
  assert.equal(looksOffTopic(q, good), false);
});

test('a query made only of stopwords cannot be judged (never a false alarm)', () => {
  // 'thing' would survive the filter, so use a genuinely contentless query here.
  assert.equal(looksOffTopic('how to do the', [{ url: 'https://x.test/a', title: 'unrelated' }]), false);
  assert.equal(looksOffTopic('', [{ url: 'https://x.test/a' }]), false);
});

test('a query with any surviving token IS judged (no silent pass)', () => {
  assert.equal(looksOffTopic('how to do the thing', [{ url: 'https://x.test/a', title: 'unrelated' }]), true);
});
