/**
 * dsh-search deepsearch — agentic deep-web investigation loop.
 *
 * Absorbed from google-gemini/gemini-fullstack-langgraph-quickstart,
 * RyotaOzawa0/langgraph-deepsearch-mcp and sentient-agi/OpenDeepSearch:
 *  - plan -> search/probe -> reflect -> synthesize loop (dual termination:
 *    LLM self-assessment OR max iterations)
 *  - parallel multi-query fan-out (map-reduce) with bounded width
 *  - reference anchors [n] appended in the final answer; only sources
 *    actually cited are back-filled
 *  - depth: 'light' (snippets only) vs 'deep' (full-page fetch + chunk + rerank)
 *  - maxIterations clamp 1-5, maxQueries clamp 1-10 (langgraph-deepsearch-mcp)
 *  - probe layer (probe.ts): HN / Reddit / forum endpoints / RSSHub feeds —
 *    the "search engine can't reach" content
 */

import type { ProbeResult, FeedItem } from './probe.js';
import { probeAll, relatedSearches, rsshubBase, fetchFeed, discoverFeed } from './probe.js';
import { extractText, chunkText } from './query.js';

// ---------- LLM bridge (host-provided ctx.llm) ----------
export interface Llm {
  stream: (opts: {
    model?: string;
    system?: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    maxTokens?: number;
  }) => AsyncIterable<{ text?: string; content?: string }>;
  listProviders?: () => Promise<{ id: string; model?: string }[]>;
}

export interface DeepSearchOptions {
  maxIterations?: number;   // clamp 1-5, default 3
  maxQueries?: number;      // clamp 1-10, default 4
  depth?: 'light' | 'deep'; // light = snippets, deep = full-page fetch
  targets?: string;         // 'all' | 'hn' | 'reddit' | 'forum' | mix
  forumBase?: string;       // forum URL for forum mining
  subreddit?: string;       // reddit subreddit filter
  model?: string;           // LLM model override
  timeoutMs?: number;       // overall budget, default 240s
}

// ---------- tiny JSON extraction from LLM output ----------
/** Pull the first {...} block out of an LLM response (JSON-ish). */
function extractJson(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function llmJson(llm: Llm, opts: { model?: string; system: string; prompt: string; temperature?: number }): Promise<any> {
  const messages = [{ role: 'system' as const, content: opts.system }, { role: 'user' as const, content: opts.prompt }];
  let out = '';
  for await (const chunk of llm.stream({ model: opts.model, messages, temperature: opts.temperature ?? 0.2, maxTokens: 1200 })) {
    out += chunk.text ?? chunk.content ?? '';
    if (out.length > 12000) break;
  }
  return extractJson(out);
}

// ---------- plan: decompose question into parallel queries ----------
async function planQueries(llm: Llm, question: string, maxQueries: number, model?: string): Promise<string[]> {
  const sys = 'You are a search strategist. Decompose the user question into independent search queries that maximize coverage. Return ONLY JSON: {"queries":["q1","q2",...]}.';
  const res = await llmJson(llm, {
    model,
    system: sys,
    prompt: 'Question: ' + question + '\nReturn at most ' + maxQueries + ' queries, each a standalone search phrase (no operators needed).',
  });
  const qs = Array.isArray(res?.queries) ? res.queries.map(String).slice(0, maxQueries) : [];
  return qs.length ? qs : [question];
}

// ---------- execute: probe all queries in parallel (map) ----------
async function executeProbes(queries: string[], opts: DeepSearchOptions): Promise<{ query: string; result: ProbeResult }[]> {
  return Promise.all(queries.map(async (query) => {
    try {
      const result = await probeAll(query, {
        targets: opts.targets,
        forumBase: opts.forumBase,
        subreddit: opts.subreddit,
        maxPerSource: Math.max(5, Math.min(10, 10)),
      });
      return { query, result };
    } catch (e: any) {
      return { query, result: { sources: [{ kind: 'error', label: 'probe failed', items: [], error: String(e?.message ?? e) }], dedupedLinks: [] } };
    }
  }));
}

// ---------- reflect: evaluate evidence, decide next queries or terminate ----------
async function reflect(
  llm: Llm,
  question: string,
  gathered: string,
  iteration: number,
  maxIterations: number,
  model?: string,
): Promise<{ done: boolean; nextQueries?: string[]; summary?: string }> {
  const sys = 'You are a research coordinator. Given the evidence gathered so far, decide whether the question is answerable. Return ONLY JSON: {"done":true,"summary":"..."} or {"done":false,"nextQueries":["..."]}.';
  const res = await llmJson(llm, {
    model,
    system: sys,
    prompt: [
      'Question: ' + question,
      'Iteration ' + iteration + ' of ' + maxIterations + '.',
      'Evidence so far:\n' + gathered.slice(0, 6000),
      'If evidence is sufficient, done=true with a short summary. Otherwise propose up to 3 follow-up queries (missing angles, narrower terms, forum-specific targets).',
    ].join('\n'),
  });
  if (res?.done === true) return { done: true, summary: String(res.summary ?? '') };
  const nq = Array.isArray(res?.nextQueries) ? res.nextQueries.map(String).slice(0, 3) : [];
  return { done: false, nextQueries: nq };
}

// ---------- synthesize: final answer with [n] anchors ----------
async function synthesize(
  llm: Llm,
  question: string,
  sources: { n: number; title: string; url: string; snippet: string }[],
  gathered: string,
  model?: string,
): Promise<{ answer: string; cited: number[] }> {
  const sys = 'You are a research writer. Write a thorough answer with inline citation anchors like [1] referencing the provided sources. Only cite sources you actually use. Return ONLY JSON: {"answer":"...","cited":[1,2]}.';
  const srcList = sources.map((s) => '[' + s.n + '] ' + s.title + ' — ' + s.url + '\n' + s.snippet.slice(0, 500)).join('\n\n');
  const res = await llmJson(llm, {
    model,
    system: sys,
    prompt: 'Question: ' + question + '\n\nSources:\n' + srcList + '\n\nEvidence digest:\n' + gathered.slice(0, 8000) + '\n\nWrite the answer now.',
  });
  const answer = String(res?.answer ?? '');
  const cited = Array.isArray(res?.cited) ? res.cited.map(Number).filter((n: number) => n > 0) : [];
  return { answer, cited };
}

// ---------- public entry ----------
export async function deepSearch(
  llm: Llm,
  question: string,
  opts: DeepSearchOptions = {},
): Promise<{ answer: string; sources: { n: number; title: string; url: string; snippet: string }[]; iterations: number; queries: string[] }> {
  const maxIterations = Math.max(1, Math.min(5, opts.maxIterations ?? 3));
  const maxQueries = Math.max(1, Math.min(10, opts.maxQueries ?? 4));
  const timeoutMs = opts.timeoutMs ?? 240000;
  const deadline = Date.now() + timeoutMs;

  // 1. plan
  const queries = await planQueries(llm, question, maxQueries, opts.model);
  const allSources = new Map<number, { n: number; title: string; url: string; snippet: string }>();
  const digests: string[] = [];
  let iteration = 0;
  let done = false;

  while (!done && iteration < maxIterations && Date.now() < deadline) {
    iteration++;
    // 2. execute (parallel fan-out)
    const results = await executeProbes(queries, opts);
    // 3. gather + build digest
    const roundDigests: string[] = [];
    for (const { query, result } of results) {
      const lines: string[] = ['QUERY: ' + query];
      for (const src of result.sources) {
        const label = src.label + (src.error ? ' (error: ' + src.error + ')' : '');
        lines.push('-- ' + label + ' --');
        for (const item of src.items.slice(0, 5)) {
          const title = item.title.slice(0, 120);
          const snip = (item.description ?? '').slice(0, 300);
          lines.push('* ' + title + '\n  ' + item.link + '\n  ' + snip);
          // register source (dedupe by URL)
          const key = item.link;
          if (key && ![...allSources.values()].some((s) => s.url === key) && allSources.size < 25) {
            const n = allSources.size + 1;
            allSources.set(n, { n, title: title || item.link, url: key, snippet: snip });
          }
        }
      }
      roundDigests.push(lines.join('\n'));
    }
    digests.push('=== Iteration ' + iteration + ' ===\n' + roundDigests.join('\n\n'));

    // optional deep pass: fetch top deduped links (depth=deep)
    if (opts.depth === 'deep') {
      const candidates: string[] = [];
      for (const { result } of results) for (const l of result.dedupedLinks) if (![...allSources.values()].some((s) => s.url === l)) candidates.push(l);
      const toFetch = candidates.slice(0, 4);
      await Promise.all(toFetch.map(async (url) => {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (dsh-search)' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
          if (!res.ok) return;
          const text = extractText(await res.text());
          if (text.length < 200) return;
          const chunks = chunkText(text, 800);
          const snip = chunks[0]?.slice(0, 800) ?? text.slice(0, 800);
          if (allSources.size < 25 && ![...allSources.values()].some((s) => s.url === url)) {
            const n = allSources.size + 1;
            allSources.set(n, { n, title: url, url, snippet: snip });
          }
        } catch { /* skip */ }
      }));
    }

    // 4. reflect
    const gathered = digests.join('\n\n');
    const r = await reflect(llm, question, gathered, iteration, maxIterations, opts.model);
    if (r.done || iteration >= maxIterations || Date.now() >= deadline) {
      done = true;
    } else if (r.nextQueries?.length) {
      queries.splice(0, queries.length, ...r.nextQueries.slice(0, maxQueries));
    } else {
      done = true; // no more branches
    }
  }

  // 5. synthesize
  const gathered = digests.join('\n\n');
  const sources = [...allSources.values()];
  const { answer, cited } = await synthesize(llm, question, sources, gathered, opts.model);
  // back-fill only cited sources
  const citedSet = new Set(cited);
  const finalSources = sources.filter((s) => citedSet.has(s.n)).map((s) => ({ ...s }));
  const citedNums = finalSources.map((s) => s.n);
  // rewrite anchors so cited sources are renumbered contiguously
  const numMap = new Map<number, number>();
  finalSources.forEach((s, i) => numMap.set(s.n, i + 1));
  let finalAnswer = answer;
  for (const [oldN, newN] of numMap) {
    finalAnswer = finalAnswer.replace(new RegExp('\\[' + oldN + '\\]', 'g'), '[' + newN + ']');
  }
  const renumSources = finalSources.map((s, i) => ({ n: i + 1, title: s.title, url: s.url, snippet: s.snippet }));

  // append source list
  const footer = renumSources.map((s) => '[' + s.n + '] ' + s.title + ' — ' + s.url).join('\n');
  const withFooter = finalAnswer + '\n\nSources:\n' + footer;
  return { answer: withFooter, sources: renumSources, iterations: iteration, queries };
}
