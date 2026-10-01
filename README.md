# Helix Theme Editor

A local web app for tweaking [Helix](https://helix-editor.com) themes with a live, Helix-accurate preview.

- Load any theme Helix can see: the built-in `default`/`base16_default`, the runtime themes, and your
  own themes in `~/.config/helix/themes`. `inherits` chains are resolved exactly like Helix does.
- Edit every scope (all documented syntax and UI scopes, plus every capture used by the installed
  tree-sitter queries), the palette, or the raw TOML. Undo/redo with Ctrl+Z / Ctrl+Shift+Z.
- Changes stay in the browser (and are kept as a draft in localStorage) until you **Commit**, which
  writes `~/.config/helix/themes/<name>.toml`, either standalone or as `inherits = "<base>"` plus only
  your changes. You can also set it as the active theme in `config.toml`.
- The preview is highlighted by Helix's own highlighter ([tree-house](https://github.com/helix-editor/tree-house))
  using the grammars and queries from your Helix runtime, so the scopes match what Helix produces. Load
  your own code with **Open file…**, a path, drag and drop, or paste it with **Edit text**.
- The preview draws the editor chrome too: gutter, diagnostics, diff signs, cursors/selections per
  mode, cursorline/column, indent guides, whitespace, rulers, inlay hints, soft wrap, jump labels,
  bufferline, statuslines (split view for inactive), completion/hover/info/command popups and a picker.
  Its initial options come from your `config.toml`.
- Hover code to see its scope stack and which theme key styles it; double-click to jump to that scope.

## Requirements

- Node.js 20+ (the repo's `mise.toml` pins Node 24)
- A Rust toolchain (to build the highlighter sidecar)
- Helix installed, with grammars built (`hx --grammar fetch && hx --grammar build` if you build from source)

## Usage

```sh
npm run setup      # npm install + build the Rust highlighter
npm run dev        # http://127.0.0.1:4177
```

Or build once and serve:

```sh
npm run build
npm start          # http://127.0.0.1:4178  (PORT=... to change)
```

The server binds to 127.0.0.1 only: its API reads files you ask it to preview and writes theme files.

## How it works

| Part | What it does |
| --- | --- |
| `server/helix.js` | Finds `hx`, reads config/runtime dirs from `hx --health`, extracts the compiled-in `default` theme, `base16_default` theme and `languages.toml` from the hx binary (snapshots in `server/builtin/` are the fallback; refresh with `npm run snapshot-builtins`). |
| `server/themes.js` | Lists themes in Helix's search order, resolves `inherits` (including a user theme inheriting a same-named runtime theme), saves themes (keeping `<name>.toml.bak` when overwriting). |
| `server/scopes.js` | Collects every capture name used by the installed `highlights.scm`/`locals.scm` queries. |
| `highlighter/` | Rust sidecar using `tree-house` 0.3 (the version Helix 25.07 uses) that loads Helix's grammar `.so` files and queries, handles injections and locals, and returns scope spans. |
| `src/lib/theme.ts` | Theme model with Helix semantics: palette lookup, scope fallback (`a.b.c` → `a.b` → `a`), style patching, TOML output. |
| `src/lib/render.ts` | Builds the editor view model. Each run of text is described by the ordered scopes Helix would patch onto it; theme changes only regenerate a stylesheet. |

## Notes

- In inherit mode, removing a scope that the base theme sets is written as `"scope" = {}`. An empty
  style stops fallback to the parent scope, so it isn't identical to the key never existing.
- Scopes marked with `·` in the list aren't in Helix's documented scope list; they come from individual
  language queries.
- Terminal colour names (`red`, `light-blue`, …) and unset foreground/background are rendered with
  approximate terminal defaults; adjust the defaults under **View options → Terminal**.
