var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/query.ts
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
function extractText(html) {
  let t = String(html);
  t = t.replace(RE_SCRIPT, " ").replace(RE_STYLE, " ").replace(RE_NAV, " ").replace(RE_FOOTER, " ");
  t = t.replace(RE_COMMENT, " ").replace(RE_TAG, " ");
  t = t.replace(RE_ENTITY, (m) => ENTITIES[m] ?? " ");
  t = t.replace(RE_WS, " ").trim();
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
function hashEmbed(text) {
  const v = new Float32Array(EMBED_DIM);
  const s = String(text).toLowerCase();
  for (let i = 0; i < s.length - 2; i++) {
    let h = 7;
    for (let j = 0; j < 3; j++) h = h * 31 + s.charCodeAt(i + j) >>> 0;
    v[h % EMBED_DIM]++;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm;
  return v;
}
async function arkEmbed(texts) {
  const key = process.env.ARK_API_KEY;
  if (!key) return null;
  try {
    const model = process.env.DSH_BROWSER_EMBED_MODEL || "doubao-embedding-large";
    const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(3e4)
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!Array.isArray(j.data) || j.data.length !== texts.length) return null;
    return j.data.map((d) => Float32Array.from(d.embedding));
  } catch {
    return null;
  }
}
async function embedTexts(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const remote = await arkEmbed(batch);
    out.push(...remote ?? batch.map(hashEmbed));
  }
  return out;
}
function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
function getStore() {
  if (!store) store = new CorpusStore();
  return store;
}
function resetStore() {
  if (store) {
    store.close();
    store = null;
  }
}
var RE_SCRIPT, RE_STYLE, RE_NAV, RE_FOOTER, RE_COMMENT, RE_TAG, RE_WS, ENTITIES, RE_ENTITY, EMBED_DIM, BATCH, MAX_TEXT, DEFAULT_CHUNK, CHUNK_OVERLAP, CorpusStore, store;
var init_query = __esm({
  "src/query.ts"() {
    "use strict";
    RE_SCRIPT = /<script[\s\S]*?<\/script>/gi;
    RE_STYLE = /<style[\s\S]*?<\/style>/gi;
    RE_NAV = /<nav[\s\S]*?<\/nav>/gi;
    RE_FOOTER = /<footer[\s\S]*?<\/footer>/gi;
    RE_COMMENT = /<!--[\s\S]*?-->/g;
    RE_TAG = /<[^>]+>/g;
    RE_WS = /\s+/g;
    ENTITIES = {
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
    RE_ENTITY = new RegExp(Object.keys(ENTITIES).join("|"), "g");
    EMBED_DIM = 64;
    BATCH = 16;
    MAX_TEXT = 6e4;
    DEFAULT_CHUNK = 800;
    CHUNK_OVERLAP = 100;
    CorpusStore = class {
      db;
      insertStmt;
      selectAllStmt;
      countStmt;
      clearStmt;
      constructor(dbPath) {
        const dir = dbPath ? join(dbPath, "..") : join(homedir(), ".dsh", "browser-shots");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        this.db = new DatabaseSync(dbPath ?? join(dir, "corpus.db"));
        this.db.exec("CREATE TABLE IF NOT EXISTS corpus (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, chunk TEXT, vec BLOB)");
        this.insertStmt = this.db.prepare("INSERT INTO corpus (url, chunk, vec) VALUES (?, ?, ?)");
        this.selectAllStmt = this.db.prepare("SELECT url, chunk, vec FROM corpus");
        this.countStmt = this.db.prepare("SELECT COUNT(*) AS n FROM corpus");
        this.clearStmt = this.db.prepare("DELETE FROM corpus");
      }
      add(url, chunks, vecs) {
        const tx = this.db.exec("BEGIN");
        try {
          for (let i = 0; i < chunks.length; i++) {
            this.insertStmt.run(url, chunks[i], Buffer.from(vecs[i].buffer));
          }
          this.db.exec("COMMIT");
        } catch (e) {
          this.db.exec("ROLLBACK");
          throw e;
        }
        return chunks.length;
      }
      count() {
        const row = this.countStmt.get();
        return Number(row.n);
      }
      search(query, topK = 5) {
        const rows = this.selectAllStmt.all();
        const scored = rows.map((r) => ({
          url: r.url,
          chunk: r.chunk,
          score: cosine(query, new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4))
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
      }
      clear() {
        this.clearStmt.run();
      }
      close() {
        try {
          this.db.close();
        } catch {
        }
      }
    };
    store = null;
  }
});

// src/code/walk.ts
import { readdirSync, statSync, readFileSync as readFileSync4 } from "node:fs";
import { join as join4, relative } from "node:path";
function walkFiles(root, maxBytes = MAX_FILE_BYTES) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name2 of entries) {
      const full = join4(dir, name2);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (!IGNORED_DIRS.has(name2)) walk(full);
        continue;
      }
      const ext = name2.slice(name2.lastIndexOf(".")).toLowerCase();
      if (!CODE_EXTS.has(ext)) continue;
      if (st.size > maxBytes) continue;
      try {
        const source = readFileSync4(full, "utf8");
        out.push({ path: relative(root, full).split("\\").join("/"), source });
      } catch {
      }
    }
  };
  walk(root);
  return out;
}
var MAX_FILE_BYTES, CODE_EXTS, IGNORED_DIRS;
var init_walk = __esm({
  "src/code/walk.ts"() {
    "use strict";
    MAX_FILE_BYTES = 1e6;
    CODE_EXTS = /* @__PURE__ */ new Set([
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".kt",
      ".kts",
      ".c",
      ".h",
      ".cpp",
      ".hpp",
      ".cc",
      ".cxx",
      ".cs",
      ".rb",
      ".php",
      ".swift",
      ".scala",
      ".dart",
      ".lua",
      ".r",
      ".m",
      ".mm",
      ".sh",
      ".bash",
      ".zsh",
      ".ps1",
      ".sql",
      ".html",
      ".css",
      ".scss",
      ".vue",
      ".svelte",
      ".json",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".cfg",
      ".conf",
      ".xml",
      ".proto",
      ".graphql",
      ".md",
      ".markdown",
      ".rst",
      ".zig",
      ".nim",
      ".ex",
      ".exs",
      ".erl",
      ".hs",
      ".ml",
      ".clj",
      ".cljs",
      ".groovy",
      ".gradle",
      ".dockerfile",
      ".tf",
      ".hcl",
      ".prisma",
      ".solidity",
      ".sol",
      ".asm",
      ".s",
      ".d",
      ".f90",
      ".f95",
      ".jl",
      ".pl",
      ".pm",
      ".tcl",
      ".vb",
      ".v",
      ".vhdl",
      ".vhd",
      ".tex",
      ".bat",
      ".cmd"
    ]);
    IGNORED_DIRS = /* @__PURE__ */ new Set([".git", ".hg", ".svn", "node_modules", ".venv", "venv", "dist", "build", "out", "target", ".next", ".cache", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", ".eggs", ".semble", ".dsh", ".idea", ".vscode", "coverage", ".turbo", ".yarn", ".pnpm-store", ".git-rewrite"]);
  }
});

// src/code/chunker.ts
function chunkSource(source, filePath) {
  const lines = source.split("\n");
  const chunks = [];
  let start = 0;
  let acc = 0;
  const flush = (end) => {
    if (end <= start) return;
    let content = lines.slice(start, end).join("\n");
    while (content.startsWith("\n")) {
      content = content.slice(1);
      start++;
    }
    while (content.endsWith("\n")) content = content.slice(0, -1);
    if (content.trim()) {
      chunks.push({ content, filePath, startLine: start + 1, endLine: end });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlank = BLANK_RE.test(line);
    const isDecl = !isBlank && !COMMENT_RE.test(line) && DECL_RE.test(line) && i > start;
    acc += line.length + 1;
    if (isDecl && acc > 200 && acc - (i - start) > 60) {
      flush(i);
      start = i;
      acc = line.length + 1;
      continue;
    }
    if (acc >= CHUNK_TARGET && i < lines.length - 1) {
      let cut = i;
      for (let j = i; j > Math.max(start, i - 8); j--) {
        if (BLANK_RE.test(lines[j])) {
          cut = j;
          break;
        }
      }
      if (cut === i) cut = Math.max(start + 1, i);
      flush(cut);
      let back = 0;
      let backChars = 0;
      for (let j = cut - 1; j > start && backChars < CHUNK_OVERLAP2; j--) {
        backChars += lines[j].length + 1;
        back++;
      }
      start = Math.max(start, cut - back);
      acc = 0;
      for (let j = start; j <= cut; j++) acc += lines[j].length + 1;
      continue;
    }
  }
  flush(lines.length);
  return chunks;
}
var CHUNK_TARGET, CHUNK_OVERLAP2, DECL_RE, COMMENT_RE, BLANK_RE;
var init_chunker = __esm({
  "src/code/chunker.ts"() {
    "use strict";
    CHUNK_TARGET = 750;
    CHUNK_OVERLAP2 = 100;
    DECL_RE = /^\s*(?:export\s+|declare\s+|async\s+|public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*(?:function|class|interface|struct|enum|trait|type|def|fn|func|impl|module|namespace|package|const|let|var|import|from|using|use|pub|#[a-z_]+)\b/;
    COMMENT_RE = /^\s*(?:\/\/|#|\/\*|\*|--|;|%)/;
    BLANK_RE = /^\s*$/;
  }
});

// src/code/tokenize.ts
function splitIdentifier(token) {
  const lower = token.toLowerCase();
  let parts = [];
  if (token.includes("_")) {
    parts = lower.split("_").filter(Boolean);
  } else {
    parts = (token.match(CAMEL_RE) ?? []).map((s) => s.toLowerCase());
  }
  if (parts.length >= 2) return [lower, ...parts];
  return [lower];
}
function tokenize(text) {
  const out = [];
  let m;
  IDENT_RE.lastIndex = 0;
  while (m = IDENT_RE.exec(text)) out.push(...splitIdentifier(m[0]));
  return out;
}
function enrichForBM25(content, filePath) {
  const parts = filePath.split(/[\\/]/);
  const stem = (parts.pop() ?? "").replace(/\.[^.]+$/, "");
  const dirs = parts.slice(-3).join(" ");
  return content + " " + stem + " " + stem + " " + dirs;
}
var CAMEL_RE, IDENT_RE;
var init_tokenize = __esm({
  "src/code/tokenize.ts"() {
    "use strict";
    CAMEL_RE = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g;
    IDENT_RE = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  }
});

// src/code/bm25.ts
var K1, B, BM25;
var init_bm25 = __esm({
  "src/code/bm25.ts"() {
    "use strict";
    K1 = 1.5;
    B = 0.75;
    BM25 = class _BM25 {
      docs = /* @__PURE__ */ new Map();
      lengths = /* @__PURE__ */ new Map();
      totalLen = 0;
      postings = /* @__PURE__ */ new Map();
      positions = /* @__PURE__ */ new Map();
      docOrder = [];
      addDocument(id, tokens) {
        if (this.docs.has(id)) throw new Error("chunk already indexed: " + id);
        const counts = /* @__PURE__ */ new Map();
        for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
        this.docs.set(id, counts);
        this.lengths.set(id, tokens.length);
        this.totalLen += tokens.length;
        for (const [term, n] of counts) {
          let p = this.postings.get(term);
          if (!p) {
            p = /* @__PURE__ */ new Map();
            this.postings.set(term, p);
          }
          p.set(id, n);
        }
      }
      removeDocument(id) {
        const counts = this.docs.get(id);
        if (!counts) return;
        this.totalLen -= this.lengths.get(id) ?? 0;
        this.docs.delete(id);
        this.lengths.delete(id);
        for (const term of counts.keys()) {
          const p = this.postings.get(term);
          if (!p) continue;
          p.delete(id);
          if (p.size === 0) this.postings.delete(term);
        }
      }
      setDocOrder(ids) {
        this.docOrder = ids;
        this.positions = new Map(ids.map((id, i) => [id, i]));
      }
      getScores(tokens, mask) {
        const n = this.docOrder.length;
        const scores = new Float32Array(n);
        if (!tokens.length || !this.docs.size) return scores;
        const avgdl = this.totalLen / this.docs.size;
        const qtf = /* @__PURE__ */ new Map();
        for (const t of tokens) qtf.set(t, (qtf.get(t) ?? 0) + 1);
        for (const [term, queryTf] of qtf) {
          const docs = this.postings.get(term);
          if (!docs) continue;
          const df = docs.size;
          const idf = Math.log(1 + (this.docs.size - df + 0.5) / (df + 0.5));
          for (const [chunkId, tf] of docs) {
            const idx = this.positions.get(chunkId);
            if (idx === void 0) continue;
            const dl = this.lengths.get(chunkId) ?? 0;
            const tfc = tf / (K1 * (1 - B + B * dl / avgdl) + tf);
            scores[idx] += queryTf * idf * tfc;
          }
        }
        if (mask) {
          for (let i = 0; i < n; i++) if (!mask[i]) scores[i] = 0;
        }
        return scores;
      }
      serialize() {
        return {
          docs: [...this.docs.entries()].map(([id, c]) => [id, [...c.entries()]]),
          order: this.docOrder
        };
      }
      static deserialize(data) {
        const b = new _BM25();
        for (const [id, counts] of data.docs) {
          const m = new Map(counts);
          b.docs.set(id, m);
          let len = 0;
          for (const [term, n] of m) {
            len += n;
            let p = b.postings.get(term);
            if (!p) {
              p = /* @__PURE__ */ new Map();
              b.postings.set(term, p);
            }
            p.set(id, n);
          }
          b.lengths.set(id, len);
          b.totalLen += len;
        }
        b.setDocOrder(data.order);
        return b;
      }
    };
  }
});

// src/code/ranking.ts
function isSymbolQuery(query) {
  return SYMBOL_QUERY_RE.test(query.trim());
}
function resolveAlpha(query, alpha) {
  if (alpha !== void 0) return alpha;
  return isSymbolQuery(query) ? ALPHA_SYMBOL : ALPHA_NL;
}
function rrfScores(scores) {
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const out = /* @__PURE__ */ new Map();
  ranked.forEach(([id], rank) => out.set(id, 1 / (RRF_K + rank + 1)));
  return out;
}
function definitionPattern(name2) {
  const esc = name2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?:^|(?<=\\s))(?:(?:" + DEF_KEYWORDS.join("|") + ")\\s+(?:[A-Za-z_][A-Za-z0-9_]*(?:\\.|::))*" + esc + "(?:\\s|[<({:\\[;]|$))", "m");
}
function sqlPattern(name2) {
  const esc = name2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?:^|(?<=\\s))(?:(?:" + SQL_KEYWORDS.join("|") + ")\\s+(?:[A-Za-z_][A-Za-z0-9_]*(?:\\.|::))*" + esc + "(?:\\s|[<({:\\[;]|$))", "im");
}
function chunkDefinesSymbol(chunk, symbolName) {
  return definitionPattern(symbolName).test(chunk.content) || sqlPattern(symbolName).test(chunk.content);
}
function stemMatches(stem, name2) {
  const norm = stem.replace(/_/g, "");
  return stem === name2 || norm === name2 || stem.replace(/s$/, "") === name2 || norm.replace(/s$/, "") === name2;
}
function fileStem(filePath) {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  return base.replace(/\.[^.]+$/, "").toLowerCase();
}
function filePathPenalty(filePath) {
  const p = filePath.replace(/\\/g, "/");
  let penalty = 1;
  if (TEST_FILE_RE.test(p) || TEST_DIR_RE.test(p)) penalty *= STRONG;
  if (REEXPORT.has(filePath.split(/[\\/]/).pop() ?? "")) penalty *= MODERATE;
  if (COMPAT_DIR_RE.test(p)) penalty *= STRONG;
  if (EXAMPLES_DIR_RE.test(p)) penalty *= STRONG;
  if (TYPE_DEFS_RE.test(p)) penalty *= MILD;
  return penalty;
}
function rerank(combined, chunks, topK, penalisePaths) {
  if (!combined.size) return [];
  const maxScore = Math.max(...combined.values());
  if (maxScore <= 0) return [];
  const fileSum = /* @__PURE__ */ new Map();
  const bestChunk = /* @__PURE__ */ new Map();
  for (const [id, score] of combined) {
    const fp = chunks[id].filePath;
    fileSum.set(fp, (fileSum.get(fp) ?? 0) + score);
    if (!bestChunk.has(fp) || score > (combined.get(bestChunk.get(fp)) ?? 0)) bestChunk.set(fp, id);
  }
  const maxFileSum = Math.max(...fileSum.values());
  const boostUnit = maxScore * FILE_COHERENCE_FRAC;
  for (const [fp, id] of bestChunk) {
    combined.set(id, (combined.get(id) ?? 0) + boostUnit * (fileSum.get(fp) ?? 0) / maxFileSum);
  }
  const penaltyCache = /* @__PURE__ */ new Map();
  const scored = [];
  for (const [id, score] of combined) {
    const fp = chunks[id].filePath;
    let pen = 1;
    if (penalisePaths) {
      pen = penaltyCache.get(fp) ?? filePathPenalty(fp);
      penaltyCache.set(fp, pen);
    }
    scored.push([id, score * pen]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const fileSelected = /* @__PURE__ */ new Map();
  const selected = [];
  for (const [id, score] of scored) {
    const fp = chunks[id].filePath;
    const already = fileSelected.get(fp) ?? 0;
    let eff = score;
    if (already >= 1) eff *= Math.pow(0.5, already);
    selected.push([id, eff]);
    fileSelected.set(fp, already + 1);
    if (selected.length >= topK) break;
  }
  selected.sort((a, b) => b[1] - a[1]);
  return selected;
}
function boostSymbolDefinitions(combined, query, chunks) {
  const name2 = query.split(/::|\\.|->/).pop()?.trim() ?? query.trim();
  const names = /* @__PURE__ */ new Set([name2, query.trim()]);
  const maxScore = Math.max(...combined.values());
  const unit = maxScore * DEF_BOOST;
  for (const [id] of combined) {
    const c = chunks[id];
    if (![...names].some((n) => chunkDefinesSymbol(c, n))) continue;
    const stem = fileStem(c.filePath);
    const tier = unit * ([...names].some((n) => stemMatches(stem, n.toLowerCase())) ? 1.5 : 1);
    combined.set(id, (combined.get(id) ?? 0) + tier);
  }
  for (let id = 0; id < chunks.length; id++) {
    if (combined.has(id)) continue;
    const stem = fileStem(chunks[id].filePath);
    if (![...names].some((n) => stemMatches(stem, n.toLowerCase()))) continue;
    if ([...names].some((n) => chunkDefinesSymbol(chunks[id], n))) {
      combined.set(id, unit);
    }
  }
}
var RRF_K, ALPHA_SYMBOL, ALPHA_NL, SYMBOL_QUERY_RE, DEF_KEYWORDS, SQL_KEYWORDS, DEF_BOOST, FILE_COHERENCE_FRAC, TEST_FILE_RE, TEST_DIR_RE, COMPAT_DIR_RE, EXAMPLES_DIR_RE, TYPE_DEFS_RE, REEXPORT, STRONG, MODERATE, MILD;
var init_ranking = __esm({
  "src/code/ranking.ts"() {
    "use strict";
    RRF_K = 60;
    ALPHA_SYMBOL = 0.3;
    ALPHA_NL = 0.5;
    SYMBOL_QUERY_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.|->)[A-Za-z_][A-Za-z0-9_]*)+|_[A-Za-z0-9_]*|[A-Za-z][A-Za-z0-9]*[A-Z_][A-Za-z0-9_]*|[A-Z][A-Za-z0-9]*)$/;
    DEF_KEYWORDS = ["class", "module", "defmodule", "def", "interface", "struct", "enum", "trait", "type", "func", "function", "object", "abstract class", "data class", "fn", "fun", "package", "namespace", "protocol", "record", "typedef"];
    SQL_KEYWORDS = ["create table", "create view", "create procedure", "create function"];
    DEF_BOOST = 3;
    FILE_COHERENCE_FRAC = 0.2;
    TEST_FILE_RE = /(?:^|\/)(?:test_[^/]*\.py|[^/]*_test\.py|[^/]*_test\.go|[^/]*Tests?\.java|[^/]*Test\.php|[^/]*_spec\.rb|[^/]*_test\.rb|[^/]*\.test\.[jt]sx?|[^/]*\.spec\.[jt]sx?|[^/]*Tests?\.kt|[^/]*Spec\.kt|[^/]*Tests?\.swift|[^/]*Spec\.swift|[^/]*Tests?\.cs|[^/]*_test\.cpp|[^/]*_test\.c|[^/]*Spec\.scala|[^/]*Test\.scala|[^/]*_test\.dart|test_helpers?[^/]*\.\w+)$/;
    TEST_DIR_RE = /(?:^|\/)(?:tests?|__tests__|spec|testing)(?:\/|$)/;
    COMPAT_DIR_RE = /(?:^|\/)(?:compat|_compat|legacy)(?:\/|$)/;
    EXAMPLES_DIR_RE = /(?:^|\/)(?:_?examples?|docs?_src)(?:\/|$)/;
    TYPE_DEFS_RE = /\.d\.ts$/;
    REEXPORT = /* @__PURE__ */ new Set(["__init__.py", "package-info.java"]);
    STRONG = 0.3;
    MODERATE = 0.5;
    MILD = 0.7;
  }
});

// src/code/store.ts
import { createHash } from "node:crypto";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync5, writeFileSync as writeFileSync2, existsSync as existsSync4 } from "node:fs";
import { join as join5 } from "node:path";
import { homedir as homedir4 } from "node:os";
function cacheDirFor(root) {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 20);
  return join5(homedir4(), ".dsh", "search-index", hash);
}
function makeChunkId(indexedPath, slot) {
  return indexedPath + ":" + slot;
}
function loadIndex(root) {
  const dir = cacheDirFor(root);
  const metaPath = join5(dir, "metadata.json");
  const chunksPath = join5(dir, "chunks.json");
  const bmPath = join5(dir, "bm25.json");
  if (!existsSync4(metaPath) || !existsSync4(chunksPath) || !existsSync4(bmPath)) return null;
  try {
    const meta = JSON.parse(readFileSync5(metaPath, "utf8"));
    if (meta.root !== root) return null;
    const chunks = JSON.parse(readFileSync5(chunksPath, "utf8"));
    const bm25 = BM25.deserialize(JSON.parse(readFileSync5(bmPath, "utf8")));
    let vectors = null;
    if (meta.embedDim > 0) {
      const vecPath = join5(dir, "vecs.bin");
      if (existsSync4(vecPath)) {
        const buf = readFileSync5(vecPath);
        const dim = meta.embedDim;
        vectors = [];
        for (let i = 0; i < buf.length / 4 / dim; i++) {
          vectors.push(new Float32Array(buf.buffer, buf.byteOffset + i * dim * 4, dim).slice());
        }
      }
    }
    return { chunks, bm25, manifest: meta.manifest, vectors, embedDim: meta.embedDim };
  } catch {
    return null;
  }
}
function saveIndex(root, data) {
  const dir = cacheDirFor(root);
  mkdirSync3(dir, { recursive: true });
  const meta = { root, manifest: data.manifest, embedDim: data.vectors ? data.vectors[0]?.length ?? 0 : 0 };
  writeFileSync2(join5(dir, "metadata.json"), JSON.stringify(meta), "utf8");
  writeFileSync2(join5(dir, "chunks.json"), JSON.stringify(data.chunks), "utf8");
  writeFileSync2(join5(dir, "bm25.json"), JSON.stringify(data.bm25.serialize()), "utf8");
  if (data.vectors && data.vectors.length) {
    const dim = data.vectors[0].length;
    const buf = Buffer.alloc(data.vectors.length * dim * 4);
    data.vectors.forEach((v, i) => buf.set(Buffer.from(v.buffer, v.byteOffset, v.byteLength), i * dim * 4));
    writeFileSync2(join5(dir, "vecs.bin"), buf);
  }
}
var init_store = __esm({
  "src/code/store.ts"() {
    "use strict";
    init_bm25();
  }
});

// src/code/search.ts
var search_exports = {};
__export(search_exports, {
  ensureIndex: () => ensureIndex,
  searchCode: () => searchCode
});
import { statSync as statSync2 } from "node:fs";
import { join as join6 } from "node:path";
function parseFilters(filter) {
  const required = [];
  const blocked = [];
  const files = [];
  let cleaned = filter;
  let m;
  REQ_RE.lastIndex = 0;
  while (m = REQ_RE.exec(filter)) {
    required.push(m[1]);
    cleaned = cleaned.replace(m[0], "");
  }
  BLOCK_RE.lastIndex = 0;
  while (m = BLOCK_RE.exec(filter)) {
    blocked.push(m[1]);
    cleaned = cleaned.replace(m[0], "");
  }
  FILE_RE.lastIndex = 0;
  while (m = FILE_RE.exec(filter)) {
    files.push(m[1]);
    cleaned = cleaned.replace(m[0], "");
  }
  return { required, blocked, files, cleaned: cleaned.trim() };
}
function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp("^" + esc + "$");
}
async function ensureIndex(root, rebuild = false) {
  const cached = rebuild ? null : loadIndex(root);
  const bm25 = cached ? cached.bm25 : new BM25();
  const chunks = cached ? [...cached.chunks] : [];
  const manifest = cached ? { ...cached.manifest } : {};
  let vectors = cached?.vectors ? [...cached.vectors] : null;
  const files = walkFiles(root);
  const seen = /* @__PURE__ */ new Set();
  const changed = [];
  for (const f of files) {
    seen.add(f.path);
    let mtimeNs = 0;
    try {
      mtimeNs = Math.round(statSync2(join6(root, f.path)).mtimeMs * 1e6);
    } catch {
    }
    const prev = manifest[f.path];
    if (!prev || prev.mtimeNs !== mtimeNs) changed.push(f);
  }
  if (!changed.length && cached) return cached;
  for (const path of Object.keys(manifest)) {
    if (seen.has(path)) continue;
    const entry = manifest[path];
    for (let slot = 0; slot < entry.count; slot++) bm25.removeDocument(makeChunkId(path, slot));
    delete manifest[path];
  }
  const newChunks = [];
  const newVecs = [];
  for (const f of changed) {
    const prev = manifest[f.path];
    if (prev) {
      for (let slot = 0; slot < prev.count; slot++) bm25.removeDocument(makeChunkId(f.path, slot));
    }
    const fileChunks = chunkSource(f.source, f.path);
    if (!fileChunks.length) {
      delete manifest[f.path];
      continue;
    }
    const start = chunks.length + newChunks.length;
    for (let slot = 0; slot < fileChunks.length; slot++) {
      const c = fileChunks[slot];
      bm25.addDocument(makeChunkId(f.path, slot), tokenize(enrichForBM25(c.content, f.path)));
      newChunks.push(c);
    }
    let mtimeNs = 0;
    try {
      mtimeNs = Math.round(statSync2(join6(root, f.path)).mtimeMs * 1e6);
    } catch {
      mtimeNs = Date.now() * 1e6;
    }
    manifest[f.path] = { mtimeNs, start, count: fileChunks.length };
  }
  if (newChunks.length) {
    const embedded = await embedTexts(newChunks.map((c) => c.content));
    newVecs.push(...embedded);
    if (vectors) vectors.push(...embedded);
    else vectors = embedded;
  }
  chunks.push(...newChunks);
  bm25.setDocOrder(chunks.map((c, i) => makeChunkId(c.filePath, i)));
  const data = { chunks, bm25, manifest, vectors, embedDim: vectors?.[0]?.length ?? 0 };
  saveIndex(root, data);
  return data;
}
async function searchCode(opts) {
  const topK = Math.min(Math.max(opts.topK ?? 10, 1), 30);
  const index = await ensureIndex(opts.path, opts.rebuild);
  const { chunks, bm25, vectors } = index;
  if (!chunks.length) return [];
  let required = [];
  let blocked = [];
  let fileRegexes = [];
  let query = opts.query;
  if (opts.filter) {
    const f = parseFilters(opts.filter);
    required = f.required;
    blocked = f.blocked;
    fileRegexes = f.files.map(globToRegex);
    query = (query + " " + f.cleaned).trim();
  }
  const mask = new Array(chunks.length).fill(true);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (fileRegexes.length && !fileRegexes.some((re) => re.test(c.filePath))) mask[i] = false;
    if (blocked.length && blocked.some((w) => c.content.toLowerCase().includes(w))) mask[i] = false;
    if (required.length && !required.every((w) => c.content.toLowerCase().includes(w))) mask[i] = false;
  }
  const bm25Scores = bm25.getScores(tokenize(query), mask);
  const lexical = /* @__PURE__ */ new Map();
  for (let i = 0; i < bm25Scores.length; i++) if (bm25Scores[i] > 0) lexical.set(i, bm25Scores[i]);
  const semantic = /* @__PURE__ */ new Map();
  if (vectors && vectors.length && vectors[0].length > 64) {
    const qv = (await embedTexts([query]))[0];
    for (let i = 0; i < vectors.length; i++) {
      if (!mask[i]) continue;
      const s = cosine(qv, vectors[i]);
      if (s > 0.3) semantic.set(i, s);
    }
  } else if (vectors && vectors.length) {
    const qv = hashEmbed(query);
    for (let i = 0; i < vectors.length; i++) {
      if (!mask[i]) continue;
      const s = cosine(qv, vectors[i]);
      if (s > 0.25) semantic.set(i, s);
    }
  }
  const alpha = resolveAlpha(query);
  const rrfLex = rrfScores(lexical);
  const rrfSem = rrfScores(semantic);
  const combined = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new Set([...rrfLex.keys(), ...rrfSem.keys()]);
  for (const id of ids) {
    const s = alpha * (rrfSem.get(id) ?? 0) + (1 - alpha) * (rrfLex.get(id) ?? 0);
    if (s > 0) combined.set(id, s);
  }
  if (isSymbolQuery(query) && combined.size) boostSymbolDefinitions(combined, query, chunks);
  const ranked = rerank(combined, chunks, topK * 3, alpha < 1);
  const hits = [];
  for (const [id, score] of ranked.slice(0, topK)) {
    const c = chunks[id];
    hits.push({ filePath: c.filePath, startLine: c.startLine, endLine: c.endLine, score, content: c.content });
  }
  return hits;
}
var REQ_RE, BLOCK_RE, FILE_RE;
var init_search = __esm({
  "src/code/search.ts"() {
    "use strict";
    init_walk();
    init_chunker();
    init_tokenize();
    init_bm25();
    init_ranking();
    init_store();
    init_query();
    REQ_RE = /\+"([a-zA-Z0-9_-]+)"/g;
    BLOCK_RE = /-"([a-zA-Z0-9_-]+)"/g;
    FILE_RE = /file:"([^"]+)"/g;
  }
});

// src/probe.ts
var probe_exports = {};
__export(probe_exports, {
  SeenCache: () => SeenCache,
  discoverFeed: () => discoverFeed,
  disqusRecent: () => disqusRecent,
  fetchFeed: () => fetchFeed,
  hnSearch: () => hnSearch,
  normalizeUrl: () => normalizeUrl,
  parseFeed: () => parseFeed,
  probeAll: () => probeAll,
  probeForum: () => probeForum,
  redditSearch: () => redditSearch,
  relatedSearches: () => relatedSearches,
  rsshubBase: () => rsshubBase,
  sitemapUrls: () => sitemapUrls
});
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
import { join as join7 } from "node:path";
import { homedir as homedir5 } from "node:os";
import { mkdirSync as mkdirSync4, existsSync as existsSync5 } from "node:fs";
function decodeXml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function firstMatch(re, s) {
  const m = re.exec(s);
  return m ? decodeXml(m[1]).replace(RE_HTML_TAG, " ").replace(RE_WS2, " ").trim() : "";
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
async function discoverFeed(siteUrl) {
  const html = await getText(siteUrl, {}, 12e3);
  const m = RE_RSS_ALT.exec(html) ?? RE_RSS_ALT2.exec(html);
  if (!m) return null;
  try {
    return new URL(m[1], siteUrl).href;
  } catch {
    return m[1];
  }
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
    description: (h.comment_text ?? h.story_text ?? "").replace(RE_HTML_TAG, " ").replace(RE_WS2, " ").slice(0, 600),
    date: h.created_at ?? void 0,
    id: h.objectID ?? void 0
  })).filter((i) => i.title);
}
async function sitemapUrls(sitemapUrl, max = 50) {
  const xml = await getText(sitemapUrl, {}, 15e3);
  const out = [];
  if (RE_SITEMAP_INDEX.test(xml)) {
    RE_SITEMAP_INDEX.lastIndex = 0;
    let m;
    while ((m = RE_SITEMAP_INDEX.exec(xml)) !== null && out.length < max) {
      const inner = m[1].match(/<loc>([\s\S]*?)<\/loc>/i);
      if (inner) out.push(decodeXml(inner[1]).trim());
    }
  } else {
    RE_SITEMAP.lastIndex = 0;
    let m;
    while ((m = RE_SITEMAP.exec(xml)) !== null && out.length < max) out.push(decodeXml(m[1]).trim());
  }
  return out;
}
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
async function disqusRecent(forum, limit = 10) {
  const url = "https://disqus.com/api/3.0/forums/listThreads.json?forum=" + encodeURIComponent(forum) + "&limit=" + limit + "&order=desc";
  const res = await fetch(url, { signal: AbortSignal.timeout(2e4) });
  if (!res.ok) throw new Error("Disqus HTTP " + res.status);
  const data = await res.json();
  const resp = data?.response ?? [];
  return resp.map((t) => ({
    title: t.title ?? "",
    link: t.link ?? "",
    description: (t.message ?? "").slice(0, 600),
    date: t.createdAt ?? void 0,
    id: t.id ?? void 0
  })).filter((i) => i.title && i.link);
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
    tasks.push(p.then((items) => {
      if (mark) items.forEach((i) => i.link && seen.mark(i.link));
      sources.push({ kind, label, items });
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
var RE_ITEM, RE_TITLE, RE_LINK, RE_DESC, RE_DATE, RE_GUID, RE_HTML_TAG, RE_WS2, RE_RSS_ALT, RE_RSS_ALT2, RE_SITEMAP, RE_SITEMAP_INDEX, SeenCache, RSSHUB_DEFAULT, FORUM_PLATFORMS;
var init_probe = __esm({
  "src/probe.ts"() {
    "use strict";
    RE_ITEM = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi;
    RE_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
    RE_LINK = /<link[^>]*href=["']([^"']+)["'][^>]*\/?>|<link[^>]*>([\s\S]*?)<\/link>/gi;
    RE_DESC = /<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i;
    RE_DATE = /<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i;
    RE_GUID = /<(?:guid|id)[^>]*>([\s\S]*?)<\/(?:guid|id)>/i;
    RE_HTML_TAG = /<[^>]+>/g;
    RE_WS2 = /\s+/g;
    RE_RSS_ALT = /<link[^>]*rel=["']alternate["'][^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i;
    RE_RSS_ALT2 = /<link[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i;
    RE_SITEMAP = /<loc>([\s\S]*?)<\/loc>/gi;
    RE_SITEMAP_INDEX = /<sitemap>([\s\S]*?)<\/sitemap>/gi;
    SeenCache = class {
      db;
      constructor(dir = join7(homedir5(), ".dsh", "dsh-search-cache")) {
        if (!existsSync5(dir)) mkdirSync4(dir, { recursive: true });
        this.db = new DatabaseSync2(join7(dir, "seen.sqlite"));
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
    RSSHUB_DEFAULT = "https://rsshub.app";
    FORUM_PLATFORMS = [
      { name: "phpBB", searchUrl: (b, q) => b + "/search.php?keywords=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?viewtopic[^"']*?)["']/gi },
      { name: "XenForo", searchUrl: (b, q) => b + "/search/?q=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?threads\/[^"']*?)["']/gi },
      { name: "Flarum", searchUrl: (b, q) => b + "/?q=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?d\/\d+[^"']*?)["']/gi },
      { name: "Discourse", searchUrl: (b, q) => b + "/search?q=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?t\/[^"']*?)["']/gi },
      { name: "vBulletin", searchUrl: (b, q) => b + "/search.php?do=process&query=" + encodeURIComponent(q), resultSel: /href=["']([^"']*?showthread[^"']*?)["']/gi }
    ];
  }
});

// src/deepsearch.ts
var deepsearch_exports = {};
__export(deepsearch_exports, {
  deepSearch: () => deepSearch
});
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
    const results = await executeProbes(queries, opts);
    const roundDigests = [];
    for (const { query, result } of results) {
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
      for (const { result } of results) for (const l of result.dedupedLinks) if (![...allSources.values()].some((s) => s.url === l)) candidates.push(l);
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
var init_deepsearch = __esm({
  "src/deepsearch.ts"() {
    "use strict";
    init_probe();
    init_query();
  }
});

// src/index.ts
init_query();
import { defineTool as defineTool2 } from "@deepseek-ai/dsh-tools";

// src/github.ts
import { homedir as homedir2 } from "node:os";
import { readFileSync, existsSync as existsSync2 } from "node:fs";
import { join as join2 } from "node:path";
var API = "https://api.github.com";
var ENDPOINTS = { repo: "repositories", code: "code", issue: "issues", commit: "commits" };
var UA = { "User-Agent": "dsh-search", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
function githubToken() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_PAT;
  if (env) return env;
  try {
    const p = join2(homedir2(), ".dsh", ".credentials.yaml");
    if (!existsSync2(p)) return "";
    const lines = readFileSync(p, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = /^([A-Z0-9_]+)\s*:\s*(\S+)\s*$/.exec(t);
      if (m && (m[1] === "GITHUB_TOKEN" || m[1] === "GH_PAT")) return m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
  }
  try {
    const { execSync } = __require("node:child_process");
    const t = execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (t) return t;
  } catch {
  }
  return "";
}
function mapHit(kind, item) {
  switch (kind) {
    case "repo":
      return {
        kind,
        title: item.full_name ?? item.name ?? "",
        url: item.html_url ?? "",
        detail: [item.description ?? "", "\u2605" + (item.stargazers_count ?? 0) + " \xB7 " + (item.language ?? "")].filter(Boolean).join(" "),
        extra: { stars: item.stargazers_count ?? 0, forks: item.forks_count ?? 0, updated: item.updated_at ?? "" }
      };
    case "code":
      return {
        kind,
        title: (item.repository?.full_name ?? "") + " \u2014 " + item.name,
        url: item.html_url ?? "",
        detail: item.path ?? ""
      };
    case "issue":
      return {
        kind,
        title: (item.repository_url ?? "").replace("https://api.github.com/repos/", "") + " #" + item.number + " " + (item.title ?? ""),
        url: item.html_url ?? "",
        detail: "[" + (item.state ?? "") + "] " + (item.body ?? "").replace(/\s+/g, " ").slice(0, 220)
      };
    case "commit":
      return {
        kind,
        title: (item.repository?.full_name ?? "") + " " + String(item.sha ?? "").slice(0, 7),
        url: item.html_url ?? "",
        detail: (item.commit?.message ?? "").replace(/\s+/g, " ").slice(0, 220),
        extra: { author: item.commit?.author?.name ?? "", date: item.commit?.author?.date ?? "" }
      };
  }
}
function rateLimitNote(res) {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const retryAfter = Number(res.headers.get("retry-after"));
  const bits = [];
  if (remaining != null) bits.push("remaining " + remaining);
  if (Number.isFinite(reset) && reset > 0) bits.push("resets in " + Math.max(0, Math.round((reset * 1e3 - Date.now()) / 1e3)) + "s");
  if (Number.isFinite(retryAfter) && retryAfter > 0) bits.push("retry-after " + retryAfter + "s");
  return bits.length ? " [" + bits.join(", ") + "]" : "";
}
async function githubSearch(kind, q, opts = {}) {
  const perPage = Math.min(Math.max(opts.perPage ?? 10, 1), 50);
  const token = githubToken();
  const params = new URLSearchParams({ q, per_page: String(perPage) });
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.order) params.set("order", opts.order);
  const headers = { ...UA };
  if (token) headers.Authorization = "Bearer " + token;
  if (kind === "commit") headers.Accept = "application/vnd.github+json";
  let res;
  try {
    res = await fetch(API + "/search/" + ENDPOINTS[kind] + "?" + params, { headers, signal: AbortSignal.timeout(2e4) });
  } catch (e) {
    return { hits: [], total: 0, error: "network: " + String(e.message) };
  }
  if (res.status === 401) return { hits: [], total: 0, error: "GitHub 401 \u2014 " + (kind === "code" ? "code search requires a token (GITHUB_TOKEN/GH_PAT)" : "token invalid or missing") };
  if (res.status === 403 || res.status === 429) {
    return { hits: [], total: 0, error: "GitHub " + res.status + " \u2014 rate limited" + rateLimitNote(res) + (token ? "" : " (no token: search is 10/min; a GITHUB_TOKEN raises it to 30/min)") };
  }
  if (res.status === 422) return { hits: [], total: 0, error: "GitHub 422 \u2014 invalid query syntax" };
  if (!res.ok) return { hits: [], total: 0, error: "GitHub " + res.status + rateLimitNote(res) };
  const note = rateLimitNote(res);
  const j = await res.json().catch(() => null);
  if (!j || !Array.isArray(j.items)) return { hits: [], total: 0, error: "bad payload" };
  return { hits: j.items.map((it) => mapHit(kind, it)), total: j.total_count ?? 0, ...note ? { note: "quota" + note } : {} };
}

// src/openapi.ts
import { parse as yamlParse } from "yaml";
import { readFileSync as readFileSync2, existsSync as existsSync3 } from "node:fs";
function looksLikeUrl(s) {
  return /^https?:\/\//i.test(s) || /^file:\/\//i.test(s);
}
async function loadSpecText(spec) {
  if (looksLikeUrl(spec)) {
    const res = await fetch(spec, {
      headers: { "User-Agent": "dsh-search", Accept: "application/json, application/yaml, text/yaml, */*" },
      redirect: "follow",
      signal: AbortSignal.timeout(2e4)
    });
    if (!res.ok) throw new Error("spec fetch failed: HTTP " + res.status + " " + spec);
    return await res.text();
  }
  if (existsSync3(spec)) {
    return readFileSync2(spec, "utf8");
  }
  return spec;
}
async function parseSpec(spec) {
  if (typeof spec !== "string") return spec;
  const text = await loadSpecText(spec);
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty spec");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  try {
    return yamlParse(text);
  } catch (e) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("spec parse failed: " + String(e.message));
    }
  }
}
function findOpByOperationId(doc, operationId) {
  const paths = doc.paths ?? {};
  for (const pathTemplate of Object.keys(paths)) {
    const item = paths[pathTemplate] ?? {};
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const op = item[method];
      if (op && typeof op === "object" && op.operationId === operationId) {
        return { pathTemplate, method, operation: op };
      }
    }
  }
  return null;
}
function resolveOperation(doc, operation) {
  const m = /^\s*(get|post|put|patch|delete|head|options)\s+(\/\S*)\s*$/i.exec(operation);
  if (m) {
    const method = m[1].toLowerCase();
    const pathTemplate = m[2];
    const op = doc.paths?.[pathTemplate]?.[method];
    if (!op) throw new Error("operation not found: " + method.toUpperCase() + " " + pathTemplate);
    return { pathTemplate, method, operation: op };
  }
  const pathOnly = /^\s*(\/\S*)\s*$/.exec(operation);
  if (pathOnly) {
    const pathTemplate = pathOnly[1];
    const op = doc.paths?.[pathTemplate]?.get;
    if (!op) throw new Error("GET " + pathTemplate + " not found");
    return { pathTemplate, method: "get", operation: op };
  }
  const byId = findOpByOperationId(doc, operation.trim());
  if (byId) return byId;
  throw new Error('operation not found (not operationId, nor "METHOD /path"): ' + operation);
}
function collectParams(doc, op) {
  const item = doc.paths?.[op.pathTemplate] ?? {};
  const list = [];
  const push = (p) => {
    if (p && typeof p === "object" && p.$ref) {
      const ref = p.$ref.replace(/^#\//, "").split("/");
      let cur = doc;
      for (const seg of ref) cur = cur?.[decodeURIComponent(seg)];
      if (cur && typeof cur === "object") push(cur);
      return;
    }
    if (p && typeof p === "object") list.push(p);
  };
  const pathParams = Array.isArray(item.parameters) ? item.parameters : [];
  const opParams = Array.isArray(op.operation.parameters) ? op.operation.parameters : [];
  for (const p of pathParams) push(p);
  for (const p of opParams) push(p);
  return list;
}
function resolveAuthToken(auth) {
  if (!auth) return void 0;
  if (auth.startsWith("env:")) {
    return process.env[auth.slice(4)] || void 0;
  }
  if (auth === "github" || auth === "gh") {
    try {
      const { execSync } = __require("node:child_process");
      const t = execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return t || void 0;
    } catch {
      return process.env.GITHUB_TOKEN || process.env.GH_PAT || void 0;
    }
  }
  return auth;
}
function buildRequest(doc, op, params, opts = {}) {
  const baseUrl = opts.server ? opts.server.replace(/\/+$/, "") : (doc.servers?.[0]?.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("no server URL in spec \u2014 pass server= override");
  let path = op.pathTemplate;
  const query = [];
  const headers = { "User-Agent": "dsh-search/openapi", Accept: "application/json" };
  let body;
  const securitySchemes = doc.components?.securitySchemes ?? {};
  for (const p of collectParams(doc, op)) {
    const name2 = String(p.name ?? "");
    const where = String(p.in ?? "");
    const val = params[name2];
    if (val === void 0) continue;
    if (where === "path") {
      path = path.replaceAll("{" + name2 + "}", encodeURIComponent(String(val)));
    } else if (where === "query") {
      query.push(encodeURIComponent(name2) + "=" + encodeURIComponent(typeof val === "object" ? JSON.stringify(val) : String(val)));
    } else if (where === "header") {
      headers[name2] = String(val);
    }
  }
  const missing = [...path.matchAll(/\{([^}]+)\}/g)].map((mm) => mm[1]);
  if (missing.length) throw new Error("missing path params: " + missing.join(", ") + " (pass params= {name: value})");
  const rb = op.operation.requestBody;
  const bodyObj = params.body ?? params.requestBody;
  if (rb && bodyObj !== void 0) {
    let content;
    if (rb.$ref) {
      const ref = rb.$ref.replace(/^#\//, "").split("/");
      let cur = doc;
      for (const seg of ref) cur = cur?.[decodeURIComponent(seg)];
      content = cur?.content;
    } else {
      content = rb.content;
    }
    const ctype = Object.keys(content ?? {}).find((c) => c.includes("json")) ?? Object.keys(content ?? {})[0];
    if (ctype) {
      if (ctype.includes("json")) {
        headers["Content-Type"] = "application/json";
        body = typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj);
      } else if (ctype.includes("x-www-form-urlencoded")) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(Object.entries(bodyObj)).toString();
      }
    }
  }
  const authToken = resolveAuthToken(opts.auth);
  const opSecurity = op.operation.security ?? doc.security;
  const schemeRef = Array.isArray(opSecurity) && opSecurity.length ? Object.keys(opSecurity[0])[0] : void 0;
  const scheme = schemeRef ? securitySchemes[schemeRef] : void 0;
  if (authToken) {
    if (scheme?.type === "apiKey") {
      const keyName = scheme.name ?? "Authorization";
      if (scheme.in === "query") query.push(encodeURIComponent(keyName) + "=" + encodeURIComponent(authToken));
      else if (scheme.in === "header") headers[keyName] = authToken;
    } else if (scheme?.scheme === "basic") {
      headers.Authorization = "Basic " + Buffer.from(authToken + ":x-oauth-basic").toString("base64");
    } else {
      headers.Authorization = "Bearer " + authToken;
    }
  }
  const qs = query.length ? "?" + query.join("&") : "";
  return { url: baseUrl + path + qs, method: op.method.toUpperCase(), headers, body };
}
function formatResult(status, headers, json) {
  const lines = [];
  lines.push("HTTP " + status + (headers.get("x-ratelimit-remaining") ? " | rate-limit-remaining: " + headers.get("x-ratelimit-remaining") : ""));
  if (json === null || json === void 0) return lines.join("\n");
  if (Array.isArray(json)) {
    lines.push("[" + json.length + " items]");
    for (const it of json.slice(0, 20)) {
      if (it && typeof it === "object") {
        const o = it;
        const title = o.full_name || o.name || o.title || o.login || o.path || o.id || (Object.values(o)[0] ?? "");
        lines.push("\u2022 " + String(title).slice(0, 200));
      } else {
        lines.push("\u2022 " + String(it).slice(0, 200));
      }
    }
    if (json.length > 20) lines.push("\u2026 +" + (json.length - 20) + " more");
    return lines.join("\n");
  }
  if (typeof json === "object") {
    const s = JSON.stringify(json, null, 2);
    return s.length > 4e3 ? s.slice(0, 4e3) + "\n\u2026 (truncated)" : s;
  }
  return String(json).slice(0, 4e3);
}
async function callOpenApi(args) {
  const doc = await parseSpec(args.spec);
  const op = resolveOperation(doc, args.operation);
  const req = buildRequest(doc, op, args.params ?? {}, { server: args.server, auth: args.auth });
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: AbortSignal.timeout(args.timeoutMs ?? 6e4)
  });
  const text = await res.text();
  let json = text;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return formatResult(res.status, res.headers, json);
}

// src/arxiv.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname, join as join3 } from "node:path";

// src/openalex.ts
var API2 = "https://api.openalex.org/works";
var UA2 = "dsh-search/0.4 (mailto:noreply@example.com)";
function rebuildAbstract(inv, maxChars = 1200) {
  if (inv == null || typeof inv !== "object") return "";
  const slots = [];
  for (const [word, positions] of Object.entries(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) if (Number.isInteger(p) && p >= 0) slots[p] = word;
  }
  const text = slots.filter((s) => s !== void 0).join(" ").replace(/\s+/g, " ").trim();
  return text.length > maxChars ? text.slice(0, maxChars) + "\u2026" : text;
}
function workId(w) {
  const arxiv = w.ids?.arxiv;
  if (typeof arxiv === "string" && arxiv) return arxiv.replace(/^https?:\/\/arxiv\.org\/abs\//, "");
  if (typeof w.doi === "string" && w.doi) return w.doi.replace(/^https?:\/\/doi\.org\//, "");
  return String(w.id ?? "").replace(/^https?:\/\/openalex\.org\//, "");
}
async function openAlexSearch(query, opts = {}) {
  const params = new URLSearchParams({
    search: query.replace(/^(all|ti|abs|au|cat):/i, ""),
    "per-page": String(Math.max(1, Math.min(opts.maxResults ?? 5, 25))),
    select: "id,doi,title,publication_year,authorships,abstract_inverted_index,ids"
  });
  try {
    const res = await fetch(API2 + "?" + params.toString(), {
      headers: { "User-Agent": UA2, Accept: "application/json" },
      signal: AbortSignal.timeout(2e4)
    });
    if (!res.ok) return { query, papers: [], error: "OpenAlex HTTP " + res.status };
    const json = await res.json();
    const papers = (json.results ?? []).filter((w) => String(w.title ?? "").trim().length > 0).map((w) => ({
      id: workId(w),
      title: String(w.title).replace(/\s+/g, " ").trim(),
      summary: rebuildAbstract(w.abstract_inverted_index),
      published: w.publication_year ? String(w.publication_year) : "",
      updated: "",
      authors: (w.authorships ?? []).map((a) => String(a.author?.display_name ?? "")).filter(Boolean),
      categories: [],
      pdfUrl: ""
    }));
    return { query, papers, total: papers.length };
  } catch (err) {
    return { query, papers: [], error: "OpenAlex " + String(err.message ?? err).slice(0, 90) };
  }
}

// src/core.ts
var API3 = "https://api.core.ac.uk/v3/search/works";
var UA3 = "dsh-search/0.5 (local research agent; core api client)";
function mapCoreRecord(r) {
  const title = String(r.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return null;
  const doi = typeof r.doi === "string" && r.doi ? r.doi.replace(/^https?:\/\/doi\.org\//, "") : "";
  const arxiv = typeof r.arxivId === "string" && r.arxivId ? r.arxivId.replace(/^https?:\/\/arxiv\.org\/abs\//, "") : "";
  return {
    id: arxiv || doi || String(r.id ?? ""),
    title,
    summary: String(r.abstract ?? "").replace(/\s+/g, " ").trim().slice(0, 1200),
    published: r.yearPublished ? String(r.yearPublished) : "",
    updated: "",
    authors: (r.authors ?? []).map((a) => String(a?.name ?? "")).filter(Boolean),
    categories: [],
    pdfUrl: String(r.downloadUrl ?? "")
  };
}
async function coreSearch(query, opts = {}) {
  const params = new URLSearchParams({ q: query.replace(/^(all|ti|abs|au|cat):/i, ""), limit: String(Math.max(1, Math.min(opts.maxResults ?? 5, 20))) });
  try {
    const res = await fetch(API3 + "?" + params.toString(), { headers: { "User-Agent": UA3, Accept: "application/json" }, signal: AbortSignal.timeout(2e4) });
    if (!res.ok) return { query, papers: [], error: "CORE HTTP " + res.status };
    const json = await res.json();
    const papers = (json.results ?? []).map(mapCoreRecord).filter((p) => p !== null);
    return { query, papers, total: papers.length };
  } catch (err) {
    return { query, papers: [], error: "CORE " + String(err.message ?? err).slice(0, 90) };
  }
}

// src/arxiv.ts
var API4 = "https://export.arxiv.org/api/query";
var UA4 = "dsh-search/0.5 (local research agent; arxiv api client; +https://info.arxiv.org/help/api/)";
var MIN_GAP_MS = 3100;
var THROTTLE_FILE = join3(process.env.DSH_HOME ?? join3(homedir3(), ".dsh"), ".arxiv-throttle");
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function throttle() {
  for (; ; ) {
    let last = 0;
    try {
      last = Number(readFileSync3(THROTTLE_FILE, "utf8")) || 0;
    } catch {
      last = 0;
    }
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  try {
    mkdirSync2(dirname(THROTTLE_FILE), { recursive: true });
    writeFileSync(THROTTLE_FILE, String(Date.now()));
  } catch {
  }
}
var RESULT_TTL_MS = 10 * 60 * 1e3;
var MEMO_MAX = 60;
var memo = /* @__PURE__ */ new Map();
function parseRetryAfter(header) {
  const n = Number(String(header ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.min(n * 1e3, 6e4) : 0;
}
function parseAtom(xml) {
  const out = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const grab = (tag) => {
      const mm = e.match(new RegExp("<(?:[a-z]+:)?" + tag + ">([\\s\\S]*?)</(?:[a-z]+:)?" + tag + ">"));
      return mm ? mm[1].trim() : "";
    };
    const idFull = grab("id");
    const id = idFull.split("/abs/").pop() ?? "";
    const title = grab("title").replace(/\s+/g, " ").trim();
    const summary = grab("summary").replace(/\s+/g, " ").trim();
    const published = grab("published").slice(0, 10);
    const updated = grab("updated").slice(0, 10);
    const authors = [...e.matchAll(/<author>([\s\S]*?)<\/author>/g)].map((am) => {
      const nm = am[1].match(/<name>([\s\S]*?)<\/name>/);
      return nm ? nm[1].trim() : "";
    });
    const categories = [...e.matchAll(/<category term="([^"]*)"[^>]*\/>/g)].map((cm) => cm[1]);
    if (!id || !title) continue;
    out.push({ id, title, summary, published, updated, authors, categories, pdfUrl: "https://arxiv.org/pdf/" + id.replace(/v\d+$/, "") });
  }
  return out;
}
async function arxivSearch(query, opts = {}) {
  const params = new URLSearchParams({
    search_query: query,
    start: String(opts.start ?? 0),
    max_results: String(Math.max(1, Math.min(opts.maxResults ?? 5, 100))),
    sortBy: opts.sortBy ?? "relevance",
    sortOrder: "descending"
  });
  const key = params.toString();
  const hit = memo.get(key);
  if (hit != null && Date.now() - hit.at < RESULT_TTL_MS) return { ...hit.value, note: hit.value.note ?? "cached" };
  const delays = [0, 4e3, 12e3];
  let lastError = "";
  let serverAskedWait = 0;
  for (let i = 0; i < delays.length; i++) {
    const wait = Math.max(delays[i], i > 0 ? serverAskedWait : 0);
    if (wait > 0) await sleep(wait);
    serverAskedWait = 0;
    try {
      await throttle();
      const res = await fetch(API4 + "?" + params.toString(), {
        headers: { "User-Agent": UA4, Accept: "application/atom+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(15e3)
      });
      if (res.status === 429 || res.status === 503) {
        serverAskedWait = parseRetryAfter(res.headers.get("retry-after"));
        lastError = "HTTP " + res.status + " (arXiv rate limit: at most one request per 3s, and a burst gets the IP temporarily blocked)" + (serverAskedWait ? "; server asked to wait " + Math.round(serverAskedWait / 1e3) + "s" : "");
        continue;
      }
      if (!res.ok) return { query, papers: [], error: "HTTP " + res.status };
      const xml = await res.text();
      const totalM = xml.match(/opensearch:totalResults>([0-9]+)</);
      const value = { query, papers: parseAtom(xml), total: totalM ? Number(totalM[1]) : void 0 };
      if (memo.size >= MEMO_MAX) {
        const oldest = memo.keys().next().value;
        if (oldest !== void 0) memo.delete(oldest);
      }
      memo.set(key, { at: Date.now(), value });
      return value;
    } catch (err) {
      lastError = String(err.message ?? err);
    }
  }
  return { query, papers: [], error: lastError || "unknown failure" };
}
async function arxivSearchBatch(queries, opts = {}) {
  const out = [];
  for (const q of queries) {
    const r = await arxivSearch(q, opts);
    out.push({ ...r, source: "arxiv" });
  }
  if (out.length > 0 && out.every((r) => r.error != null)) {
    const alt = [];
    for (const q of queries) {
      const r = await openAlexSearch(q, { maxResults: opts.maxResults });
      alt.push({ ...r, source: "openalex", note: "arXiv API unreachable; served by OpenAlex" });
    }
    if (alt.some((r) => r.papers.length > 0)) return alt;
    const third = [];
    for (const q of queries) {
      const r = await coreSearch(q, { maxResults: opts.maxResults });
      third.push({ ...r, source: "core", note: "arXiv + OpenAlex unreachable; served by CORE" });
    }
    if (third.some((r) => r.papers.length > 0)) return third;
  }
  return out;
}
function paperUrl(id, source) {
  const s = String(id ?? "").trim();
  if (/^10\.\d{4,}/.test(s)) return "https://doi.org/" + s;
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) return "https://arxiv.org/abs/" + s;
  if (source === "openalex") return "https://openalex.org/" + s;
  if (source === "core") return "https://core.ac.uk/works/" + s;
  return "https://arxiv.org/abs/" + s;
}
function formatPapers(r, summaryChars = 280) {
  const label = r.source === "openalex" ? "OpenAlex (arXiv fallback)" : r.source === "core" ? "CORE (arXiv fallback)" : "arXiv";
  const head = label + ": " + r.query + (r.total !== void 0 ? "  (total " + r.total + ")" : "") + (r.note ? "  [" + r.note + "]" : "");
  if (r.error) return head + "\nERROR: " + r.error;
  if (!r.papers.length) return head + "\nNo results.";
  const lines = [head, ""];
  for (const p of r.papers) {
    lines.push("\u25AA [" + p.id + "] " + p.title + "  (" + p.published + ")");
    if (p.authors.length) lines.push("  " + p.authors.slice(0, 4).join(", ") + (p.authors.length > 4 ? " et al." : ""));
    if (p.categories.length) lines.push("  cat: " + p.categories.slice(0, 4).join(" "));
    lines.push("  " + paperUrl(p.id, r.source));
    lines.push("  " + (p.summary.length > summaryChars ? p.summary.slice(0, summaryChars) + "\u2026" : p.summary));
    lines.push("");
  }
  return lines.join("\n");
}
function formatBatch(results, summaryChars = 280) {
  const parts = results.map((r) => formatPapers(r, summaryChars));
  const papers = results.reduce((n, r) => n + r.papers.length, 0);
  const failed = results.filter((r) => r.error != null).length;
  if (papers === 0 && failed === 0) return "No results for any query.";
  const note = failed > 0 ? "\n\n" + failed + "/" + results.length + " queries FAILED (see ERROR above) -- this is NOT an empty result set. The source was unreachable or rate-limited; retry shortly, or use a different source." : "";
  return parts.join("\n\n----------\n\n") + note;
}

// src/hubs.ts
var UA5 = "dsh-search/0.6 (local research agent; hub client)";
function humanBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return (x >= 10 || i === 0 ? Math.round(x) : x.toFixed(1)) + " " + units[i];
}
function humanCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(Math.round(v));
}
function mapHfModel(m) {
  const id = String(m.id ?? m.modelId ?? "");
  const tags = Array.isArray(m.tags) ? m.tags.filter((t) => !t.includes(":")).slice(0, 3) : [];
  return {
    id,
    title: id,
    url: "https://huggingface.co/" + id,
    detail: "downloads " + humanCount(m.downloads) + " \xB7 likes " + humanCount(m.likes) + (m.pipeline_tag ? " \xB7 " + String(m.pipeline_tag) : "") + (tags.length ? " \xB7 " + tags.join(",") : "")
  };
}
function mapHfDataset(m) {
  const id = String(m.id ?? "");
  return {
    id,
    title: id,
    url: "https://huggingface.co/datasets/" + id,
    detail: "downloads " + humanCount(m.downloads) + " \xB7 likes " + humanCount(m.likes)
  };
}
function mapKaggleDataset(d) {
  const ref = String(d.ref ?? d.id ?? "");
  const title = String(d.title ?? d.titleNullable ?? ref);
  const sub = String(d.subtitle ?? d.subtitleNullable ?? "");
  return {
    id: ref,
    title: title + (sub ? " \u2014 " + sub : ""),
    url: String(d.url ?? d.urlNullable ?? "https://www.kaggle.com/datasets/" + ref),
    detail: String(d.creatorName ?? d.creatorNameNullable ?? "?") + " \xB7 " + humanBytes(d.totalBytes ?? d.totalBytesNullable) + " \xB7 downloads " + humanCount(d.downloadCount) + " \xB7 votes " + humanCount(d.voteCount)
  };
}
function relaxQuery(query) {
  const terms = String(query ?? "").trim().split(/\s+/).filter(Boolean);
  if (terms.length < 3) return null;
  return terms.slice(0, -1).join(" ");
}
async function hubSearch(kind, query, limit = 10) {
  const n = Math.max(1, Math.min(limit, 25));
  const q = query.trim();
  const urls = {
    "hf-models": "https://huggingface.co/api/models?limit=" + n + "&search=" + encodeURIComponent(q),
    "hf-datasets": "https://huggingface.co/api/datasets?limit=" + n + "&search=" + encodeURIComponent(q),
    "kaggle-datasets": "https://www.kaggle.com/api/v1/datasets/list?pageSize=" + n + "&search=" + encodeURIComponent(q)
  };
  try {
    const res = await fetch(urls[kind], { headers: { "User-Agent": UA5, Accept: "application/json" }, signal: AbortSignal.timeout(2e4), redirect: "follow" });
    if (res.status === 401 || res.status === 403) {
      return { kind, query: q, hits: [], error: "HTTP " + res.status + " \u2014 this surface needs a credential (the anonymous ones are hf-models, hf-datasets, kaggle-datasets)" };
    }
    if (!res.ok) return { kind, query: q, hits: [], error: "HTTP " + res.status };
    const json = await res.json();
    if (!Array.isArray(json)) return { kind, query: q, hits: [], error: "unexpected payload" };
    const hits = json.map((r) => kind === "kaggle-datasets" ? mapKaggleDataset(r) : kind === "hf-datasets" ? mapHfDataset(r) : mapHfModel(r)).filter((h) => h.id);
    if (hits.length === 0) {
      const relaxed = relaxQuery(q);
      if (relaxed != null) {
        const retry = await hubSearch(kind, relaxed, limit);
        if (retry.hits.length > 0) return { ...retry, note: "no hits for " + JSON.stringify(q) + "; retried with " + JSON.stringify(relaxed) };
      }
    }
    return { kind, query: q, hits, note: "no credential used" };
  } catch (err) {
    return { kind, query: q, hits: [], error: String(err.message ?? err).slice(0, 120) };
  }
}

// src/opensources.ts
var UA6 = "dsh-search/0.6 (local research agent; open-source client)";
var OPEN_SOURCES = {
  crossref: { label: "Crossref \u2014 DOI metadata for every registered work", docs: "https://api.crossref.org" },
  europepmc: { label: "Europe PMC \u2014 life-science literature + preprints, 10 rps", docs: "https://europepmc.org/RestfulWebService" },
  pubmed: { label: "PubMed \u2014 biomedical index (NCBI E-utilities)", docs: "https://www.ncbi.nlm.nih.gov/books/NBK25501/" },
  figshare: { label: "Figshare \u2014 research outputs, datasets, figures", docs: "https://docs.figshare.com" },
  clinicaltrials: { label: "ClinicalTrials.gov v2 \u2014 registered studies", docs: "https://clinicaltrials.gov/data-api/api" },
  openfda: { label: "openFDA \u2014 drug adverse-event reports", docs: "https://open.fda.gov/apis/" },
  chembl: { label: "ChEMBL \u2014 compounds and bioactivity", docs: "https://www.ebi.ac.uk/chembl/api/data/docs" }
};
var enc = encodeURIComponent;
var str = (v) => typeof v === "string" ? v : Array.isArray(v) ? String(v[0] ?? "") : v == null ? "" : String(v);
function mapCrossref(it) {
  const doi = str(it.DOI);
  const authors = Array.isArray(it.author) ? it.author.slice(0, 3).map((a) => [str(a.given), str(a.family)].filter(Boolean).join(" ")).filter(Boolean) : [];
  const year = str(it.issued?.["date-parts"]?.[0]?.[0]);
  return {
    title: str(it.title) || doi,
    url: doi ? "https://doi.org/" + doi : "",
    detail: [year, authors.join(", "), str(it.publisher), str(it.type), "cited-by " + str(it["is-referenced-by-count"])].filter(Boolean).join(" \xB7 ")
  };
}
function mapEuropePmc(r) {
  const id = str(r.id);
  const doi = str(r.doi);
  return {
    title: str(r.title) || id,
    url: doi ? "https://doi.org/" + doi : "https://europepmc.org/article/" + str(r.source) + "/" + id,
    detail: [str(r.pubYear), str(r.authorString), str(r.pubType), r.isOpenAccess === "Y" ? "open access" : "", "cited-by " + str(r.citedByCount)].filter(Boolean).join(" \xB7 ")
  };
}
function mapFigshare(r) {
  const id = str(r.id);
  const doi = str(r.doi);
  return {
    title: str(r.title) || id,
    url: doi ? "https://doi.org/" + doi : "https://figshare.com/articles/" + id,
    detail: [String(r.published_date ?? "").slice(0, 10), str(r.defined_type_name)].filter(Boolean).join(" \xB7 ")
  };
}
function mapClinicalTrial(s) {
  const proto = s.protocolSection ?? {};
  const nct = str(proto.identificationModule?.nctId);
  return {
    title: str(proto.identificationModule?.briefTitle) || nct,
    url: "https://clinicaltrials.gov/study/" + nct,
    detail: [str(proto.statusModule?.overallStatus), (proto.conditionsModule?.conditions ?? []).slice(0, 3).join(", "), str(proto.designModule?.phases)].filter(Boolean).join(" \xB7 ")
  };
}
function mapChembl(m) {
  const id = str(m.molecule_chembl_id);
  const name2 = str(m.pref_name) || str(m.molecule_synonyms);
  const props = m.molecule_properties ?? {};
  return {
    title: (name2 ? name2 + " \u2014 " : "") + id,
    url: "https://www.ebi.ac.uk/chembl/compound_report_card/" + id + "/",
    detail: [props.full_mwt ? "MW " + props.full_mwt : "", props.alogp ? "logP " + props.alogp : "", str(m.max_phase) ? "max phase " + str(m.max_phase) : ""].filter(Boolean).join(" \xB7 ")
  };
}
async function openSourceSearch(source, query, limit = 5) {
  const q = String(query ?? "").trim();
  const n = Math.max(1, Math.min(limit, 25));
  if (!q) return { source, query: q, hits: [], error: "query required" };
  try {
    if (source === "crossref") {
      const r2 = await get("https://api.crossref.org/works?rows=" + n + "&query=" + enc(q));
      const items2 = r2?.message?.items ?? [];
      return { source, query: q, hits: items2.map(mapCrossref) };
    }
    if (source === "europepmc") {
      const r2 = await get("https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=" + n + "&query=" + enc(q));
      const items2 = r2?.resultList?.result ?? [];
      return { source, query: q, hits: items2.map(mapEuropePmc) };
    }
    if (source === "pubmed") {
      const s = await get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=" + n + "&term=" + enc(q));
      const ids = s?.esearchresult?.idlist ?? [];
      if (ids.length === 0) return { source, query: q, hits: [] };
      const sum = await get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=" + ids.join(","));
      const res = sum?.result ?? {};
      const hits = ids.map((id) => {
        const rec = res[id] ?? {};
        return {
          title: str(rec.title) || id,
          url: "https://pubmed.ncbi.nlm.nih.gov/" + id + "/",
          detail: [String(rec.pubdate ?? "").slice(0, 16), str(rec.source), str(rec.sortpubdate) ? "" : ""].filter(Boolean).join(" \xB7 ")
        };
      });
      return { source, query: q, hits, note: "titles via esummary (" + ids.length + " ids)" };
    }
    if (source === "figshare") {
      const r2 = await get("https://api.figshare.com/v2/articles?page_size=" + n + "&search_for=" + enc(q));
      const items2 = Array.isArray(r2) ? r2 : [];
      return { source, query: q, hits: items2.map(mapFigshare) };
    }
    if (source === "clinicaltrials") {
      const r2 = await get("https://clinicaltrials.gov/api/v2/studies?pageSize=" + n + "&query.term=" + enc(q));
      const items2 = r2?.studies ?? [];
      return { source, query: q, hits: items2.map(mapClinicalTrial) };
    }
    if (source === "openfda") {
      const r2 = await get("https://api.fda.gov/drug/event.json?limit=" + n + "&search=patient.drug.medicinalproduct:" + enc('"' + q + '"'));
      const items2 = r2?.results ?? [];
      return {
        source,
        query: q,
        hits: items2.map((x) => ({
          title: "report " + str(x.safetyreportid),
          url: "https://open.fda.gov/apis/drug/event/",
          detail: [str(x.receivedate), x.serious === "1" ? "serious" : "non-serious", str(x.primarysource?.reportercountry)].filter(Boolean).join(" \xB7 ")
        }))
      };
    }
    const r = await get("https://www.ebi.ac.uk/chembl/api/data/molecule.json?limit=" + n + "&search=" + enc(q));
    const items = r?.molecules ?? [];
    return { source, query: q, hits: items.map(mapChembl) };
  } catch (err) {
    return { source, query: q, hits: [], error: String(err.message ?? err).slice(0, 140) };
  }
}
async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA6, Accept: "application/json" }, signal: AbortSignal.timeout(2e4), redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status + " from " + new URL(url).host);
  return res.json();
}

// src/server.ts
init_query();
import { Hono } from "hono";
import { createServer } from "node:http";
import { Readable } from "node:stream";
function createApp() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, chunks: getStore().count() }));
  app.get("/fetch", async (c) => {
    const url = c.req.query("url") ?? "";
    if (!/^https?:\/\//i.test(url)) return new Response(JSON.stringify({ error: "url must start with http(s)://" }), { status: 400, headers: { "Content-Type": "application/json" } });
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (dsh-search)" },
      redirect: "follow",
      signal: AbortSignal.timeout(25e3)
    });
    if (!res.ok) return new Response(JSON.stringify({ error: "HTTP " + res.status }), { status: res.status, headers: { "Content-Type": "application/json" } });
    return c.json({ url, text: extractText(await res.text()) });
  });
  app.get("/github", async (c) => {
    const q = c.req.query("q") ?? "";
    const kind = c.req.query("type") ?? "repo";
    if (!q) return new Response(JSON.stringify({ error: "q required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    const r = await githubSearch(kind, q, { perPage: Number(c.req.query("perPage")) || 10 });
    return c.json(r);
  });
  app.post("/corpus", async (c) => {
    const body = await c.req.json().catch(() => ({ urls: [] }));
    const urls = (body.urls ?? []).filter((u) => /^https?:\/\//i.test(u));
    if (!urls.length) return new Response(JSON.stringify({ error: "no valid urls" }), { status: 400, headers: { "Content-Type": "application/json" } });
    const store2 = getStore();
    let indexed = 0;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (dsh-search)" },
          redirect: "follow",
          signal: AbortSignal.timeout(25e3)
        });
        if (!res.ok) continue;
        const chunks = chunkText(extractText(await res.text()));
        if (!chunks.length) continue;
        indexed += store2.add(url, chunks, await embedTexts(chunks));
      } catch {
      }
    }
    return c.json({ indexed, total: store2.count() });
  });
  app.get("/corpus/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const k = Math.min(Number(c.req.query("k") ?? 5) || 5, 20);
    if (!q.trim()) return new Response(JSON.stringify({ error: "q required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    const vec = (await embedTexts([q]))[0];
    return c.json({ results: getStore().search(vec, k) });
  });
  app.delete("/corpus", (c) => {
    getStore().clear();
    return c.json({ cleared: true });
  });
  return app;
}
function maybeStartServer() {
  const port = Number(process.env.DSH_SEARCH_HTTP_PORT ?? 0);
  if (!port) return null;
  const app = createApp();
  const server = createServer((req, res) => {
    const url = "http://127.0.0.1:" + port + (req.url ?? "/");
    const hasBody = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
    const init = {
      method: req.method,
      headers: req.headers
    };
    if (hasBody) init.body = Readable.toWeb(req);
    (async () => {
      try {
        const r = await app.fetch(new Request(url, init));
        res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
        res.end(await r.text());
      } catch (e) {
        res.writeHead(500);
        res.end(String(e.message ?? e));
      }
    })();
  });
  server.listen(port, "127.0.0.1");
  return () => {
    try {
      server.close();
    } catch {
    }
    resetStore();
  };
}

// src/websearch.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
var SEARCH_ENGINES = ["bing", "ddg", "ddg-lite", "searxng", "exa", "tavily"];
var BING_URL = "https://www.bing.com/search";
var DDG_HTML_URL = "https://html.duckduckgo.com/html/";
var DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";
var TAVILY_URL = "https://api.tavily.com/search";
var EXA_URL = "https://api.exa.ai/search";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var ACCEPT_LANG = "zh-CN,zh;q=0.9,en;q=0.8";
var SEARXNG_INSTANCES = [
  "https://opnxng.com",
  "https://priv.au",
  "https://searx.be",
  "https://searx.tiekoetter.com",
  "https://search.inetol.net",
  "https://paulgo.io"
];
function decodeEntities(text) {
  return String(text).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}
function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function extractDdgUrl(rel) {
  if (!rel) return null;
  const m = rel.match(/uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  if (rel.startsWith("//")) return "https:" + rel;
  return rel;
}
function uniqueSources(sources, limit) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url);
      out.push(s);
    }
    if (out.length >= limit) break;
  }
  return out;
}
async function fetchText(url, signal, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12e3);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, "accept-language": ACCEPT_LANG, ...headers },
      redirect: "follow",
      signal: controller.signal
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
async function fetchHtmlWithRetry(url, signal) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await fetchText(url, signal);
      if (html.length > 500) return html;
      lastError = new Error("empty response (" + html.length + " bytes)");
    } catch (e) {
      lastError = e;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError ?? new Error("fetch failed");
}
function approximateTimeRange(days) {
  if (days <= 2) return "day";
  if (days <= 14) return "week";
  if (days <= 90) return "month";
  return "year";
}
function parseTimeRange(tr) {
  if (tr == null) return null;
  if (typeof tr === "object") {
    const o = tr;
    if (typeof o.days === "number") return { days: o.days, label: String(o.days) + "d" };
    return null;
  }
  const s = String(tr).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+)([dwmoy])$/);
  if (m) {
    const n = Number(m[1]);
    const days = m[2] === "d" ? n : m[2] === "w" ? n * 7 : m[2] === "m" ? n * 30 : n * 365;
    return { days, label: s };
  }
  if (s === "day" || s === "week" || s === "month" || s === "year") {
    const days = s === "day" ? 1 : s === "week" ? 7 : s === "month" ? 30 : 365;
    return { days, label: s };
  }
  return null;
}
async function searchBing(query, maxResults, cfg, signal) {
  const params = new URLSearchParams({ q: query, mkt: cfg.bingMarket ?? "zh-CN" });
  const adlt = cfg.safeSearch ?? "off";
  if (adlt === "off") params.set("adlt", "off");
  else if (adlt === "moderate") params.set("adlt", "moderate");
  else params.set("adlt", "strict");
  const html = await fetchHtmlWithRetry(BING_URL + "?" + params, signal);
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  const sources = [];
  for (const block of blocks) {
    const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (!hrefMatch) continue;
    sources.push({
      url: hrefMatch[1],
      ...titleMatch ? { title: stripTags(titleMatch[1]) } : {},
      ...snippetMatch ? { snippet: stripTags(snippetMatch[1]) } : {}
    });
  }
  return uniqueSources(sources, maxResults);
}
async function searchDdgHtml(query, maxResults, cfg, signal, timeRange) {
  const params = new URLSearchParams({ q: query });
  if (cfg.region) params.set("kl", cfg.region);
  const adlt = cfg.safeSearch ?? "off";
  params.set("adlt", adlt === "strict" ? "1" : adlt === "moderate" ? "0" : "-1");
  if (timeRange?.days != null) {
    const df = { day: "d", week: "w", month: "m", year: "y" }[approximateTimeRange(timeRange.days)];
    if (df) params.set("df", df);
  }
  const html = await fetchHtmlWithRetry(DDG_HTML_URL + "?" + params, signal);
  const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? [];
  const sources = [];
  for (const block of blocks) {
    const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/);
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/);
    const dateMatch = block.match(/<span[^>]*>\s*([\dT:.+-]+)\s*<\/span>/);
    const url = extractDdgUrl(urlMatch?.[1] ?? "");
    if (!url) continue;
    sources.push({
      url,
      ...titleMatch ? { title: stripTags(titleMatch[1]) } : {},
      ...snippetMatch ? { snippet: stripTags(snippetMatch[1]) } : {},
      ...dateMatch ? { publishedAt: dateMatch[1] } : {}
    });
  }
  return uniqueSources(sources, maxResults);
}
async function searchDdgLite(query, maxResults, cfg, signal, timeRange) {
  const params = new URLSearchParams({ q: query });
  const adlt = cfg.safeSearch ?? "off";
  params.set("adlt", adlt === "strict" ? "1" : adlt === "moderate" ? "0" : "-1");
  if (timeRange?.days != null) {
    const df = { day: "d", week: "w", month: "m", year: "y" }[approximateTimeRange(timeRange.days)];
    if (df) params.set("df", df);
  }
  const html = await fetchHtmlWithRetry(DDG_LITE_URL + "?" + params, signal);
  const linkMatches = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? [];
  const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? [];
  const sources = [];
  for (let i = 0; i < linkMatches.length; i++) {
    const tag = linkMatches[i];
    const hrefMatch = tag.match(/href="([^"]*)"/);
    const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/);
    if (!hrefMatch) continue;
    const url = extractDdgUrl(hrefMatch[1]);
    if (!url) continue;
    const snippet = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1];
    sources.push({
      url,
      ...titleMatch ? { title: stripTags(titleMatch[1]) } : {},
      ...snippet ? { snippet: stripTags(snippet) } : {}
    });
  }
  return uniqueSources(sources, maxResults);
}
async function searchSearxng(query, maxResults, cfg, signal, timeRange) {
  const instances = cfg.searxngInstances?.length ? cfg.searxngInstances : SEARXNG_INSTANCES;
  const errors = [];
  for (const base of instances) {
    try {
      const params = new URLSearchParams({ q: query, format: "json" });
      if (timeRange?.days != null) {
        const tr = { day: "day", week: "week", month: "month", year: "year" }[approximateTimeRange(timeRange.days)];
        if (tr) params.set("time_range", tr);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8e3);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort);
      let response;
      try {
        response = await fetch(base + "/search?" + params, {
          headers: { "user-agent": USER_AGENT, accept: "application/json" },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      if (!response.ok) {
        errors.push(base + ": HTTP " + response.status);
        continue;
      }
      const data = await response.json().catch(() => null);
      if (!data || !Array.isArray(data.results)) {
        errors.push(base + ": invalid JSON");
        continue;
      }
      const sources = data.results.filter((r) => r.url).map((r) => ({
        url: r.url,
        ...r.title ? { title: String(r.title) } : {},
        ...r.content ? { snippet: String(r.content) } : {}
      }));
      if (sources.length > 0) return uniqueSources(sources, maxResults);
      errors.push(base + ": 0 results");
    } catch (e) {
      errors.push(base + ": " + (e instanceof Error ? e.message : String(e)));
    }
  }
  throw new Error("searxng: all instances failed \u2014 " + errors.join(" | "));
}
async function searchTavily(query, maxResults, apiKey, signal) {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ api_key: apiKey, query, max_results: Math.min(maxResults, 10), search_depth: "basic" }),
    signal
  });
  if (!res.ok) throw new Error("tavily: HTTP " + res.status);
  const data = await res.json();
  return uniqueSources(
    (data.results ?? []).map((r) => ({
      url: r.url ?? "",
      ...r.title ? { title: r.title } : {},
      ...r.content ? { snippet: r.content } : {}
    })).filter((s) => s.url),
    maxResults
  );
}
async function searchExa(query, maxResults, apiKey, signal) {
  const res = await fetch(EXA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "user-agent": USER_AGENT },
    body: JSON.stringify({ query, numResults: Math.min(maxResults, 10) }),
    signal
  });
  if (!res.ok) throw new Error("exa: HTTP " + res.status);
  const data = await res.json();
  return uniqueSources(
    (data.results ?? []).map((r) => ({
      url: r.url ?? "",
      ...r.title ? { title: r.title } : {},
      ...r.text ? { snippet: r.text.slice(0, 300) } : {}
    })).filter((s) => s.url),
    maxResults
  );
}
var CACHE_MAX = 50;
var cache = /* @__PURE__ */ new Map();
function cacheKey(query, maxResults, engine, timeLabel) {
  return engine + "|" + maxResults + "|" + timeLabel + "|" + query;
}
function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return void 0;
  if (Date.now() > e.expiresAt) {
    cache.delete(key);
    return void 0;
  }
  cache.delete(key);
  cache.set(key, e);
  return e.value;
}
function cacheSet(key, value, ttlMs) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
var KEYED_ENGINES = {
  exa: { fn: (q, m, _c, s) => searchExa(q, m, process.env.EXA_API_KEY ?? "", s), keyEnv: "EXA_API_KEY" },
  tavily: { fn: (q, m, _c, s) => searchTavily(q, m, process.env.TAVILY_API_KEY ?? "", s), keyEnv: "TAVILY_API_KEY" }
};
var FREE_ENGINES = {
  ddg: searchDdgHtml,
  "ddg-lite": searchDdgLite,
  searxng: searchSearxng,
  bing: searchBing
};
var STOPWORDS = /* @__PURE__ */ new Set(["the", "and", "for", "with", "how", "what", "why", "best", "vs", "not", "from", "into", "that", "this", "are", "was", "you", "your", "can", "a", "an", "of", "in", "to", "on"]);
function isNavigational(url) {
  try {
    const u = new URL(String(url));
    return u.pathname === "/" || u.pathname === "";
  } catch {
    return false;
  }
}
function looksOffTopic(query, hits) {
  const tokens = (String(query).toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
  if (tokens.length === 0) return false;
  const hay = (h) => ((h.title ?? "") + " " + (h.snippet ?? "") + " " + (h.url ?? "")).toLowerCase();
  const all = hits.map(hay).join(" ");
  const matched = tokens.filter((t) => all.includes(t));
  if (matched.length === 0) return true;
  if (tokens.length >= 3 && matched.length === 1 && hits.length > 1) {
    const word = matched[0];
    if (hits.every((h) => hay(h).includes(word))) return true;
  }
  if (hits.length > 0 && hits.every((h) => isNavigational(String(h.url ?? "")))) return true;
  return false;
}
function keyedEngineAvailable(id) {
  return Boolean(process.env[KEYED_ENGINES[id].keyEnv]);
}
function engineChain(preferred) {
  const order = [];
  const push = (id) => {
    if (!order.includes(id)) order.push(id);
  };
  if (preferred) push(preferred);
  for (const id of Object.keys(KEYED_ENGINES)) if (keyedEngineAvailable(id)) push(id);
  for (const id of Object.keys(FREE_ENGINES)) push(id);
  return order;
}
async function runSearchChain(req, cfg, signal) {
  const query = String(req.query ?? "").trim();
  if (!query) throw new Error("query is required");
  const maxResults = Math.min(Math.max(Number(req.maxResults) || 5, 1), 20);
  const tr = parseTimeRange(req.timeRange);
  const timeLabel = tr?.label ?? "";
  const preferred = typeof req.engine === "string" && SEARCH_ENGINES.includes(req.engine) ? req.engine : cfg.provider && SEARCH_ENGINES.includes(cfg.provider) ? cfg.provider : void 0;
  const cacheTtlMs = Math.min(Math.max(Number(req.cacheTtl ?? cfg.cacheTtl ?? 5), 0), 5) * 60 * 1e3;
  const cacheEnabled = req.cache !== false && cfg.cache !== false && cacheTtlMs > 0;
  const key = cacheEnabled ? cacheKey(query, maxResults, preferred ?? "auto", timeLabel) : null;
  if (key) {
    const hit = cacheGet(key);
    if (hit) return { ...hit, note: (hit.note ?? "") + " [cache hit]" };
  }
  const chain = engineChain(preferred);
  const errors = [];
  let offTopicBest = null;
  for (const id of chain) {
    try {
      let sources;
      if (KEYED_ENGINES[id]) {
        if (!keyedEngineAvailable(id)) {
          errors.push(id + ": missing " + KEYED_ENGINES[id].keyEnv);
          continue;
        }
        sources = await KEYED_ENGINES[id].fn(query, maxResults, cfg, signal, tr ?? void 0);
      } else {
        sources = await FREE_ENGINES[id](query, maxResults, cfg, signal, tr ?? void 0);
      }
      if (sources.length === 0) {
        errors.push(id + ": 0 results");
        continue;
      }
      if (looksOffTopic(query, sources)) {
        errors.push(id + ": " + sources.length + " results share no query token (off-topic)");
        if (offTopicBest == null) offTopicBest = { id, sources };
        continue;
      }
      const out = {
        sources,
        engine: id,
        note: id === preferred || !preferred ? void 0 : 'preferred "' + preferred + '" failed, fell back to "' + id + '"' + (errors.length ? " (" + errors.join("; ") + ")" : "")
      };
      if (key) {
        cacheSet(key, out, id === preferred || !preferred ? cacheTtlMs : Math.max(Math.round(cacheTtlMs / 5), 1e3));
      }
      return out;
    } catch (e) {
      errors.push(id + ": " + (e instanceof Error ? e.message : String(e)));
    }
  }
  if (offTopicBest != null) {
    const best = {
      sources: offTopicBest.sources,
      engine: offTopicBest.id,
      note: 'WARNING: no engine returned on-topic results (none shared a query token); best-effort from "' + offTopicBest.id + '". Tried: ' + errors.join(" | ")
    };
    if (key) cacheSet(key, best, Math.max(Math.round(cacheTtlMs / 5), 1e3));
    return best;
  }
  throw new Error("all search engines failed: " + errors.join(" | "));
}
function createWebSearchProvider(cfg) {
  return {
    id: "dsh-search",
    available() {
      return true;
    },
    async search(request, signal) {
      const out = await runSearchChain(request, cfg(), signal);
      return { content: out.content, sources: out.sources, truncated: false };
    }
  };
}
function registerPlatformSearchTool(ctx, cfg) {
  ctx.tools.register(defineTool({
    name: "platform_search",
    description: "Web search with explicit engine control (dsh-search v0.4). Engines: bing, ddg, ddg-lite, searxng (free, no key); exa, tavily (require EXA_API_KEY / TAVILY_API_KEY). Unknown or failed engines fall back automatically with a note. timeRange filters results (day/week/month/year). Returns citeable sources.",
    parameters: {
      query: { type: "string", required: true, description: "search query" },
      engine: { type: "string", description: "engine override: bing | ddg | ddg-lite | searxng | exa | tavily (default: auto)" },
      maxResults: { type: "number", description: "max results (default 5, max 20)" },
      timeRange: { type: "string", description: 'time filter: "day" | "week" | "month" | "year" or "3d"/"2w"/"1m"' }
    },
    // The host validates tool schemas and aborts the plugin tree on a bad one:
    // `type: 'json'` is not a JSON-schema type, and an object schema must declare
    // `additionalProperties` explicitly.
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 6e4,
    async execute(args) {
      const out = await runSearchChain({
        query: String(args?.query ?? ""),
        maxResults: Number(args?.maxResults) || 5,
        engine: args?.engine ? String(args.engine) : void 0,
        timeRange: args?.timeRange ? String(args.timeRange) : void 0
      }, cfg());
      return {
        engine: out.engine,
        ...out.note ? { note: out.note } : {},
        sources: out.sources
      };
    }
  }));
}
function registerWebProvider(ctx, cfg) {
  if (!ctx.web || typeof ctx.web.registerSearchProvider !== "function") {
    console.warn("[dsh-search] ctx.web.registerSearchProvider unavailable (ctx.web=" + !!ctx.web + "), provider NOT registered");
    return;
  }
  console.log("[dsh-search] registering provider dsh-search");
  const disposer = ctx.web.registerSearchProvider(createWebSearchProvider(cfg));
  console.log("[dsh-search] provider registered OK");
  try {
    if (!ctx.web.searchProviderId) {
      ctx.web.searchProviderId = "dsh-search";
    }
  } catch {
  }
  try {
    if (typeof ctx.onDispose === "function") {
      ctx.onDispose(() => {
        try {
          disposer();
        } catch {
        }
      });
    }
  } catch {
  }
}

// src/index.ts
var textOut = { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: String(v) }] };
var name = "dsh-search";
var inject = ["tools", "web"];
async function apply(ctx) {
  console.log("[dsh-search] apply called, ctx.web =", !!ctx.web, ", registerSearchProvider =", typeof ctx.web?.registerSearchProvider);
  const searchCfg = () => ({
    provider: process.env.DSH_SEARCH_PROVIDER || "bing",
    cache: true,
    cacheTtl: 5
  });
  registerWebProvider(ctx, searchCfg);
  registerPlatformSearchTool(ctx, searchCfg);
  ctx.tools.register(defineTool2({
    name: "search_code",
    description: 'Search a local codebase with a natural-language or symbol query (semble-style: BM25 + identifier tokens + definition-aware reranking; ARK semantic layer when ARK_API_KEY is present, local hash otherwise). Returns precise file:line snippets so you do not need grep+read to find code. Filter syntax: +"word" required, -"word" excluded, file:"glob" (e.g. +"auth" file:"*.ts"). Index is cached at ~/.dsh/search-index/ and refreshed incrementally on file changes.',
    parameters: {
      path: { type: "string", required: true, description: "absolute path to the codebase root" },
      query: { type: "string", required: true, description: 'natural-language or symbol query, e.g. "how is authentication handled" or "parseConfig"' },
      topK: { type: "number", description: "max results (default 10, max 30)" },
      maxSnippetLines: { type: "number", description: "lines of content per result (default 0 = file:line only; N = first N lines; -1 = full chunk)" },
      filter: { type: "string", description: 'khoj-style filter: +"word" -"word" file:"glob"' },
      rebuild: { type: "boolean", description: "force full index rebuild (default false)" }
    },
    output: textOut,
    timeoutMs: 3e5,
    async execute(args) {
      const path = String(args?.path ?? "").trim();
      const query = String(args?.query ?? "").trim();
      if (!path) throw new Error("path required");
      if (!query) throw new Error("query required");
      const { searchCode: searchCode2 } = await Promise.resolve().then(() => (init_search(), search_exports));
      const hits = await searchCode2({
        path,
        query,
        topK: Number(args?.topK) || 10,
        filter: args?.filter ? String(args.filter) : void 0,
        rebuild: args?.rebuild === true
      });
      if (!hits.length) return "No results for: " + query;
      const maxLines = Number(args?.maxSnippetLines ?? 0);
      const lines = ["Code search: " + query + " (" + hits.length + " hits)", ""];
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        lines.push("[" + (i + 1) + "] " + h.filePath + ":" + h.startLine + "-" + h.endLine + "  (score " + h.score.toFixed(3) + ")");
        if (maxLines > 0) {
          const content = h.content.split("\n").slice(0, maxLines).join("\n");
          lines.push(content);
        } else if (maxLines < 0) {
          lines.push(h.content);
        }
        lines.push("");
      }
      return lines.join("\n");
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_fetch",
    description: "Fetch a URL WITHOUT a browser (pure Node fetch) and return extracted page text. Works on headless/remote hosts with no Chrome. Use for pure information queries; use browser_open (dsh-browser) when real page interaction is needed.",
    parameters: { url: { type: "string", required: true, description: "http(s) URL" } },
    output: textOut,
    timeoutMs: 3e4,
    async execute(args) {
      const url = String(args?.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("url must start with http(s)://");
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (dsh-search)" },
        redirect: "follow",
        signal: AbortSignal.timeout(25e3)
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = extractText(await res.text());
      return "URL: " + url + "\nchars: " + text.length + "\n\n" + text;
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_github",
    description: 'Search GitHub directly via its REST API (no Google). Types: repo (default), code, issue, commit. Code search requires a token (GITHUB_TOKEN/GH_PAT env or ~/.dsh/.credentials.yaml refs). Use qualifiers like "lang:ts stars:>100" or "repo:owner/name".',
    parameters: {
      q: { type: "string", required: true, description: "search query, may include GitHub qualifiers" },
      type: { type: "string", description: "repo | code | issue | commit (default repo)" },
      perPage: { type: "number", description: "1-50 (default 10)" },
      sort: { type: "string", description: "repo: stars/forks/updated; issue: comments/reactions/created/updated" },
      order: { type: "string", description: "asc | desc" }
    },
    output: textOut,
    timeoutMs: 3e4,
    async execute(args) {
      const kind = String(args?.type ?? "repo").toLowerCase();
      if (!["repo", "code", "issue", "commit"].includes(kind)) throw new Error("type must be repo|code|issue|commit");
      const q = String(args?.q ?? "").trim();
      if (!q) throw new Error("q required");
      const r = await githubSearch(kind, q, {
        perPage: Number(args?.perPage) || 10,
        sort: args?.sort ? String(args.sort) : void 0,
        order: args?.order ? String(args.order) : void 0
      });
      if (r.error) return "ERROR: " + r.error;
      if (!r.hits.length) return "No results (total " + r.total + ")";
      const token = githubToken() ? "authed" : "UNAUTHED (rate limit 10/min)";
      const lines = ["GitHub " + kind + " search: " + q, "total: " + r.total + " | auth: " + token, ""];
      for (const h of r.hits) {
        lines.push("\u2022 " + h.title);
        lines.push("  " + h.url);
        if (h.detail) lines.push("  " + h.detail);
        lines.push("");
      }
      return lines.join("\n");
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_open",
    description: "Search credential-free research sources: crossref (DOI metadata for any registered work), europepmc (life sciences + preprints), pubmed (biomedical index), figshare (research outputs/datasets), clinicaltrials (registered studies), openfda (drug adverse-event reports), chembl (compounds/bioactivity). Every one answered HTTP 200 from this machine with no key. Sources that need a login are deliberately NOT here.",
    parameters: {
      source: { type: "string", required: true, description: "crossref | europepmc | pubmed | figshare | clinicaltrials | openfda | chembl" },
      query: { type: "string", required: true, description: "search terms (for openfda: a drug name)" },
      limit: { type: "number", description: "max results (default 5, max 25)" }
    },
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: String(v) }] },
    timeoutMs: 45e3,
    async execute(args) {
      const source = String(args?.source ?? "").trim();
      if (!Object.prototype.hasOwnProperty.call(OPEN_SOURCES, source)) throw new Error("source must be one of: " + Object.keys(OPEN_SOURCES).join(" | "));
      const q = String(args?.query ?? "").trim();
      if (!q) throw new Error("query required");
      const r = await openSourceSearch(source, q, Number(args?.limit) || 5);
      const head = OPEN_SOURCES[source].label + "  |  query: " + JSON.stringify(q) + (r.note ? "  [" + r.note + "]" : "");
      if (r.error) return head + "\nERROR: " + r.error;
      if (!r.hits.length) return head + "\nNo results.";
      const lines = [head, ""];
      for (const h of r.hits) {
        lines.push("\u2022 " + h.title);
        if (h.url) lines.push("  " + h.url);
        if (h.detail) lines.push("  " + h.detail);
        lines.push("");
      }
      return lines.join("\n");
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_hubs",
    description: "Search model and dataset hubs: hf-models, hf-datasets (HuggingFace) and kaggle-datasets. ALL THREE ANSWER WITHOUT ANY LOGIN (measured 200/~210-420ms) and report size + popularity so a wrong pick is visible before downloading. Kaggle competitions/notebooks and ModelScope search are the credentialed half and are deliberately not covered.",
    parameters: {
      query: { type: "string", required: true, description: 'search terms, e.g. "bge embedding zh" or "protein embeddings"' },
      kind: { type: "string", description: "hf-models (default) | hf-datasets | kaggle-datasets" },
      limit: { type: "number", description: "max results (default 10, max 25)" }
    },
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: String(v) }] },
    timeoutMs: 3e4,
    async execute(args) {
      const kind = String(args?.kind ?? "hf-models");
      if (!["hf-models", "hf-datasets", "kaggle-datasets"].includes(kind)) throw new Error("kind must be hf-models|hf-datasets|kaggle-datasets");
      const q = String(args?.query ?? "").trim();
      if (!q) throw new Error("query required");
      const r = await hubSearch(kind, q, Number(args?.limit) || 10);
      if (r.error) return "ERROR: " + r.error;
      if (!r.hits.length) return "No results for " + JSON.stringify(q) + " on " + kind;
      const lines = [kind + " search: " + q + "  (" + r.hits.length + " hits, " + (r.note ?? "") + ")", ""];
      for (const h of r.hits) {
        lines.push("\u2022 " + h.title);
        lines.push("  " + h.url);
        lines.push("  " + h.detail);
        lines.push("");
      }
      return lines.join("\n");
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_api",
    description: 'Call any REST API described by an OpenAPI 3.x spec (OAS 3.0/3.1). Pass spec= as an http(s) URL, a local file path, or an inline JSON/YAML string; operation= as an operationId or "METHOD /path" (e.g. "get /search/repositories"). params= maps parameter names to values (path/query/header + body via params.body). auth= accepts a bearer/apiKey token, "env:VAR" for an env var, or "github"/"gh" to use the gh CLI keyring token. server= overrides the spec server URL. Uses @scalar/openapi-parser + yaml under the hood. Example: spec="https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json" operation="get /search/repositories" params={"q":"mem0","sort":"stars"} auth="gh".',
    parameters: {
      spec: { type: "string", required: true, description: "OpenAPI spec: http(s) URL | local file path | inline JSON/YAML string" },
      operation: { type: "string", required: true, description: 'operationId, or "METHOD /path" (e.g. "get /search/repositories")' },
      params: { type: "object", additionalProperties: true, description: "parameter name -> value (path/query/header); request body via params.body" },
      server: { type: "string", description: "override the spec server base URL" },
      auth: { type: "string", description: 'bearer/apiKey token | "env:VAR" | "github"/"gh" (gh CLI keyring)' },
      timeoutMs: { type: "number", description: "request timeout (default 60000)" }
    },
    output: textOut,
    timeoutMs: 12e4,
    async execute(args) {
      const spec = args?.spec;
      const operation = String(args?.operation ?? "").trim();
      if (!spec) throw new Error("spec required (URL, file path, or inline JSON/YAML)");
      if (!operation) throw new Error('operation required (operationId or "METHOD /path")');
      const params = args?.params && typeof args.params === "object" ? args.params : void 0;
      return await callOpenApi({
        spec,
        operation,
        params,
        server: args?.server ? String(args.server) : void 0,
        auth: args?.auth ? String(args.auth) : void 0,
        timeoutMs: args?.timeoutMs ? Number(args.timeoutMs) : void 0
      });
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_arxiv",
    description: 'Search arXiv papers via the official export API (Atom, no key). Supports arXiv query syntax: field prefixes all:/ti:/au:/abs:/cat:, boolean AND/OR/ANDNOT, quoted phrases (e.g. all:"mean-shift" AND all:"representation learning" OR ti:distillation). Pass multiple queries to cover several angles of one research question \u2014 each query is rate-limited politely (arXiv requires ~3s between calls). Returns id, title, authors, categories, published date, abstract, abs URL per hit.',
    parameters: {
      queries: { type: "array", required: true, description: "1-8 arXiv search_query strings (see syntax above)" },
      maxResultsPerQuery: { type: "number", description: "max hits per query (default 5, max 20)" },
      sortBy: { type: "string", description: "relevance (default) | recent" },
      summaryChars: { type: "number", description: "abstract chars per paper (default 280)" }
    },
    output: textOut,
    timeoutMs: 12e4,
    async execute(args) {
      const queries = Array.isArray(args?.queries) ? args.queries.filter((q) => typeof q === "string" && q.trim().length > 0).map((q) => String(q).trim()) : [];
      if (!queries.length) throw new Error("queries required (1-8 strings)");
      if (queries.length > 8) throw new Error("max 8 queries per call");
      const maxResults = Math.min(Number(args?.maxResultsPerQuery) || 5, 20);
      const sortBy = args?.sortBy === "recent" ? "submittedDate" : "relevance";
      const summaryChars = Number(args?.summaryChars) || 280;
      const results = await arxivSearchBatch(queries, { maxResults, sortBy });
      return formatBatch(results, summaryChars);
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_corpus_add",
    description: "Fetch a list of URLs, extract text, chunk, embed, and index into the ephemeral search corpus (SQLite at ~/.dsh/browser-shots/corpus.db). Use with search_corpus_search for multi-page research; clear with search_corpus_clear when done.",
    parameters: { urls: { type: "array", required: true, description: "http(s) URLs to index" } },
    output: textOut,
    timeoutMs: 12e4,
    async execute(args) {
      const urls = Array.isArray(args?.urls) ? args.urls.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u)) : [];
      if (!urls.length) throw new Error("no valid urls");
      const store2 = getStore();
      let indexed = 0;
      const errors = [];
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (dsh-search)" },
            redirect: "follow",
            signal: AbortSignal.timeout(25e3)
          });
          if (!res.ok) {
            errors.push(url + " HTTP " + res.status);
            continue;
          }
          const chunks = chunkText(extractText(await res.text()));
          if (!chunks.length) {
            errors.push(url + " empty");
            continue;
          }
          const vecs = await embedTexts(chunks);
          indexed += store2.add(url, chunks, vecs);
        } catch (e) {
          errors.push(url + " " + String(e.message));
        }
      }
      return "indexed " + indexed + " chunks from " + urls.length + " url(s) (total " + store2.count() + ")" + (errors.length ? "\nerrors: " + errors.join("; ") : "");
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_corpus_search",
    description: "Semantic search over the ephemeral corpus (see search_corpus_add). Returns top-k chunks with cosine scores.",
    parameters: {
      q: { type: "string", required: true, description: "query text" },
      k: { type: "number", description: "top-k (default 5, max 20)" }
    },
    output: textOut,
    timeoutMs: 6e4,
    async execute(args) {
      const q = String(args?.q ?? "").trim();
      if (!q) throw new Error("q required");
      const k = Math.min(Math.max(Number(args?.k) || 5, 1), 20);
      const vec = (await embedTexts([q]))[0];
      const hits = getStore().search(vec, k);
      if (!hits.length) return "corpus empty \u2014 add urls first via search_corpus_add";
      return hits.map((h, i) => "[" + (i + 1) + "] " + h.score.toFixed(3) + " " + h.url + "\n  " + h.chunk.slice(0, 240)).join("\n");
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_corpus_clear",
    description: "Clear the ephemeral search corpus (throwaway research state).",
    parameters: {},
    output: textOut,
    timeoutMs: 1e4,
    execute() {
      getStore().clear();
      return "corpus cleared";
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_probe",
    description: "Deep-web probe: mine content search engines cannot reach \u2014 Hacker News (Algolia), Reddit (JSON API), forum search endpoints (phpBB/XenForo/Flarum/Discourse/vBulletin), and RSSHub feeds (public https://rsshub.app or DSH_SEARCH_RSSHUB_URL). Returns items per source with deduped links.",
    parameters: {
      q: { type: "string", required: true, description: "search query" },
      targets: { type: "string", description: "all | hn | reddit | forum | comma-mix (default all)" },
      forumBase: { type: "string", description: "forum base URL to mine (e.g. https://forum.example.com)" },
      subreddit: { type: "string", description: "restrict Reddit to a subreddit" },
      maxPerSource: { type: "number", description: "items per source (default 10)" }
    },
    output: textOut,
    timeoutMs: 6e4,
    async execute(args) {
      const q = String(args?.q ?? "").trim();
      if (!q) throw new Error("q required");
      const { probeAll: probeAll2 } = await Promise.resolve().then(() => (init_probe(), probe_exports));
      const result = await probeAll2(q, {
        targets: args?.targets ? String(args.targets) : void 0,
        forumBase: args?.forumBase ? String(args.forumBase) : void 0,
        subreddit: args?.subreddit ? String(args.subreddit) : void 0,
        maxPerSource: Number(args?.maxPerSource) || 10
      });
      const lines = ["Probe: " + q, ""];
      let total = 0;
      for (const s of result.sources) {
        lines.push("## " + s.label + (s.error ? " [error: " + s.error + "]" : ""));
        for (const item of s.items) {
          total++;
          lines.push("- " + item.title.slice(0, 140));
          lines.push("  " + item.link);
          if (item.description) lines.push("  " + item.description.slice(0, 200));
        }
        lines.push("");
      }
      lines.push("items: " + total + " | deduped links: " + result.dedupedLinks.length);
      return lines.join("\n");
    }
  }));
  ctx.tools.register(defineTool2({
    name: "search_deep",
    description: "Agentic deep-web investigation: plan -> parallel probe (HN/Reddit/forums/RSSHub) -> reflect -> synthesize with [n] citation anchors. Unlike plain search it digs into forums and communities search engines cannot index. Requires ctx.llm (host LLM). maxIterations 1-5, maxQueries 1-10, depth light (snippets) | deep (full-page fetch).",
    parameters: {
      question: { type: "string", required: true, description: "the research question" },
      maxIterations: { type: "number", description: "1-5 (default 3)" },
      maxQueries: { type: "number", description: "1-10 (default 4)" },
      depth: { type: "string", description: "light | deep (default light)" },
      targets: { type: "string", description: "all | hn | reddit | forum | mix" },
      forumBase: { type: "string", description: "forum URL to mine" },
      subreddit: { type: "string", description: "Reddit subreddit filter" }
    },
    output: textOut,
    timeoutMs: 3e5,
    async execute(args) {
      const question = String(args?.question ?? "").trim();
      if (!question) throw new Error("question required");
      const llm = ctx.llm;
      if (!llm?.stream) throw new Error("ctx.llm not available \u2014 search_deep needs the host LLM service");
      const { deepSearch: deepSearch2 } = await Promise.resolve().then(() => (init_deepsearch(), deepsearch_exports));
      const res = await deepSearch2(llm, question, {
        maxIterations: Number(args?.maxIterations) || 3,
        maxQueries: Number(args?.maxQueries) || 4,
        depth: args?.depth === "deep" ? "deep" : "light",
        targets: args?.targets ? String(args.targets) : void 0,
        forumBase: args?.forumBase ? String(args.forumBase) : void 0,
        subreddit: args?.subreddit ? String(args.subreddit) : void 0
      });
      return "iterations: " + res.iterations + " | queries: " + res.queries.length + " | sources: " + res.sources.length + "\n\n" + res.answer;
    }
  }));
  const stop = maybeStartServer();
  if (stop) {
    ctx.onDispose?.(stop);
  }
}
async function dispose() {
  resetStore();
}
export {
  apply,
  dispose,
  inject,
  name
};
