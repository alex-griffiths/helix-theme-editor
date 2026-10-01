import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
// @ts-ignore - plain JS server module
import { createApi } from './server/api.js';

function helixApi(): Plugin {
  const api = createApi();
  return {
    name: 'helix-api',
    configureServer(server) {
      server.middlewares.use(api);
    },
    configurePreviewServer(server) {
      server.middlewares.use(api);
    },
  };
}

export default defineConfig({
  plugins: [svelte(), helixApi()],
  server: { host: '127.0.0.1', port: 4177 },
  preview: { host: '127.0.0.1', port: 4178 },
});
