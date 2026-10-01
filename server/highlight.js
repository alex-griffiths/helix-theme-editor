// Bridge to the Rust `hx-highlight` sidecar, which runs Helix's tree-house
// highlighter over the Helix runtime grammars and queries.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = process.env.HX_HIGHLIGHT_BIN || path.join(here, '../highlighter/target/release/hx-highlight');

export class Highlighter {
  constructor(env) {
    this.env = env;
    this.child = null;
    this.pending = [];
    this.queue = Promise.resolve();
  }

  available() {
    return fs.existsSync(BIN);
  }

  start() {
    if (!this.available()) {
      throw new Error(`highlighter binary missing at ${BIN}; run \`npm run build:highlighter\``);
    }
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const next = this.pending.shift();
      if (!next) return;
      try {
        next.resolve(JSON.parse(line));
      } catch (e) {
        next.reject(e);
      }
    });
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      for (const p of this.pending.splice(0)) p.reject(new Error('highlighter exited'));
    });
    const langs = this.env.languages.map(({ name, grammar, injection_regex, file_types, shebangs }) => ({
      name,
      grammar,
      injection_regex,
      file_types,
      shebangs,
    }));
    this.send({ cmd: 'init', runtime_dirs: this.env.runtimeDirs, languages: langs }).catch(() => {});
  }

  send(msg) {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.child.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  /** Requests are serialised: the sidecar answers one line per request, in order. */
  highlight(language, text) {
    const run = async () => {
      if (!this.child) this.start();
      return this.send({ cmd: 'highlight', language, text });
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}
