// Discovery of the local Helix installation: binary, config dir, runtime dirs,
// built-in (compiled-in) themes and the merged languages configuration.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(here, 'builtin');

function findOnPath(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

/** Reads the header of `hx --health`, which lists config and runtime paths. */
function readHealthHeader(hx) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const child = spawn(hx, ['--health'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const finish = () => {
      if (done) return;
      done = true;
      child.kill();
      resolve(out);
    };
    child.stdout.on('data', (d) => {
      out += d;
      if (/Runtime directories:.*\n/.test(out)) finish();
    });
    child.on('error', finish);
    child.on('close', finish);
    setTimeout(finish, 5000);
  });
}

function hxVersion(hx) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(hx, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(out.trim() || null));
  });
}

function defaultConfigDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'helix');
}

/** Mirrors helix_loader::runtime_dirs when `hx --health` is unavailable. */
function fallbackRuntimeDirs(configDir, hx) {
  const dirs = [path.join(configDir, 'runtime')];
  if (process.env.HELIX_RUNTIME) dirs.push(process.env.HELIX_RUNTIME);
  if (hx) dirs.push(path.join(path.dirname(fs.realpathSync(hx)), 'runtime'));
  return dirs;
}

// ---------------------------------------------------------------------------
// Built-in files compiled into the hx binary (`default` theme, `base16_default`
// theme and the default languages.toml). They are extracted from the binary so
// they always match the installed Helix; snapshots are used as a fallback.

const BUILTIN_MARKERS = {
  default: { start: 'attribute = "lilac"' },
  base16_default: { start: '# Author: NNB <nnbnh@protonmail.com>' },
  languages: { start: '# Language support configuration.' },
};
// Each embedded file is immediately followed by a Rust source path string.
const END_RE = /helix-(?:view|loader|core|term|lsp|event|stdx|dap|vcs|parsec|tui)\/src\//;

export function extractFromBinary(hx) {
  const result = {};
  let bin;
  try {
    bin = fs.readFileSync(fs.realpathSync(hx));
  } catch {
    return result;
  }
  for (const [key, { start }] of Object.entries(BUILTIN_MARKERS)) {
    const idx = bin.indexOf(start);
    if (idx < 0) continue;
    // Embedded TOML is at most a few hundred KB.
    const chunk = bin.subarray(idx, idx + 512 * 1024).toString('latin1');
    const m = END_RE.exec(chunk);
    if (!m) continue;
    let text = bin.subarray(idx, idx + m.index).toString('utf8');
    // The string right before the path may belong to another literal; trim to the last newline.
    text = text.slice(0, text.lastIndexOf('\n') + 1);
    try {
      parseToml(text);
      result[key] = text;
    } catch {}
  }
  return result;
}

function readSnapshot(key) {
  try {
    return fs.readFileSync(path.join(SNAPSHOT_DIR, `${key}.toml`), 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// languages.toml merging (helix merges [[language]] entries by name).

function mergeLanguages(base, user) {
  const langs = [...(base.language || [])];
  for (const entry of user.language || []) {
    const i = langs.findIndex((l) => l.name === entry.name);
    if (i >= 0) langs[i] = { ...langs[i], ...entry };
    else langs.push(entry);
  }
  return langs;
}

function simplifyLanguage(l) {
  const fileTypes = [];
  const globs = [];
  for (const ft of l['file-types'] || []) {
    if (typeof ft === 'string') fileTypes.push(ft);
    else if (ft?.glob) globs.push(ft.glob);
    else if (ft?.suffix) globs.push(`*${ft.suffix}`);
  }
  return {
    name: l.name,
    scope: l.scope,
    grammar: l.grammar ?? null,
    injection_regex: l['injection-regex'] ?? null,
    file_types: fileTypes,
    globs,
    shebangs: l.shebangs || [],
  };
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`(^|/)${re}$`);
}

// ---------------------------------------------------------------------------

let envPromise = null;

export function getHelixEnv() {
  envPromise ??= loadEnv();
  return envPromise;
}

async function loadEnv() {
  const hx = process.env.HX_BIN || findOnPath('hx') || findOnPath('helix');
  let configDir = defaultConfigDir();
  let runtimeDirs = null;
  let version = null;

  if (hx) {
    const [header, v] = await Promise.all([readHealthHeader(hx), hxVersion(hx)]);
    version = v;
    const cfg = /^Config file: (.*)$/m.exec(header);
    if (cfg && cfg[1] !== 'default') configDir = path.dirname(cfg[1].trim());
    const rt = /^Runtime directories: (.*)$/m.exec(header);
    if (rt) runtimeDirs = rt[1].trim().split(';').filter(Boolean);
  }
  runtimeDirs ??= fallbackRuntimeDirs(configDir, hx);

  const extracted = hx ? extractFromBinary(hx) : {};
  const builtins = {};
  const builtinSource = {};
  for (const key of Object.keys(BUILTIN_MARKERS)) {
    builtins[key] = extracted[key] ?? readSnapshot(key);
    builtinSource[key] = extracted[key] ? 'binary' : builtins[key] ? 'snapshot' : 'missing';
  }

  let defaultLangs = {};
  try {
    defaultLangs = parseToml(builtins.languages || '');
  } catch {}
  let userLangs = {};
  try {
    userLangs = parseToml(fs.readFileSync(path.join(configDir, 'languages.toml'), 'utf8'));
  } catch {}
  const languages = mergeLanguages(defaultLangs, userLangs).map(simplifyLanguage);
  const globMatchers = languages.flatMap((l) => l.globs.map((g) => [globToRegex(g), l.name]));

  return {
    hx,
    version,
    configDir,
    runtimeDirs,
    themeDirs: [path.join(configDir, 'themes'), ...runtimeDirs.map((d) => path.join(d, 'themes'))],
    userThemeDir: path.join(configDir, 'themes'),
    builtins,
    builtinSource,
    languages,
    /** Helix-style language detection from a file name. */
    languageForFile(fileName) {
      const base = path.basename(fileName);
      for (const [re, name] of globMatchers) if (re.test(fileName) || re.test(base)) return name;
      for (const l of languages) if (l.file_types.includes(base)) return l.name;
      const parts = base.split('.');
      for (let i = 1; i < parts.length; i++) {
        const ext = parts.slice(i).join('.');
        for (const l of languages) if (l.file_types.includes(ext)) return l.name;
      }
      return null;
    },
    languageForShebang(text) {
      const m = /^#!\s*(?:\S*\/)?(?:env\s+(?:-\S+\s+)*)?(\S+)/.exec(text);
      if (!m) return null;
      const interp = m[1].replace(/[\d.]+$/, '');
      return languages.find((l) => l.shebangs.includes(m[1]) || l.shebangs.includes(interp))?.name ?? null;
    },
  };
}
