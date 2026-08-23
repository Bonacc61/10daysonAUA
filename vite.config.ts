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
  test: {
    // jsdom is opted into per FILE, not globally — see src/test/setup.ts. The
    // setup file itself is cheap enough to load everywhere.
    setupFiles: ['./src/test/setup.ts'],
    // Agent worktrees under .claude/ are complete repo copies. Vitest's default
    // include walks them, so a bare `npm test` collected a SECOND src/ and
    // reported ~1420 tests with ~63 failures — all of them the older copy's
    // components failing against its own stale source. That made the ship gate
    // read as broken while the real suite (952) was green, and it is how
    // .claude/CLAUDE.md came to claim the wrong test count. Excluded here so the
    // number `npm test` prints is the number that means something.
    // The Deno edge-function tests under supabase/functions/ are a mixed bag on
    // purpose: three of them (search/parse, viator-cards/normalize,
    // viator-cards/suitability) import from 'vitest' and belong to THIS suite.
    // contact-notify/messages.test.ts is the one real Deno-runtime test — it
    // calls Deno.test and imports from https://deno.land, which Node's ESM
    // loader refuses ("Only URLs with a scheme in: file and data"). That single
    // file failing to load is why `npm test` exited non-zero while all 1,159
    // in-scope tests passed, which made "the tests pass" meaningless as a gate.
    // Excluded here and run by `npm run test:deno` instead — it holds 5 tests,
    // one of them the HTML-escaping guard on contact form input.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/worktrees/**',
      'supabase/functions/contact-notify/messages.test.ts',
    ],
  },
});
