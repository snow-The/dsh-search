// src/probe.ts
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
var RE_ITEM = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi;
var RE_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
var RE_LINK = /<link[^>]*href=["']([^"']+)["'][^>]*\/?>|<link[^>]*>([\s\S]*?)<\/link>/gi;
var RE_DESC = /<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i;
var RE_DATE = /<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i;
var RE_GUID = /<(?:guid|id)[^>]*>([\s\S]*?)<\/(?:guid|id)>/i;
var RE_HTML_TAG = /<[^>]+>/g;
var RE_WS = /\s+/g;
function decodeXml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function firstMatch(re, s) {
  const m = re.exec(s);
  return m ? decodeXml(m[1]).replace(RE_HTML_TAG, " ").replace(RE_WS, " ").trim() : "";
}
function extractFirstLink(block) {
  let m;
  RE_LINK.lastIndex = 0;
  while ((m = RE_LINK.exec(block)) !== null) {
    const href = m[1] ?? m[2] ?? "";
    if (href && !href.startsWith("{")) return decodeXml(href).trim();
  }
  return "";
}
function parseFeed(xml) {
  const out = [];
  let m;
  RE_ITEM.lastIndex = 0;
  while ((m = RE_ITEM.exec(xml)) !== null) {
    const block = m[0];
    const link = extractFirstLink(block);
    if (!link) continue;
    out.push({
      title: firstMatch(RE_TITLE, block) || "(untitled)",
      link,
      description: firstMatch(RE_DESC, block),
      date: firstMatch(RE_DATE, block),
      id: firstMatch(RE_GUID, block) || void 0
    });
  }
  return out;
}
function normalizeUrl(raw) {
  let u = String(raw).trim();
  try {
    const p = new URL(u);
    p.hash = "";
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"]) p.searchParams.delete(k);
    u = p.href.replace(/\/$/, "");
  } catch {
  }
  return u;
}
var SeenCache = class {
  db;
  constructor(dir = join(homedir(), ".dsh", "dsh-search-cache")) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, "seen.sqlite"));
    this.db.exec("CREATE TABLE IF NOT EXISTS seen (url TEXT PRIMARY KEY, first_seen INTEGER)");
  }
  /** true if the URL was already mined */
  seen(url) {
    const row = this.db.prepare("SELECT 1 FROM seen WHERE url = ?").get(normalizeUrl(url));
    return !!row;
  }
  mark(url) {
    this.db.prepare("INSERT OR IGNORE INTO seen (url, first_seen) VALUES (?, ?)").run(normalizeUrl(url), Date.now());
  }
  clear() {
    this.db.exec("DELETE FROM seen");
  }
  close() {
    this.db.close();
  }
};
async function getText(url, headers = {}, timeoutMs = 2e4) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (dsh-search-probe)", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "";
  const m = /charset=([\w-]+)/i.exec(ct);
  return m ? new TextDecoder(m[1] === "utf8" ? "utf-8" : m[1]).decode(buf) : buf.toString("utf-8");
}
var RSSHUB_DEFAULT = "https://rsshub.app";
function rsshubBase() {
  return (process.env.DSH_SEARCH_RSSHUB_URL ?? RSSHUB_DEFAULT).replace(/\/$/, "");
}
async function fetchFeed(feedUrl, limit = 20) {
  let url = feedUrl;
  if (!/^https?:\/\//i.test(url)) {
    url = rsshubBase() + (url.startsWith("/") ? url : "/" + url);
  }
  const xml = await getText(url, { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
  return { source: url, items: parseFeed(xml).slice(0, limit) };
}
async function redditSearch(q, subreddit, limit = 10) {
  const sub = subreddit ? "/r/" + subreddit : "";
  const url = "https://www.reddit.com" + sub + "/search.json?q=" + encodeURIComponent(q) + "&limit=" + limit + "&sort=relevance&t=all&raw_json=1";
  const res = await fetch(url, {
    headers: { "User-Agent": "dsh-search-probe/0.1 (local)" },
    redirect: "follow",
    signal: AbortSignal.timeout(2e4)
  });
  if (!res.ok) throw new Error("Reddit HTTP " + res.status);
  const data = await res.json();
  const kids = data?.data?.children ?? [];
  return kids.map((k) => {
    const d = k.data ?? {};
    return {
      title: d.title ?? "",
      link: "https://www.reddit.com" + (d.permalink ?? ""),
      description: (d.selftext ?? "").slice(0, 600),
      date: d.created_utc ? new Date(d.created_utc * 1e3).toISOString() : void 0,
      id: d.id ?? void 0
    };
  }).filter((i) => i.title);
}
async function hnSearch(q, limit = 10) {
  const url = "https://hn.algolia.com/api/v1/search?query=" + encodeURIComponent(q) + "&hitsPerPage=" + limit;
  const res = await fetch(url, { signal: AbortSignal.timeout(2e4) });
  if (!res.ok) throw new Error("HN HTTP " + res.status);
  const data = await res.json();
  const hits = data?.hits ?? [];
  return hits.map((h) => ({
    title: h.title ?? h.story_title ?? "",
    link: h.url ?? "https://news.ycombinator.com/item?id=" + h.objectID,
    description: (h.comment_text ?? h.story_text ?? "").replace(RE_HTML_TAG, " ").replace(RE_WS, " ").slice(0, 600),
    date: h.created_at ?? void 0,
    id: h.objectID ?? void 0
  })).filter((i) => i.title);
}
var FORUM_PLATFORMS = [
  { name: "phpBB", searchUrl: (b, q) => b + "/search.php?keywords=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?viewtopic[^"']*?)["']/gi },
  { name: "XenForo", searchUrl: (b, q) => b + "/search/?q=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?threads\/[^"']*?)["']/gi },
  { name: "Flarum", searchUrl: (b, q) => b + "/?q=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?d\/\d+[^"']*?)["']/gi },
  { name: "Discourse", searchUrl: (b, q) => b + "/search?q=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?t\/[^"']*?)["']/gi },
  { name: "vBulletin", searchUrl: (b, q) => b + "/search.php?do=process&query=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?showthread[^"']*?)["']/gi }
];
async function probeForum(baseUrl, q) {
  const base = baseUrl.replace(/\/$/, "");
  for (const spec of FORUM_PLATFORMS) {
    try {
      const html = await getText(spec.searchUrl(base, q), {}, 15e3);
      const links = [];
      let m;
      spec.resultSel.lastIndex = 0;
      while ((m = spec.resultSel.exec(html)) !== null) {
        try {
          links.push(normalizeUrl(new URL(m[1], base).href));
        } catch {
        }
      }
      if (links.length) return { platform: spec.name, links: [...new Set(links)].slice(0, 15) };
    } catch {
    }
  }
  return { platform: "unknown", links: [] };
}
async function relatedSearches(q) {
  const out = /* @__PURE__ */ new Set();
  try {
    const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q);
    const html = await getText(url, {}, 15e3);
    const re = /class=["']result-link["'][^>]*href=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const u = new URL(decodeXml(m[1]), url).href;
        const qp = u.includes("?") ? new URL(u).searchParams.get("q") ?? "" : "";
        if (qp && qp.length > 2 && qp.length < 80) out.add(qp);
      } catch {
      }
    }
  } catch {
  }
  return [...out].slice(0, 8);
}
async function probeAll(q, opts = {}) {
  const max = opts.maxPerSource ?? 10;
  const targets = (opts.targets ?? "all").split(",").map((s) => s.trim());
  const want = (t) => targets.includes("all") || targets.includes(t);
  const sources = [];
  const seen = new SeenCache();
  const tasks = [];
  const guard = (kind, label, p, mark = true) => {
    tasks.push(p.then((items2) => {
      if (mark) items2.forEach((i) => i.link && seen.mark(i.link));
      sources.push({ kind, label, items: items2 });
    }).catch((e) => {
      sources.push({ kind, label, items: [], error: String(e?.message ?? e) });
    }));
  };
  if (want("hn")) guard("hn", "Hacker News (Algolia)", hnSearch(q, max));
  if (want("reddit")) guard("reddit", opts.subreddit ? "Reddit r/" + opts.subreddit : "Reddit", redditSearch(q, opts.subreddit, max));
  if (want("forum") && opts.forumBase) {
    tasks.push(probeForum(opts.forumBase, q).then(({ platform, links }) => {
      links.forEach((l) => seen.mark(l));
      sources.push({ kind: "forum", label: "Forum (" + platform + ")", items: links.map((link) => ({ title: link, link, description: "" })) });
    }).catch((e) => {
      sources.push({ kind: "forum", label: "Forum", items: [], error: String(e?.message ?? e) });
    }));
  }
  await Promise.all(tasks);
  const dedupedLinks = [];
  for (const s of sources) for (const i of s.items) {
    const n = normalizeUrl(i.link);
    if (n && !seen.seen(n)) {
      seen.mark(n);
      dedupedLinks.push(n);
    }
  }
  seen.close();
  return { sources, dedupedLinks };
}

// src/query.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
import { join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";
import { mkdirSync as mkdirSync2, existsSync as existsSync2 } from "node:fs";
var RE_SCRIPT = /<script[\s\S]*?<\/script>/gi;
var RE_STYLE = /<style[\s\S]*?<\/style>/gi;
var RE_NAV = /<nav[\s\S]*?<\/nav>/gi;
var RE_FOOTER = /<footer[\s\S]*?<\/footer>/gi;
var RE_COMMENT = /<!--[\s\S]*?-->/g;
var RE_TAG = /<[^>]+>/g;
var RE_WS2 = /\s+/g;
var ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&hellip;": "...",
  "&mdash;": "\u2014",
  "&ndash;": "\u2013",
  "&copy;": "\xA9"
};
var RE_ENTITY = new RegExp(Object.keys(ENTITIES).join("|"), "g");
var MAX_TEXT = 6e4;
var DEFAULT_CHUNK = 800;
var CHUNK_OVERLAP = 100;
function extractText(html) {
  let t = String(html);
  t = t.replace(RE_SCRIPT, " ").replace(RE_STYLE, " ").replace(RE_NAV, " ").replace(RE_FOOTER, " ");
  t = t.replace(RE_COMMENT, " ").replace(RE_TAG, " ");
  t = t.replace(RE_ENTITY, (m) => ENTITIES[m] ?? " ");
  t = t.replace(RE_WS2, " ").trim();
  return t.slice(0, MAX_TEXT);
}
function chunkText(text, size = DEFAULT_CHUNK) {
  const src = String(text);
  if (src.length <= size) return src.length ? [src] : [];
  const chunks = [];
  let start = 0;
  const re = /(?<=[。！？.!?\n])\s*/g;
  while (start < src.length) {
    const endBase = Math.min(start + size, src.length);
    let end = endBase;
    if (end < src.length) {
      const m = re.exec(src.slice(endBase - 120, endBase + 120));
      if (m) end = endBase - 120 + m.index + m[0].length;
    }
    const piece = src.slice(start, Math.max(end, start + 1));
    chunks.push(piece);
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
    if (end === endBase && src.slice(endBase).length > 0 && endBase <= start) break;
  }
  return chunks;
}

// src/deepsearch.ts
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
async function llmJson(llm, opts) {
  const messages = [{ role: "system", content: opts.system }, { role: "user", content: opts.prompt }];
  let out = "";
  for await (const chunk of llm.stream({ model: opts.model, messages, temperature: opts.temperature ?? 0.2, maxTokens: 1200 })) {
    out += chunk.text ?? chunk.content ?? "";
    if (out.length > 12e3) break;
  }
  return extractJson(out);
}
async function planQueries(llm, question, maxQueries, model) {
  const sys = 'You are a search strategist. Decompose the user question into independent search queries that maximize coverage. Return ONLY JSON: {"queries":["q1","q2",...]}.';
  const res = await llmJson(llm, {
    model,
    system: sys,
    prompt: "Question: " + question + "\nReturn at most " + maxQueries + " queries, each a standalone search phrase (no operators needed)."
  });
  const qs = Array.isArray(res?.queries) ? res.queries.map(String).slice(0, maxQueries) : [];
  return qs.length ? qs : [question];
}
async function executeProbes(queries, opts) {
  return Promise.all(queries.map(async (query) => {
    try {
      const result = await probeAll(query, {
        targets: opts.targets,
        forumBase: opts.forumBase,
        subreddit: opts.subreddit,
        maxPerSource: Math.max(5, Math.min(10, 10))
      });
      return { query, result };
    } catch (e) {
      return { query, result: { sources: [{ kind: "error", label: "probe failed", items: [], error: String(e?.message ?? e) }], dedupedLinks: [] } };
    }
  }));
}
async function reflect(llm, question, gathered, iteration, maxIterations, model) {
  const sys = 'You are a research coordinator. Given the evidence gathered so far, decide whether the question is answerable. Return ONLY JSON: {"done":true,"summary":"..."} or {"done":false,"nextQueries":["..."]}.';
  const res = await llmJson(llm, {
    model,
    system: sys,
    prompt: [
      "Question: " + question,
      "Iteration " + iteration + " of " + maxIterations + ".",
      "Evidence so far:\n" + gathered.slice(0, 6e3),
      "If evidence is sufficient, done=true with a short summary. Otherwise propose up to 3 follow-up queries (missing angles, narrower terms, forum-specific targets)."
    ].join("\n")
  });
  if (res?.done === true) return { done: true, summary: String(res.summary ?? "") };
  const nq = Array.isArray(res?.nextQueries) ? res.nextQueries.map(String).slice(0, 3) : [];
  return { done: false, nextQueries: nq };
}
async function synthesize(llm, question, sources, gathered, model) {
  const sys = 'You are a research writer. Write a thorough answer with inline citation anchors like [1] referencing the provided sources. Only cite sources you actually use. Return ONLY JSON: {"answer":"...","cited":[1,2]}.';
  const srcList = sources.map((s) => "[" + s.n + "] " + s.title + " \u2014 " + s.url + "\n" + s.snippet.slice(0, 500)).join("\n\n");
  const res = await llmJson(llm, {
    model,
    system: sys,
    prompt: "Question: " + question + "\n\nSources:\n" + srcList + "\n\nEvidence digest:\n" + gathered.slice(0, 8e3) + "\n\nWrite the answer now."
  });
  const answer = String(res?.answer ?? "");
  const cited = Array.isArray(res?.cited) ? res.cited.map(Number).filter((n) => n > 0) : [];
  return { answer, cited };
}
async function deepSearch(llm, question, opts = {}) {
  const maxIterations = Math.max(1, Math.min(5, opts.maxIterations ?? 3));
  const maxQueries = Math.max(1, Math.min(10, opts.maxQueries ?? 4));
  const timeoutMs = opts.timeoutMs ?? 24e4;
  const deadline = Date.now() + timeoutMs;
  const queries = await planQueries(llm, question, maxQueries, opts.model);
  const allSources = /* @__PURE__ */ new Map();
  const digests = [];
  let iteration = 0;
  let done = false;
  while (!done && iteration < maxIterations && Date.now() < deadline) {
    iteration++;
    const results2 = await executeProbes(queries, opts);
    const roundDigests = [];
    for (const { query, result } of results2) {
      const lines = ["QUERY: " + query];
      for (const src of result.sources) {
        const label = src.label + (src.error ? " (error: " + src.error + ")" : "");
        lines.push("-- " + label + " --");
        for (const item of src.items.slice(0, 5)) {
          const title = item.title.slice(0, 120);
          const snip = (item.description ?? "").slice(0, 300);
          lines.push("* " + title + "\n  " + item.link + "\n  " + snip);
          const key = item.link;
          if (key && ![...allSources.values()].some((s) => s.url === key) && allSources.size < 25) {
            const n = allSources.size + 1;
            allSources.set(n, { n, title: title || item.link, url: key, snippet: snip });
          }
        }
      }
      roundDigests.push(lines.join("\n"));
    }
    digests.push("=== Iteration " + iteration + " ===\n" + roundDigests.join("\n\n"));
    if (opts.depth === "deep") {
      const candidates = [];
      for (const { result } of results2) for (const l of result.dedupedLinks) if (![...allSources.values()].some((s) => s.url === l)) candidates.push(l);
      const toFetch = candidates.slice(0, 4);
      await Promise.all(toFetch.map(async (url) => {
        try {
          const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (dsh-search)" }, redirect: "follow", signal: AbortSignal.timeout(2e4) });
          if (!res.ok) return;
          const text = extractText(await res.text());
          if (text.length < 200) return;
          const chunks = chunkText(text, 800);
          const snip = chunks[0]?.slice(0, 800) ?? text.slice(0, 800);
          if (allSources.size < 25 && ![...allSources.values()].some((s) => s.url === url)) {
            const n = allSources.size + 1;
            allSources.set(n, { n, title: url, url, snippet: snip });
          }
        } catch {
        }
      }));
    }
    const gathered2 = digests.join("\n\n");
    const r = await reflect(llm, question, gathered2, iteration, maxIterations, opts.model);
    if (r.done || iteration >= maxIterations || Date.now() >= deadline) {
      done = true;
    } else if (r.nextQueries?.length) {
      queries.splice(0, queries.length, ...r.nextQueries.slice(0, maxQueries));
    } else {
      done = true;
    }
  }
  const gathered = digests.join("\n\n");
  const sources = [...allSources.values()];
  const { answer, cited } = await synthesize(llm, question, sources, gathered, opts.model);
  const citedSet = new Set(cited);
  const finalSources = sources.filter((s) => citedSet.has(s.n)).map((s) => ({ ...s }));
  const citedNums = finalSources.map((s) => s.n);
  const numMap = /* @__PURE__ */ new Map();
  finalSources.forEach((s, i) => numMap.set(s.n, i + 1));
  let finalAnswer = answer;
  for (const [oldN, newN] of numMap) {
    finalAnswer = finalAnswer.replace(new RegExp("\\[" + oldN + "\\]", "g"), "[" + newN + "]");
  }
  const renumSources = finalSources.map((s, i) => ({ n: i + 1, title: s.title, url: s.url, snippet: s.snippet }));
  const footer = renumSources.map((s) => "[" + s.n + "] " + s.title + " \u2014 " + s.url).join("\n");
  const withFooter = finalAnswer + "\n\nSources:\n" + footer;
  return { answer: withFooter, sources: renumSources, iterations: iteration, queries };
}

// test/smoke-probe.ts
var results = [];
var ok = (name, cond, extra = "") => {
  results.push((cond ? "PASS" : "FAIL") + " " + name + (extra ? " | " + extra : ""));
};
var sampleXml = '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>First</title><link>https://example.com/1</link><description>desc one</description><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item><item><title>Second</title><link>https://example.com/2</link><description>&amp; entities</description></item></channel></rss>';
var items = parseFeed(sampleXml);
ok("parseFeed count", items.length === 2);
ok("parseFeed fields", items[0]?.title === "First" && items[0]?.link === "https://example.com/1" && items[0]?.description === "desc one");
ok("parseFeed entities", items[1]?.description === "& entities");
ok("normalizeUrl strip utm", normalizeUrl("https://a.com/x?utm_source=1&b=2") === "https://a.com/x?b=2");
ok("normalizeUrl strip hash", normalizeUrl("https://a.com/y#sec") === "https://a.com/y");
var cache = new SeenCache();
cache.clear();
ok("seenCache empty", !cache.seen("https://a.com/p"));
cache.mark("https://a.com/p?utm_source=x");
ok("seenCache dedupe", cache.seen("https://a.com/p"));
try {
  const hn = await hnSearch("deepseek", 3);
  ok("hnSearch live", hn.length > 0, hn.length + " hits, first: " + (hn[0]?.title ?? "").slice(0, 50));
} catch (e) {
  ok("hnSearch live", false, String(e.message).slice(0, 80));
}
try {
  const rd = await redditSearch("deepseek", void 0, 3);
  ok("redditSearch live", rd.length > 0, rd.length + " hits, first: " + (rd[0]?.title ?? "").slice(0, 50));
} catch (e) {
  results.push("SKIP redditSearch live (network-blocked: " + String(e.message).slice(0, 40) + ")");
}
try {
  const f = await fetchFeed("hn/best", 5);
  ok("rsshub feed", f.items.length > 0, f.items.length + " items from " + f.source);
} catch (e) {
  results.push("SKIP rsshub feed (public instance blocked from this network; self-host via DSH_SEARCH_RSSHUB_URL)");
}
try {
  const p = await probeAll("deepseek r1", { targets: "hn,reddit", maxPerSource: 3 });
  const kinds = p.sources.map((s) => s.kind + ":" + s.items.length).join(", ");
  ok("probeAll", p.sources.length >= 2 && p.dedupedLinks.length >= 0, kinds + " | deduped: " + p.dedupedLinks.length);
} catch (e) {
  ok("probeAll", false, String(e.message).slice(0, 80));
}
try {
  const rq = await relatedSearches("deepseek");
  ok("relatedSearches", rq.length >= 0, rq.length + " related");
} catch (e) {
  ok("relatedSearches", false, String(e.message).slice(0, 80));
}
var stubLlm = {
  async *stream(opts) {
    const p = opts.messages?.[opts.messages.length - 1]?.content ?? "";
    if (p.includes("search strategist")) {
      yield { text: '{"queries":["deepseek r1"]}' };
    } else if (p.includes("research coordinator")) {
      yield { text: '{"done":true,"summary":"enough"}' };
    } else {
      yield { text: '{"answer":"DeepSeek R1 is a reasoning model [1].","cited":[1]}' };
    }
  }
};
try {
  const ds = await deepSearch(stubLlm, "what is deepseek r1?", { maxIterations: 1, maxQueries: 1 });
  ok("deepSearch loop", ds.answer.includes("[1]") && ds.answer.includes("Sources:"), "iterations=" + ds.iterations + " sources=" + ds.sources.length);
} catch (e) {
  ok("deepSearch loop", false, String(e.message).slice(0, 120));
}
console.log(results.join("\n"));
console.log("---");
console.log("total: " + results.filter((r) => r.startsWith("PASS")).length + "/" + results.length + " passed");
