/**
 * Builds and runs tools/probe-start-times.ts.
 *
 * Exists for the same reason as run-enrich.cjs: the tool calls the app's real
 * loadCatalog(), which needs import.meta.env baked in at bundle time.
 *
 *   node tools/run-probe-start-times.cjs --limit 20    # a cheap first slice
 *   node tools/run-probe-start-times.cjs               # the whole catalog
 *   node tools/run-probe-start-times.cjs --cutoff 11:30
 *
 * Needs VIATOR_API_KEY (or VIATOR_API_KEY_PRODUCTION) in the environment.
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
  console.error('warning: no VITE_SUPABASE_ANON_KEY in ./.env.production — this would probe the offline stub. Run from the repo root.');
}

const out = 'node_modules/.cache/probe-start-times.mjs';
execFileSync('node_modules/.bin/esbuild', [
  'tools/probe-start-times.ts', '--bundle', '--platform=node', '--format=esm',
  `--define:import.meta.env=${env}`, `--outfile=${out}`, '--log-level=warning',
], { stdio: 'inherit' });
// Exit with the child's own status instead of letting execFileSync throw. The
// probe prints actionable messages ("VIATOR_API_KEY is not set"); a Node stack
// trace on top of one buries the thing the reader needs.
try {
  execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit' });
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 1);
}
