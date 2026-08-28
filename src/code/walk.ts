/** File walking: extension allowlist, default-ignored dirs, 1MB cap. */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const MAX_FILE_BYTES = 1_000_000;

// Common code extensions (CODE content type). Docs/config can be added later.
const CODE_EXTS = new Set([
  '.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.go','.rs','.java','.kt','.kts','.c','.h','.cpp','.hpp','.cc','.cxx','.cs','.rb','.php','.swift','.scala','.dart','.lua','.r','.m','.mm','.sh','.bash','.zsh','.ps1','.sql','.html','.css','.scss','.vue','.svelte','.json','.yaml','.yml','.toml','.ini','.cfg','.conf','.xml','.proto','.graphql','.md','.markdown','.rst','.zig','.nim','.ex','.exs','.erl','.hs','.ml','.clj','.cljs','.groovy','.gradle','.dockerfile','.tf','.hcl','.prisma','.solidity','.sol','.asm','.s','.d','.f90','.f95','.jl','.pl','.pm','.tcl','.vb','.v','.vhdl','.vhd','.tex','.bat','.cmd'
]);

const IGNORED_DIRS = new Set(['.git','.hg','.svn','node_modules','.venv','venv','dist','build','out','target','.next','.cache','__pycache__','.mypy_cache','.pytest_cache','.ruff_cache','.tox','.eggs','.semble','.dsh','.idea','.vscode','coverage','.turbo','.yarn','.pnpm-store','.git-rewrite']);

export interface IndexedFile { path: string; source: string }

/** Walk root recursively; returns repo-relative paths with source text. */
export function walkFiles(root: string, maxBytes = MAX_FILE_BYTES): IndexedFile[] {
  const out: IndexedFile[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (!IGNORED_DIRS.has(name)) walk(full);
        continue;
      }
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      if (!CODE_EXTS.has(ext)) continue;
      if (st.size > maxBytes) continue;
      try {
        const source = readFileSync(full, 'utf8');
        out.push({ path: relative(root, full).split('\\').join('/'), source });
      } catch { /* binary/unreadable: skip */ }
    }
  };
  walk(root);
  return out;
}