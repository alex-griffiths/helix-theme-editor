<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '../lib/store.svelte';

  let { onPick, onClose }: { onPick: (name: string) => void; onClose: () => void } = $props();

  let query = $state('');
  let active = $state(0);
  let root: HTMLDivElement;
  let input: HTMLInputElement;

  const sourceOrder = { user: 0, builtin: 1, runtime: 2 } as const;
  const filtered = $derived(
    editor.themes
      .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => sourceOrder[a.source] - sourceOrder[b.source] || a.name.localeCompare(b.name)),
  );

  onMount(() => {
    input.focus();
    editor.refreshThemes();
    const onDoc = (e: MouseEvent) => {
      if (!root.contains(e.target as Node) && !(e.target as HTMLElement).closest('.base-btn')) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      active = Math.min(filtered.length - 1, active + 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(0, active - 1);
      e.preventDefault();
    } else if (e.key === 'Enter' && filtered[active]) onPick(filtered[active].name);
    else if (e.key === 'Escape') onClose();
  }

  $effect(() => {
    query;
    active = 0;
  });
  $effect(() => {
    root?.querySelector('.item.active')?.scrollIntoView({ block: 'nearest' });
  });
</script>

<div class="picker" bind:this={root}>
  <input bind:this={input} bind:value={query} onkeydown={onKey} placeholder="Search {editor.themes.length} themes…" type="search" />
  <div class="list">
    {#each filtered as t, i (t.name)}
      <button class="item" class:active={i === active} onmouseenter={() => (active = i)} onclick={() => onPick(t.name)}>
        <span class="mono">{t.name}</span>
        {#if t.name === editor.env?.activeTheme}<span class="tag active-tag">active</span>{/if}
        {#if t.inherits}<span class="inherits">↳ {t.inherits}</span>{/if}
        <span class="tag {t.source}">{t.source}</span>
      </button>
    {:else}
      <div class="empty">No themes match</div>
    {/each}
  </div>
</div>

<style>
  .picker {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 360px;
    background: var(--bg-2);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: 0 12px 40px #000a;
    z-index: 50;
    padding: 8px;
  }
  input {
    width: 100%;
  }
  .list {
    max-height: 60vh;
    overflow: auto;
    margin-top: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    border-radius: 4px;
    padding: 5px 8px;
  }
  .item.active {
    background: var(--bg-4);
  }
  .inherits {
    color: var(--text-3);
    font-size: 11.5px;
  }
  .tag {
    margin-left: auto;
    font-size: 10.5px;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--bg-4);
    color: var(--text-2);
  }
  .tag.user {
    background: var(--accent-bg);
    color: var(--accent-fg);
  }
  .tag.builtin {
    background: var(--bg-3);
    color: var(--text);
  }
  .active-tag {
    margin-left: 0;
    background: var(--warn-bg);
    color: var(--warn-fg);
  }
  .item .inherits + .tag,
  .item .mono + .tag {
    margin-left: auto;
  }
  .empty {
    padding: 10px;
    color: var(--text-3);
  }
</style>
