/**
 * Builds and runs tools/build-suitability.ts.
 *
 * Offline and free — no Viator key, no network, no import.meta.env. It exists
 * only because the tool imports a .ts module (the shared composer in
 * supabase/functions/viator-cards/suitability.ts) and node cannot load one.
 *
 *   node tools/run-build-suitability.cjs
 */
const { execFileSync } = require('node:child_process');

const out = 'node_modules/.cache/build-suitability.mjs';
execFileSync('node_modules/.bin/esbuild', [
  'tools/build-suitability.ts', '--bundle', '--platform=node', '--format=esm',
  `--outfile=${out}`, '--log-level=warning',
], { stdio: 'inherit' });
try {
  execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit' });
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 1);
}
