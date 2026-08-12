/**
 * Builds and runs tools/plan-diff.ts.
 *
 * Exists so the plan diff can call the app's real `loadCatalog()` — which needs
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
  console.error('warning: no VITE_SUPABASE_ANON_KEY in ./.env.production — plan-diff needs the LIVE catalog and will exit. Run from the repo root.');
}

const out = 'node_modules/.cache/plan-diff.mjs';
// Wrapped so a build failure does not dump the argv — which contains the
// --define blob. Both keys in it are public by contract today; this stops that
// from silently becoming a leak the day a non-public one joins them above.
try {
  execFileSync('node_modules/.bin/esbuild', [
    'tools/plan-diff.ts', '--bundle', '--platform=node', '--format=esm',
    `--define:import.meta.env=${env}`, `--outfile=${out}`, '--log-level=warning',
  ], { stdio: 'inherit' });
} catch {
  console.error('plan-diff: esbuild failed to bundle tools/plan-diff.ts (see output above).');
  process.exit(2);
}
// plan-diff exits non-zero on purpose: 1 when enrichment breaks a rule that
// held before, 2 on a bad argument, 3 when --ci is given with nothing to
// compare. execFileSync throws on any non-zero exit, which would bury the
// report under a Node stack trace, so catch it and propagate the code cleanly.
try {
  execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit' });
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 1);
}
