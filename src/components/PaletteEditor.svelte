<script lang="ts">
  import { editor } from '../lib/store.svelte';
  import { paletteUsage, renamePaletteRefs, resolveColor } from '../lib/theme';

  let query = $state('');
  let sort = $state<'file' | 'name' | 'hue' | 'usage'>('file');
  let renaming = $state<Record<string, string>>({});

  function hue(hex: string | undefined) {
    if (!hex) return 999;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d < 0.08) return 400 + max * 100; // greys last, dark to light
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }

  const entries = $derived.by(() => {
    const list = Object.entries(editor.doc.palette)
      .filter(([k, v]) => !query || k.includes(query) || v.toLowerCase().includes(query.toLowerCase()))
      .map(([name, value]) => ({ name, value, css: resolveColor(editor.doc, value), used: paletteUsage(editor.doc, name) }));
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'hue') list.sort((a, b) => hue(a.css) - hue(b.css));
    if (sort === 'usage') list.sort((a, b) => b.used.length - a.used.length);
    return list;
  });

  function setValue(name: string, value: string, key = `palette:${name}`) {
    editor.edit((d) => (d.palette[name] = value), key);
  }

  function rename(from: string) {
    const to = (renaming[from] ?? from).trim();
    delete renaming[from];
    if (!to || to === from) return;
    if (Object.hasOwn(editor.doc.palette, to)) {
      editor.notify('error', `Palette already has '${to}'`);
      return;
    }
    editor.edit((d) => {
      // Rebuild to keep the entry's position.
      d.palette = Object.fromEntries(Object.entries(d.palette).map(([k, v]) => [k === from ? to : k, v]));
      renamePaletteRefs(d, from, to);
    });
  }

  function remove(name: string) {
    const used = paletteUsage(editor.doc, name);
    if (used.length && !confirm(`'${name}' is used by ${used.length} scope(s). Replace those references with its colour value and delete?`)) return;
    editor.edit((d) => {
      const value = d.palette[name];
      renamePaletteRefs(d, name, value);
      delete d.palette[name];
    });
  }

  function add() {
    let i = 1;
    while (Object.hasOwn(editor.doc.palette, `color${i}`)) i++;
    const name = `color${i}`;
    editor.edit((d) => (d.palette[name] = '#888888'));
    renaming[name] = name;
  }

  function showUsage(name: string) {
    const used = paletteUsage(editor.doc, name);
    if (used.length) editor.selected = used[0];
  }
</script>

<div class="bar">
  <input type="search" bind:value={query} placeholder="Filter palette…" spellcheck="false" />
  <select bind:value={sort} title="Sort order">
    <option value="file">File order</option>
    <option value="name">Name</option>
    <option value="hue">Hue</option>
    <option value="usage">Usage</option>
  </select>
  <button onclick={add}>+ Add</button>
</div>
<p class="hint">Palette colours are referenced by name from scopes; changing one updates every scope that uses it.</p>

<div class="list">
  {#each entries as e (e.name)}
    <div class="entry">
      {#if e.css}
        <input type="color" value={e.css} oninput={(ev) => setValue(e.name, (ev.currentTarget as HTMLInputElement).value)} />
      {:else}
        <span class="swatch checker" title="Not a hex colour"></span>
      {/if}
      <input
        class="mono name"
        value={renaming[e.name] ?? e.name}
        oninput={(ev) => (renaming[e.name] = (ev.currentTarget as HTMLInputElement).value)}
        onblur={() => rename(e.name)}
        onkeydown={(ev) => ev.key === 'Enter' && (ev.currentTarget as HTMLInputElement).blur()}
        spellcheck="false"
      />
      <input
        class="mono value"
        value={e.value}
        onchange={(ev) => setValue(e.name, (ev.currentTarget as HTMLInputElement).value.trim(), `palette-text:${Date.now()}`)}
        spellcheck="false"
      />
      <button class="ghost usage" disabled={!e.used.length} onclick={() => showUsage(e.name)} title={e.used.join('\n')}>
        {e.used.length} use{e.used.length === 1 ? '' : 's'}
      </button>
      <button class="ghost danger" onclick={() => remove(e.name)} title="Delete">✕</button>
    </div>
  {:else}
    <div class="empty">No palette entries. Themes can use hex colours directly, or define named colours here.</div>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    gap: 6px;
    padding: 10px;
    border-bottom: 1px solid var(--line);
  }
  .bar input {
    flex: 1;
  }
  .hint {
    margin: 8px 12px 4px;
    font-size: 12px;
    color: var(--text-3);
  }
  .list {
    flex: 1;
    overflow: auto;
    padding: 4px 10px 40px;
  }
  .entry {
    display: grid;
    grid-template-columns: 30px 1fr 96px 64px 28px;
    gap: 6px;
    align-items: center;
    padding: 3px 0;
  }
  .swatch {
    width: 28px;
    height: 22px;
    border-radius: 4px;
  }
  .name,
  .value {
    min-width: 0;
    font-size: 12px;
  }
  .usage {
    font-size: 11.5px;
    padding: 2px 4px;
    color: var(--text-2);
  }
  .empty {
    color: var(--text-3);
    padding: 16px 4px;
  }
</style>
