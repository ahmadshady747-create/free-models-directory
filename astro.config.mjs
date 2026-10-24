import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// AI-model API directory: static output only, no server, no proxy,
// no user accounts, no API keys. Local build only; do not deploy
// until the full verified dataset and daily-update process are ready.
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
