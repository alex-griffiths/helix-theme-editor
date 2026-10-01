<script lang="ts">
  import { tick } from 'svelte';
  import { layersCss } from '../lib/render';
  import { GROUP_LABELS, SCOPE_DESCRIPTIONS, SYNTAX_SCOPES, UI_SCOPES, scopeGroup, type ScopeGroup } from '../lib/scopes';
  import { editor } from '../lib/store.svelte';
  import { own, resolveKey, scopeChain } from '../lib/theme';
  import StyleEditor from './StyleEditor.svelte';

  type Filter = 'all' | 'set' | 'unset' | 'preview' | 'changed';

  let query = $state('');
  let filter = $state<Filter>('all');
  let documentedOnly = $state(false);
  let collapsed = $state<Record<string, boolean>>({});
  let listEl: HTMLDivElement;

  const documented = new Set([...SYNTAX_SCOPES, ...UI_SCOPES].map((s) => s.scope));

  const previewScopes = $derived(new Set(editor.highlight?.scopes ?? []));

  const allScopes = $derived.by(() => {
    const set = new Set<string>(documented);
    for (const s of Object.keys(editor.captures)) set.add(s);
    for (const s of Object.keys(editor.doc.styles)) set.add(s);
    // Make sure every parent of a scope is present so the tree is complete.
    for (const s of [...set]) for (const p of scopeChain(s)) set.add(p);
    return [...set].sort();
  });

  const paint = $derived({ fg: editor.view.terminalFg, bg: editor.view.terminalBg });

  function isChanged(s: string) {
    return JSON.stringify(own(editor.doc.styles, s) ?? null) !== JSON.stringify(own(editor.baseDoc?.styles, s) ?? null);
  }

  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const out: Record<ScopeGroup, string[]> = { syntax: [], markup: [], diff: [], ui: [], diagnostics: [] };
    for (const s of allScopes) {
      if (q && !s.toLowerCase().includes(q)) continue;
      if (documentedOnly && !documented.has(s) && !own(editor.doc.styles, s)) continue;
      const isSet = !!own(editor.doc.styles, s);
      if (filter === 'set' && !isSet) continue;
      if (filter === 'unset' && isSet) continue;
      if (filter === 'changed' && !isChanged(s)) continue;
      if (filter === 'preview' && ![...previewScopes].some((p) => p === s || p.startsWith(s + '.'))) continue;
      out[scopeGroup(s)].push(s);
    }
    return out;
  });

  function sampleCss(scope: string) {
    const layers = scopeGroup(scope) === 'ui' || scopeGroup(scope) === 'diagnostics' ? ['ui.background', scope] : ['ui.background', 'ui.text', scope];
    return layersCss(editor.doc, layers, 'normal', paint);
  }

  function select(scope: string) {
    editor.selected = editor.selected === scope ? null : scope;
  }

  // Scroll to a scope picked from the preview inspector.
  $effect(() => {
    const s = editor.selected;
    if (!s) return;
    if (collapsed[scopeGroup(s)]) collapsed[scopeGroup(s)] = false;
    tick().then(() => {
      const el = listEl?.querySelector(`[data-scope="${CSS.escape(s)}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });

  const counts = $derived({
    set: Object.keys(editor.doc.styles).length,
    changed: allScopes.filter(isChanged).length,
  });
</script>

<div class="bar">
  <input type="search" bind:value={query} placeholder="Filter scopes…" spellcheck="false" />
  <div class="filters">
    {#each [['all', 'All'], ['set', `Set · ${counts.set}`], ['unset', 'Unset'], ['preview', 'In preview'], ['changed', `Changed · ${counts.changed}`]] as [id, label]}
      <button class="chip" class:on={filter === id} onclick={() => (filter = id as Filter)}>{label}</button>
    {/each}
    <label class="doc-only" title="Hide scopes that only appear in individual language queries">
      <input type="checkbox" bind:checked={documentedOnly} /> documented only
    </label>
  </div>
</div>

<div class="list" bind:this={listEl}>
  {#each Object.entries(groups) as [group, scopes] (group)}
    {#if scopes.length}
      <button class="group" onclick={() => (collapsed[group] = !collapsed[group])}>
        <span class="tw">{collapsed[group] ? '▸' : '▾'}</span>
        {GROUP_LABELS[group as ScopeGroup]}
        <span class="faint">{scopes.length}</span>
      </button>
      {#if !collapsed[group]}
        {#each scopes as scope (scope)}
          {@const ownStyle = own(editor.doc.styles, scope)}
          {@const from = ownStyle ? scope : resolveKey(editor.doc, scope)}
          {@const langs = own(editor.captures, scope)}
          {@const depth = scope.split('.').length - 1}
          {@const leaf = scope.split('.').pop()}
          <div class="row-wrap" data-scope={scope}>
            <button
              class="row"
              class:selected={editor.selected === scope}
              class:changed={isChanged(scope)}
              class:undocumented={!documented.has(scope)}
              onclick={() => select(scope)}
              title={own(SCOPE_DESCRIPTIONS, scope) || (langs ? `Used by: ${langs.slice(0, 12).join(', ')}${langs.length > 12 ? '…' : ''}` : '')}
            >
              <span class="name mono" style:padding-left="{depth * 14}px">
                {#if depth}<span class="prefix">{scope.slice(0, scope.length - leaf!.length)}</span>{/if}<span class="leaf">{leaf}</span>
                {#if !documented.has(scope)}<span class="undoc" title="Not in Helix's documented scope list; used by specific language queries">·</span>{/if}
              </span>
              <span class="sample mono" style={from ? sampleCss(scope) : ''} class:none={!from}>{from ? 'Sample' : ''}</span>
              <span class="state" title={ownStyle ? 'Set in this theme' : from ? `Falls back to ${from}` : 'Not styled'}>
                {#if ownStyle}●{:else if from}<span class="from mono">↳ {from}</span>{:else}<span class="faint">–</span>{/if}
              </span>
            </button>
            {#if editor.selected === scope}
              <StyleEditor {scope} />
            {/if}
          </div>
        {/each}
      {/if}
    {/if}
  {/each}
</div>

<style>
  .bar {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-bottom: 1px solid var(--line);
  }
  .bar input[type='search'] {
    width: 100%;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .chip {
    font-size: 11.5px;
    padding: 2px 9px;
    border-radius: 12px;
    background: transparent;
  }
  .chip.on {
    background: var(--bg-4);
    border-color: var(--accent);
  }
  .doc-only {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .list {
    flex: 1;
    overflow: auto;
    padding-bottom: 40px;
  }
  .group {
    position: sticky;
    top: 0;
    z-index: 2;
    width: 100%;
    text-align: left;
    background: var(--bg-2);
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    padding: 7px 10px;
    font-weight: 600;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-2);
  }
  .tw {
    display: inline-block;
    width: 12px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto 110px;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 3px 10px 3px 12px;
    border-left: 2px solid transparent;
  }
  .row.undocumented .name {
    opacity: 0.65;
  }
  .row:hover {
    background: var(--bg-3);
  }
  .row.selected {
    background: var(--bg-3);
    border-left-color: var(--accent);
  }
  .row.changed {
    border-left-color: var(--warn);
  }
  .row.selected.changed {
    border-left-color: var(--accent);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .prefix {
    color: var(--text-3);
  }
  .undoc {
    color: var(--text-3);
    margin-left: 3px;
  }
  .sample {
    font-size: 12px;
    padding: 1px 8px;
    border-radius: 3px;
    min-width: 64px;
    text-align: center;
    border: 1px solid #ffffff10;
  }
  .sample.none {
    background: transparent;
  }
  .state {
    font-size: 11px;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .from {
    color: var(--text-3);
  }
</style>
