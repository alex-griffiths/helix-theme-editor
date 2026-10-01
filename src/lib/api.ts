// Client for the local server API (see server/api.js).

export interface EnvInfo {
  hx: string | null;
  version: string | null;
  configDir: string;
  userThemeDir: string;
  runtimeDirs: string[];
  builtinSource: Record<string, string>;
  highlighter: boolean;
  activeTheme: string | null;
  /** The [editor] table from the user's config.toml. */
  editor: Record<string, any>;
}

export interface ThemeInfo {
  name: string;
  source: 'builtin' | 'user' | 'runtime';
  path: string | null;
  writable: boolean;
  inherits?: string | null;
  shadowed: string[];
}

export interface ThemeData {
  name: string;
  source: ThemeInfo['source'];
  path: string | null;
  chain: { name: string; source: string; path: string | null }[];
  raw: string;
  palette: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export interface HighlightResult {
  ok: boolean;
  error?: string;
  language: string | null;
  scopes: string[];
  spans: [number, number, number[]][];
  warnings?: string[];
}

export interface Language {
  name: string;
  fileTypes: string[];
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  return body as T;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  env: () => req<EnvInfo>('/api/env'),
  themes: () => req<ThemeInfo[]>('/api/themes'),
  theme: (name: string) => req<ThemeData>(`/api/theme?name=${encodeURIComponent(name)}`),
  saveTheme: (body: { name: string; toml: string; overwrite: boolean; activate: boolean }) =>
    req<{ path: string; backup: string | null; config?: { path: string } }>('/api/theme', post(body)),
  scopes: () => req<Record<string, string[]>>('/api/scopes'),
  languages: () => req<Language[]>('/api/languages'),
  file: (path: string) =>
    req<{ path: string; name: string; text: string; language: string | null }>(`/api/file?path=${encodeURIComponent(path)}`),
  detect: (name: string, text: string) => req<{ language: string | null }>('/api/detect', post({ name, text })),
  highlight: (body: { language?: string | null; name?: string; text: string }) =>
    req<HighlightResult>('/api/highlight', post(body)),
};
