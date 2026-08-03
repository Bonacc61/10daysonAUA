/**
 * Builds and runs tools/resolve-coords.ts.
 *
 * Exists so the trace can call the app's real `loadCatalog()` — which needs
 * import.meta.env baked in at bundle time, and that is unreadable as a one-line
 * npm script. Going through loadCatalog matters: the raw edge-function payload
 * is 362 items, the app's catalog is 334, and only loadCatalog applies the
 * transport filter, regroupItems and normalizePopularity. A trace against the
 * raw payload ranks differently from the app it is supposed to explain.
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
  console.error('warning: no VITE_SUPABASE_ANON_KEY in ./.env.production — the trace will fall back to the offline stub. Run from the repo root.');
}

const out = 'node_modules/.cache/resolve-coords.mjs';
execFileSync('node_modules/.bin/esbuild', [
  'tools/resolve-coords.ts', '--bundle', '--platform=node', '--format=esm',
  `--define:import.meta.env=${env}`, `--outfile=${out}`, '--log-level=warning',
], { stdio: 'inherit' });
execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit' });
