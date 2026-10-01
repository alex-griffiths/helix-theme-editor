<script lang="ts">
  import { onMount } from 'svelte';
  import CommitDialog from './components/CommitDialog.svelte';
  import PaletteEditor from './components/PaletteEditor.svelte';
  import Preview from './components/Preview.svelte';
  import ScopeList from './components/ScopeList.svelte';
  import TomlPanel from './components/TomlPanel.svelte';
  import TopBar from './components/TopBar.svelte';
  import { editor } from './lib/store.svelte';

  let tab = $state<'scopes' | 'palette' | 'toml'>('scopes');
  let committing = $state(false);
  let leftWidth = $state(460);
  let ready = $state(false);

  onMount(async () => {
    try {
      const w = Number(localStorage.getItem('hx-theme-editor:left'));
      if (w > 200) leftWidth = w;
    } catch {}
    await editor.init();
    ready = true;
  });

  // Drafts survive reloads; nothing touches disk until commit.
  $effect(() => {
    if (!ready) return;
    JSON.stringify(editor.doc);
    editor.baseline;
    const t = setTimeout(() => editor.persist(), 250);
    return () => clearTimeout(t);
  });
  $effect(() => {
    if (!ready) return;
    JSON.stringify(editor.view);
    editor.persistView();
  });

  // Jump to the scopes tab when a scope is picked from the preview.
  $effect(() => {
    if (editor.selected) tab = 'scopes';
  });

  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      editor.redo();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      committing = true;
    }
  }

  function onBeforeUnload(e: BeforeUnloadEvent) {
    editor.persist();
  }

  function startResize(e: PointerEvent) {
    const startX = e.clientX;
    const start = leftWidth;
    const move = (ev: PointerEvent) => (leftWidth = Math.min(900, Math.max(320, start + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem('hx-theme-editor:left', String(leftWidth));
      } catch {}
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

<svelte:window onkeydown={onKey} onbeforeunload={onBeforeUnload} />

<div class="app">
  <TopBar onCommit={() => (committing = true)} />

  {#if editor.loadError}
    <div class="banner error">{editor.loadError}</div>
  {:else if editor.env && !editor.env.highlighter}
    <div class="banner warn">
      Syntax highlighter binary not built — run <code>npm run build:highlighter</code> and restart. The preview will show plain text
      until then.
    </div>
  {/if}
  {#if editor.restoredDraft}
    <div class="banner info">
      Restored your uncommitted draft of <b>{editor.doc.name}</b>.
      <button class="ghost" onclick={() => (editor.restoredDraft = false)}>Dismiss</button>
    </div>
  {/if}

  <main style:grid-template-columns="{leftWidth}px 5px 1fr">
    <aside>
      <nav class="tabs">
        <button class:active={tab === 'scopes'} onclick={() => (tab = 'scopes')}>
          Scopes <span class="count">{Object.keys(editor.doc.styles).length}</span>
        </button>
        <button class:active={tab === 'palette'} onclick={() => (tab = 'palette')}>
          Palette <span class="count">{Object.keys(editor.doc.palette).length}</span>
        </button>
        <button class:active={tab === 'toml'} onclick={() => (tab = 'toml')}>TOML</button>
      </nav>
      <div class="panel">
        {#if tab === 'scopes'}
          <ScopeList />
        {:else if tab === 'palette'}
          <PaletteEditor />
        {:else}
          <TomlPanel />
        {/if}
      </div>
    </aside>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resizer" onpointerdown={startResize}></div>
    <section class="preview">
      <Preview />
    </section>
  </main>
</div>

{#if committing}
  <CommitDialog onClose={() => (committing = false)} />
{/if}

{#if editor.toast}
  <div class="toast {editor.toast.kind}">{editor.toast.text}</div>
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  main {
    flex: 1;
    display: grid;
    min-height: 0;
  }
  aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-2);
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 8px 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    border: none;
    border-radius: var(--radius) var(--radius) 0 0;
    background: transparent;
    color: var(--text-2);
    padding: 7px 14px;
    border-bottom: 2px solid transparent;
  }
  .tabs button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
    background: var(--bg-3);
  }
  .count {
    font-size: 11px;
    color: var(--text-3);
    margin-left: 4px;
  }
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .resizer {
    cursor: col-resize;
    background: var(--line);
  }
  .resizer:hover {
    background: var(--accent-2);
  }
  .preview {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .banner {
    padding: 6px 14px;
    font-size: 12.5px;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .banner.error {
    background: var(--err-bg);
    color: var(--err-fg);
  }
  .banner.warn {
    background: var(--warn-bg);
    color: var(--warn-fg);
  }
  .banner.info {
    background: var(--accent-bg);
    color: var(--accent-fg);
  }
  .banner code {
    font-family: var(--mono);
  }
  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    border-radius: var(--radius);
    background: var(--bg-4);
    border: 1px solid var(--line-2);
    box-shadow: 0 8px 30px #0008;
    z-index: 100;
    max-width: 70vw;
  }
  .toast.ok {
    border-color: var(--ok-border);
  }
  .toast.error {
    border-color: var(--err);
    color: var(--err-fg);
  }
</style>
