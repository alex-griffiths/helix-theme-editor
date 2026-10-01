// HTTP API used by the web app. Exposed as connect-style middleware so it can be
// mounted in the Vite dev server as well as the standalone production server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { getHelixEnv } from './helix.js';
import { Highlighter } from './highlight.js';
import { collectCaptures } from './scopes.js';
import { HttpError, listThemes, readTheme, saveTheme, setActiveTheme } from './themes.js';

const MAX_BODY = 10 * 1024 * 1024;
const MAX_SOURCE_FILE = 2 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function expandHome(p) {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function createApi() {
  let highlighter = null;

  const routes = {
    'GET /api/env': async (env) => ({
      hx: env.hx,
      version: env.version,
      configDir: env.configDir,
      userThemeDir: env.userThemeDir,
      runtimeDirs: env.runtimeDirs,
      builtinSource: env.builtinSource,
      highlighter: (highlighter ??= new Highlighter(env)).available(),
      activeTheme: activeTheme(env),
      editor: editorConfig(env),
    }),
    'GET /api/themes': async (env) => listThemes(env),
    'GET /api/theme': async (env, { query }) => readTheme(env, query.get('name') || ''),
    'POST /api/theme': async (env, { body }) => {
      const result = saveTheme(env, body.name, body.toml, { overwrite: !!body.overwrite });
      if (body.activate) result.config = setActiveTheme(env, body.name);
      return result;
    },
    'GET /api/scopes': async (env) => collectCaptures(env),
    'GET /api/languages': async (env) =>
      env.languages.map((l) => ({ name: l.name, fileTypes: l.file_types })).sort((a, b) => a.name.localeCompare(b.name)),
    'GET /api/file': async (env, { query }) => {
      const p = path.resolve(expandHome(query.get('path') || ''));
      let stat;
      try {
        stat = fs.statSync(p);
      } catch {
        throw new HttpError(404, `No such file: ${p}`);
      }
      if (!stat.isFile()) throw new HttpError(400, `Not a file: ${p}`);
      if (stat.size > MAX_SOURCE_FILE) throw new HttpError(413, `File is larger than 2 MB: ${p}`);
      const text = fs.readFileSync(p, 'utf8');
      return { path: p, name: path.basename(p), text, language: detectLanguage(env, p, text) };
    },
    'POST /api/detect': async (env, { body }) => ({ language: detectLanguage(env, body.name || '', body.text || '') }),
    'POST /api/highlight': async (env, { body }) => {
      const text = String(body.text ?? '').replace(/\r\n?/g, '\n');
      const language = body.language || detectLanguage(env, body.name || '', text);
      if (!language) return { ok: true, language: null, scopes: [], spans: [], warnings: ['Unknown language; showing plain text'] };
      highlighter ??= new Highlighter(env);
      const result = await highlighter.highlight(language, text);
      return { ...result, language };
    },
  };

  return async function api(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next?.();
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'Not found' });
    try {
      const env = await getHelixEnv();
      const body = req.method === 'POST' ? await readBody(req) : {};
      send(res, 200, await handler(env, { query: url.searchParams, body }));
    } catch (e) {
      send(res, e.status || 500, { error: e.message || String(e) });
    }
  };
}

function detectLanguage(env, name, text) {
  return (name && env.languageForFile(name)) || (text.startsWith('#!') && env.languageForShebang(text)) || null;
}

function editorConfig(env) {
  try {
    return parseToml(fs.readFileSync(path.join(env.configDir, 'config.toml'), 'utf8')).editor ?? {};
  } catch {
    return {};
  }
}

function activeTheme(env) {
  try {
    const cfg = fs.readFileSync(path.join(env.configDir, 'config.toml'), 'utf8');
    const top = cfg.split(/^\s*\[/m)[0];
    return /^\s*theme\s*=\s*["']([^"']+)["']/m.exec(top)?.[1] ?? null;
  } catch {
    return null;
  }
}
