// Collects every highlight capture used by the installed Helix queries so that
// the editor can offer all scopes a theme could style.
import fs from 'node:fs';
import path from 'node:path';

const IGNORED_PREFIXES = ['_', 'local.', 'injection.'];

function stripStringsAndComments(src) {
  return src.replace(/"(?:[^"\\]|\\.)*"|;[^\n]*/g, ' ');
}

function capturesIn(src) {
  const out = new Set();
  for (const m of stripStringsAndComments(src).matchAll(/@([A-Za-z_][\w.-]*)/g)) out.add(m[1]);
  return out;
}

let cache = null;

/** Returns { scope: [languages...] } for all captures in highlights/locals queries. */
export function collectCaptures(env) {
  if (cache) return cache;
  const byLang = new Map();
  for (const rt of env.runtimeDirs) {
    const qdir = path.join(rt, 'queries');
    let langs = [];
    try {
      langs = fs.readdirSync(qdir);
    } catch {}
    for (const lang of langs) {
      if (byLang.has(lang)) continue; // first runtime dir wins, like helix
      byLang.set(lang, path.join(qdir, lang));
    }
  }
  const scopes = new Map();
  const add = (scope, lang) => {
    if (!scopes.has(scope)) scopes.set(scope, new Set());
    scopes.get(scope).add(lang);
  };
  for (const [lang, dir] of byLang) {
    for (const file of ['highlights.scm', 'locals.scm']) {
      let src;
      try {
        src = fs.readFileSync(path.join(dir, file), 'utf8');
      } catch {
        continue;
      }
      for (const cap of capturesIn(src)) {
        if (cap.startsWith('local.definition.')) add(cap.slice('local.definition.'.length), lang);
        else if (!IGNORED_PREFIXES.some((p) => cap.startsWith(p))) add(cap, lang);
      }
    }
  }
  cache = Object.fromEntries(
    [...scopes]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, [...v].sort()]),
  );
  return cache;
}
