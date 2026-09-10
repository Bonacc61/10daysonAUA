/**
 * Builds and runs tools/build-seo-catalog.ts.
 *
 * Exists for the same reason as run-drift.cjs: the script calls the app's real
 * loadCatalog(), which needs import.meta.env baked in at bundle time.
 */
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const raw = (() => {
  try { return readFileSync(`${process.cwd()}/.env.production`, 'utf8'); }
  catch { return ''; }
})();
const read = (k) => (raw.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const env = JSON.stringify({
  VITE_VIATOR_FN_URL: read('VITE_VIATOR_FN_URL'),
  VITE_SUPABASE_ANON_KEY: read('VITE_SUPABASE_ANON_KEY'),
});
if (!read('VITE_SUPABASE_ANON_KEY')) {
  console.error('error: no VITE_SUPABASE_ANON_KEY in ./.env.production — refusing to snapshot the offline stub as if it were the catalog. Run from the repo root.');
  process.exit(1);
}

const out = 'node_modules/.cache/build-seo-catalog.mjs';
execFileSync('node_modules/.bin/esbuild', [
  'tools/build-seo-catalog.ts', '--bundle', '--platform=node', '--format=esm',
  `--define:import.meta.env=${env}`, `--outfile=${out}`, '--log-level=warning',
], { stdio: 'inherit' });
execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit' });
