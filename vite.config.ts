import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Short build id baked into the bundle. GitHub Actions exposes GITHUB_SHA on
// every step, so production builds stamp the real commit; local builds say 'dev'.
const BUILD = (process.env.GITHUB_SHA || 'dev').slice(0, 7);

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD__: JSON.stringify(BUILD),
  },
  server: {
    allowedHosts: true,
  },
});
