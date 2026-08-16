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

// The API key comes from .env.local (gitignored) and is passed through the
// child's ENVIRONMENT, never through esbuild --define — a --define would bake it
// into the bundle on disk. Same handling as run-probe-suitability.cjs and
// friends; this runner was the one probe in tools/ that did not do it, so the
// key sat in the file and the tool reported it missing.
const secrets = (() => {
  try { return readFileSync(`${process.cwd()}/.env.local`, 'utf8'); }
  catch { return ''; }
})();
const secret = (k) => (secrets.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const out = 'node_modules/.cache/enrich-catalog.mjs';
execFileSync('node_modules/.bin/esbuild', [
  'tools/enrich-catalog.ts', '--bundle', '--platform=node', '--format=esm',
  `--define:import.meta.env=${env}`, `--outfile=${out}`, '--log-level=warning',
], { stdio: 'inherit' });
execFileSync('node', [out, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || secret('ANTHROPIC_API_KEY'),
  },
});
