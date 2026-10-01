// Production server: serves the built app from dist/ plus the API.
// Binds to localhost only, since the API can read and write local files.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT || 4178);
const host = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('dist/ not found; run `npm run build` first');
  process.exit(1);
}

const api = createApi();

http
  .createServer((req, res) => {
    api(req, res, () => {
      const url = new URL(req.url, 'http://localhost');
      let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(root, 'index.html');
      }
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
  })
  .listen(port, host, () => console.log(`Helix theme editor: http://${host}:${port}`));
