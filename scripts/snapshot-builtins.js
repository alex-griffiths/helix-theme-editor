// Refreshes the fallback copies of Helix's compiled-in files (default theme,
// base16_default theme, languages.toml) from the installed hx binary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFromBinary, getHelixEnv } from '../server/helix.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/builtin');
const env = await getHelixEnv();
if (!env.hx) throw new Error('hx not found on PATH');
const files = extractFromBinary(env.hx);
fs.mkdirSync(out, { recursive: true });
for (const [key, text] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, `${key}.toml`), text);
  console.log(`${key}.toml: ${text.length} bytes`);
}
console.log(`from ${env.version}`);
