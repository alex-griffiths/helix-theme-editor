<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '../lib/store.svelte';
  import { ANSI_COLORS, resolveColor } from '../lib/theme';

  let {
    value,
    onChange,
    label,
    editKey,
    inherited = false,
  }: {
    value: string | undefined;
    onChange: (v: string | undefined, key?: string) => void;
    label: string;
    editKey: string;
    /** Value comes from a fallback scope rather than being set here. */
    inherited?: boolean;
  } = $props();

  let open = $state(false);
  let root: HTMLDivElement;
  let hexDraft = $state('');

  const resolved = $derived(resolveColor(editor.doc, value));
  const isPalette = $derived(!!value && Object.hasOwn(editor.doc.palette, value));
  const invalid = $derived(!!value && value !== 'reset' && !resolved);

  $effect(() => {
    hexDraft = value ?? '';
  });

  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      if (open && !root.contains(e.target as Node)) open = false;
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  });

  function commitDraft() {
    const v = hexDraft.trim();
    if (v === (value ?? '')) return;
    onChange(v || undefined);
  }

  function setPaletteEntry(hex: string) {
    const name = value!;
    editor.edit((d) => (d.palette[name] = hex), `palette:${name}`);
  }
</script>

<div class="field" bind:this={root}>
  <span class="label">{label}</span>
  <button class="swatch-btn" class:inherited class:invalid onclick={() => (open = !open)} title={invalid ? `Unknown colour '${value}'` : value}>
    <span class="swatch" class:checker={!resolved} style:background={resolved}></span>
    <span class="val mono">
      {#if value}
        {value}{#if isPalette}<span class="faint"> · {resolved}</span>{/if}
      {:else}
        <span class="faint">none</span>
      {/if}
    </span>
  </button>

  {#if open}
    <div class="pop">
      <div class="row">
        <input
          type="color"
          value={resolved ?? '#888888'}
          oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value, `color:${editKey}`)}
          title="Pick a custom colour (detaches from the palette)"
        />
        <input
          class="mono hex"
          bind:value={hexDraft}
          onkeydown={(e) => e.key === 'Enter' && commitDraft()}
          onblur={commitDraft}
          placeholder="#rrggbb or palette name"
          spellcheck="false"
        />
        <button class="ghost" onclick={() => (onChange(undefined), (open = false))}>None</button>
      </div>

      {#if isPalette}
        <div class="row palette-edit">
          <input
            type="color"
            value={resolved ?? '#888888'}
            oninput={(e) => setPaletteEntry((e.currentTarget as HTMLInputElement).value)}
          />
          <span>Edit palette <b class="mono">{value}</b> <span class="faint">(affects every scope using it)</span></span>
        </div>
      {/if}

      {#if Object.keys(editor.doc.palette).length}
        <div class="section">Palette</div>
        <div class="grid">
          {#each Object.entries(editor.doc.palette) as [name, v] (name)}
            <button
              class="chip"
              class:selected={name === value}
              style:background={resolveColor(editor.doc, v)}
              title="{name} = {v}"
              onclick={() => (onChange(name), (open = false))}
            ></button>
          {/each}
        </div>
      {/if}

      <div class="section">Terminal colours</div>
      <div class="grid">
        {#each Object.entries(ANSI_COLORS) as [name, css] (name)}
          <button
            class="chip"
            class:selected={name === value}
            style:background={resolveColor(editor.doc, name) ?? css}
            title={name}
            onclick={() => (onChange(name), (open = false))}
          ></button>
        {/each}
        <button class="chip reset checker" class:selected={value === 'reset'} title="reset (terminal default)" onclick={() => (onChange('reset'), (open = false))}></button>
      </div>
    </div>
  {/if}
</div>

<style>
  .field {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .label {
    width: 62px;
    color: var(--text-2);
    font-size: 12px;
    flex: none;
  }
  .swatch-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    background: var(--bg);
    padding: 3px 8px 3px 4px;
    text-align: left;
  }
  .swatch-btn.inherited {
    border-style: dashed;
    opacity: 0.75;
  }
  .swatch-btn.invalid {
    border-color: var(--err);
  }
  .swatch {
    width: 20px;
    height: 16px;
    border-radius: 3px;
    border: 1px solid #fff2;
    flex: none;
  }
  .val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 70px;
    right: 0;
    min-width: 270px;
    z-index: 40;
    background: var(--bg-2);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: 0 12px 40px #000a;
    padding: 10px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hex {
    flex: 1;
    min-width: 0;
  }
  .palette-edit {
    margin-top: 8px;
    font-size: 12px;
  }
  .section {
    margin: 10px 0 5px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-3);
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    width: 20px;
    height: 20px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid #fff2;
  }
  .chip.selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
