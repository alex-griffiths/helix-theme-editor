// Theme discovery, inheritance resolution (mirroring helix-view's theme Loader)
// and saving into the user's Helix config directory.
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

const BUILTIN = ['default', 'base16_default'];
export const THEME_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** All theme names Helix can load, first match per name wins (like helix). */
export function listThemes(env) {
  const seen = new Map();
  for (const name of BUILTIN) {
    seen.set(name, { name, source: 'builtin', path: null, writable: false, shadowed: [] });
  }
  env.themeDirs.forEach((dir, dirIndex) => {
    const isUser = dir === env.userThemeDir;
    for (const file of readDirSafe(dir).sort()) {
      if (!file.endsWith('.toml')) continue;
      const name = file.slice(0, -5);
      const p = path.join(dir, file);
      if (seen.has(name)) {
        seen.get(name).shadowed.push(p);
        continue;
      }
      let inherits = null;
      try {
        const head = fs.readFileSync(p, 'utf8');
        inherits = /^\s*inherits\s*=\s*["']([^"']+)["']/m.exec(head)?.[1] ?? null;
      } catch {}
      seen.set(name, {
        name,
        source: isUser ? 'user' : 'runtime',
        path: p,
        dirIndex,
        writable: isUser,
        inherits,
        shadowed: [],
      });
    }
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findThemePath(env, name, visited) {
  for (const dir of env.themeDirs) {
    const p = path.join(dir, `${name}.toml`);
    if (!visited.has(p) && fs.existsSync(p)) return p;
  }
  if (env.themeDirs.some((d) => visited.has(path.join(d, `${name}.toml`)))) {
    throw new HttpError(400, `Cycle found in inheriting: ${name}`);
  }
  throw new HttpError(404, `Theme not found: ${name}`);
}

function parseThemeText(text, where) {
  try {
    return parseToml(text);
  } catch (e) {
    throw new HttpError(400, `Failed to parse ${where}: ${e.message}`);
  }
}

// helix-view merge_themes: palette merged key-by-key, other keys replaced wholesale.
function mergeThemes(parent, child) {
  const palette = { ...(parent.palette || {}), ...(child.palette || {}) };
  return { ...parent, ...child, palette };
}

function builtinToml(env, name) {
  const key = name === 'default' ? 'default' : 'base16_default';
  const text = env.builtins[key];
  if (!text) throw new HttpError(500, `Built-in theme '${name}' is unavailable`);
  return text;
}

function loadResolved(env, name, visited, chain) {
  if (BUILTIN.includes(name)) {
    chain.push({ name, source: 'builtin', path: null });
    return parseThemeText(builtinToml(env, name), name);
  }
  const p = findThemePath(env, name, visited);
  visited.add(p);
  chain.push({ name, source: p.startsWith(env.userThemeDir + path.sep) ? 'user' : 'runtime', path: p });
  const toml = parseThemeText(fs.readFileSync(p, 'utf8'), p);
  if (toml.inherits === undefined) return toml;
  if (typeof toml.inherits !== 'string') throw new HttpError(400, `Expected 'inherits' to be a string: ${p}`);
  const parent = loadResolved(env, toml.inherits, visited, chain);
  return mergeThemes(parent, toml);
}

/** Loads a theme with its full inheritance chain flattened. */
export function readTheme(env, name) {
  const chain = [];
  const resolved = loadResolved(env, name, new Set(), chain);
  const { palette = {}, inherits: _drop, ...styles } = resolved;
  const own = chain[0];
  const raw = own.source === 'builtin' ? builtinToml(env, name) : fs.readFileSync(own.path, 'utf8');
  return { name, source: own.source, path: own.path, chain, raw, palette, styles };
}

/** Writes a theme into ~/.config/helix/themes. */
export function saveTheme(env, name, text, { overwrite = false } = {}) {
  if (!THEME_NAME_RE.test(name)) throw new HttpError(400, `Invalid theme name: ${name}`);
  if (BUILTIN.includes(name)) throw new HttpError(400, `'${name}' is reserved for Helix's built-in theme`);
  const parsed = parseThemeText(text, 'generated theme');
  if (parsed.inherits === name) {
    // Allowed by helix (resolves to the next theme dir), but only if one exists.
    const others = env.themeDirs.slice(1).some((d) => fs.existsSync(path.join(d, `${name}.toml`)));
    if (!others) throw new HttpError(400, `Theme inherits from itself but no other '${name}' exists`);
  }
  fs.mkdirSync(env.userThemeDir, { recursive: true });
  const target = path.join(env.userThemeDir, `${name}.toml`);
  let backup = null;
  if (fs.existsSync(target)) {
    if (!overwrite) throw new HttpError(409, `${target} already exists`);
    backup = `${target}.bak`;
    fs.copyFileSync(target, backup);
  }
  fs.writeFileSync(target, text);
  return { path: target, backup };
}

/** Sets `theme = "<name>"` in config.toml, preserving the rest of the file. */
export function setActiveTheme(env, name) {
  const configPath = path.join(env.configDir, 'config.toml');
  let text = '';
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {}
  const line = `theme = ${JSON.stringify(name)}`;
  const lines = text.split('\n');
  const firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
  const topEnd = firstTable < 0 ? lines.length : firstTable;
  const idx = lines.slice(0, topEnd).findIndex((l) => /^\s*theme\s*=/.test(l));
  if (idx >= 0) lines[idx] = line;
  else lines.splice(0, 0, line);
  const next = lines.join('\n');
  parseThemeText(next, 'updated config.toml');
  fs.writeFileSync(configPath, next);
  return { path: configPath };
}
