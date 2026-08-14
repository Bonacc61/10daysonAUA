/**
 * Builds and runs tools/probe-suitability.ts.
 *
 * Exists for the same reason as run-probe-start-times.cjs: the tool calls the
 * app's real loadCatalog(), which needs import.meta.env baked in at bundle time.
 *
 *   node tools/run-probe-suitability.cjs --limit 20    # a cheap first slice
 *   node tools/run-probe-suitability.cjs               # the whole catalog
 *
 * Needs a Viator PRODUCTION key — our product codes are real, so they do not
 * resolve against the sandbox host. Supply it either way:
 *
 *   export VIATOR_API_KEY=…                 # environment wins
 *   echo 'VIATOR_API_KEY=…' >> .env.local   # gitignored; NOT .env.production
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

// The Viator key is a SECRET, so it is handled differently from the two above:
// read from .env.local (gitignored) and passed through the child's ENVIRONMENT,
// never through esbuild --define. A --define would bake it into the bundle on
// disk. .env.production is tracked in git and must never hold this.
const secrets = (() => {
  try { return readFileSync(`${process.cwd()}/.env.local`, 'utf8'); }
  catch { return ''; }
})();
const readSecret = (k) => (secrets.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const childEnv = { ...process.env };
for (const k of ['VIATOR_API_KEY', 'VIATOR_API_KEY_PRODUCTION', 'VIATOR_BASE_URL']) {
  // A real environment variable wins over the file, so a one-off run can
  // override without editing anything.
  if (!childEnv[k] && readSecret(k)) childEnv[k] = readSecret(k);
}

const out = 'node_modules/.cache/probe-suitability.mjs';
execFileSync('node_modules/.bin/esbuild', [
  'tools/probe-suitability.ts', '--bundle', '--platform=node', '--format=esm',
  `--define:import.meta.env=${env}`, `--outfile=${out}`, '--log-level=warning',
], { stdio: 'inherit' });
// Exit with the child's own status instead of letting execFileSync throw. The
// probe prints actionable messages ("VIATOR_API_KEY is not set"); a Node stack
// trace on top of one buries the thing the reader needs.
try {
  execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit', env: childEnv });
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 1);
}
