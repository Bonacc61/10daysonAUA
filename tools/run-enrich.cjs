/**
 * Builds and runs tools/enrich-catalog.ts.
 *
 * Exists for the same reason as run-trace.cjs: the tool calls the app's real
 * loadCatalog(), which needs import.meta.env baked in at bundle time.
 *
 *   node tools/run-enrich.cjs --dry-run      # what would be sent, no API calls
 *   node tools/run-enrich.cjs --limit 20     # a cheap first slice
 *   node tools/run-enrich.cjs                # everything not yet enriched
 *   node tools/run-enrich.cjs --force        # re-ask for every product
 *
 * Needs ANTHROPIC_API_KEY in the environment (except --dry-run).
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
  console.error('warning: no VITE_SUPABASE_ANON_KEY in ./.env.production — this would enrich the offline stub. Run from the repo root.');
}

const out = 'node_modules/.cache/enrich-catalog.mjs';
execFileSync('node_modules/.bin/esbuild', [
  'tools/enrich-catalog.ts', '--bundle', '--platform=node', '--format=esm',
  `--define:import.meta.env=${env}`, `--outfile=${out}`, '--log-level=warning',
], { stdio: 'inherit' });
execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit' });
