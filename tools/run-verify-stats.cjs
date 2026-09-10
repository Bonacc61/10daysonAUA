/**
 * Executes the /stats reporting migrations against a real PostgreSQL and
 * asserts the numbers they return.
 *
 * WHAT IT NEEDS, AND IT IS NOT FREE: a local PostgreSQL SERVER installation —
 * `initdb`, `pg_ctl` and `psql`, version 14 or newer. On Debian/Ubuntu that is
 * `apt-get install postgresql` (the `postgresql-client` package alone is NOT
 * enough: it has psql but no initdb). No docker, no network, no Supabase
 * project, no credentials. If the binaries are missing this script says so and
 * exits 2 — it never falls back to a remote database, because the fixtures
 * below start by truncating web_events.
 *
 * WHY IT EXISTS: five stats migrations shipped without ever being executed,
 * because "there is no Postgres here" was assumed rather than checked. There
 * is one, and a wrong figure on /stats drives an expand-or-cut decision on the
 * generated content pages. Reading the SQL is not verification.
 *
 * WHAT IT DOES: initdb's a throwaway cluster in a temp directory on a unix
 * socket with NO TCP listener, applies supabase/migrations/*_web_events.sql
 * plus every *stats*.sql in filename order, runs tools/verify-stats-sql.sql,
 * prints the PASS/FAIL table, and removes the cluster. Exits 1 if any
 * assertion failed or any migration failed to apply.
 *
 *   node tools/run-verify-stats.cjs          # from the repo root
 *   node tools/run-verify-stats.cjs --keep   # leave the cluster up to poke at
 *
 * TWO THINGS IT FAKES, both named out loud:
 *   - `create extension if not exists pg_cron` is stripped, and a no-op
 *     cron.schedule/cron.unschedule stub is installed in its place. pg_cron is
 *     a Supabase-managed extension that is not in a stock apt install, and no
 *     stats function reads a cron job.
 *   - the roles anon / authenticated / service_role are created as bare
 *     NOLOGIN roles, because the revoke/grant lines at the foot of every stats
 *     migration name them. That is enough for A27/A28 to check the grants.
 * Everything else is the migration files unmodified, byte for byte.
 */
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, chmodSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const KEEP = process.argv.includes('--keep');
const REPO = process.cwd();
const MIGRATIONS = join(REPO, 'supabase', 'migrations');

if (!existsSync(MIGRATIONS)) {
  console.error(`no ${MIGRATIONS} — run this from the repo root.`);
  process.exit(2);
}

// --- find a postgres server installation ------------------------------------
function findBinDir() {
  try {
    const d = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    if (existsSync(join(d, 'initdb'))) return d;
  } catch { /* pg_config absent, try the Debian layout */ }
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    const versions = readdirSync(base)
      .filter((v) => /^\d+$/.test(v))
      .sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      if (existsSync(join(base, v, 'bin', 'initdb'))) return join(base, v, 'bin');
    }
  }
  return null;
}
const BIN = findBinDir();
if (!BIN) {
  console.error('No PostgreSQL server binaries found (looked for pg_config --bindir and /usr/lib/postgresql/*/bin/initdb).');
  console.error('Install one: sudo apt-get install postgresql   (postgresql-client is not enough — it has no initdb)');
  process.exit(2);
}

// initdb and psql refuse to run as root, so as root we do everything through
// `su postgres`. That is also why the cluster lives under /tmp: the postgres
// user has to be able to read the scratch files we hand psql.
const AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const PGUSER = 'postgres';
const ROOT_TMP = AS_ROOT ? '/tmp' : tmpdir();
const DIR = mkdtempSync(join(ROOT_TMP, 'stats-verify-'));
const DATA = join(DIR, 'data');
const SOCK = join(DIR, 'sock');
const PORT = 5000 + (process.pid % 2000);
const DB = 'statsverify';

function sh(cmd, opts = {}) {
  const full = AS_ROOT ? ['su', [PGUSER, '-c', cmd]] : ['bash', ['-c', cmd]];
  return execFileSync(full[0], full[1], { encoding: 'utf8', ...opts });
}
function psql(args, opts = {}) {
  return sh(`${join(BIN, 'psql')} -h ${SOCK} -p ${PORT} -U ${PGUSER} -d ${DB} ${args}`, opts);
}
// A scratch file psql will be told to read, so it has to be world-readable.
function scratch(name, body) {
  const p = join(DIR, name);
  writeFileSync(p, body);
  chmodSync(p, 0o644);
  return p;
}

let started = false;
function stop() {
  if (started && !KEEP) {
    try { sh(`${join(BIN, 'pg_ctl')} -D ${DATA} -m immediate -w stop`, { stdio: 'ignore' }); } catch { /* already down */ }
  }
  if (!KEEP) rmSync(DIR, { recursive: true, force: true });
}
process.on('exit', stop);

try {
  execFileSync('mkdir', ['-p', DATA, SOCK]);
  // initdb chmods its own data directory, which it can only do if it owns it.
  if (AS_ROOT) execFileSync('chown', ['-R', PGUSER, DIR]);

  console.log(`postgres:  ${BIN}`);
  console.log(`cluster:   ${DATA} (socket ${SOCK}, port ${PORT}, no TCP listener)\n`);

  sh(`${join(BIN, 'initdb')} -D ${DATA} -A trust -U ${PGUSER} -E UTF8 --locale=C`, { stdio: 'ignore' });
  // -h '' is the whole safety story: the cluster answers on a unix socket in a
  // temp directory and nothing else. It cannot be reached from off the box.
  sh(`${join(BIN, 'pg_ctl')} -D ${DATA} -w -o "-k ${SOCK} -h '' -p ${PORT}" -l ${join(DIR, 'log')} start`, { stdio: 'ignore' });
  started = true;
  sh(`${join(BIN, 'psql')} -h ${SOCK} -p ${PORT} -U ${PGUSER} -d postgres -q -c "create database ${DB}"`);

  const preamble = scratch('00_preamble.sql', [
    "-- The three Supabase roles the revoke/grant lines at the foot of every",
    "-- stats migration name. Bare NOLOGIN roles: enough to check the grants.",
    "create role anon nologin;",
    "create role authenticated nologin;",
    "create role service_role nologin;",
    "-- A no-op stand-in for the Supabase-managed pg_cron. Nothing in the stats",
    "-- functions reads a cron job; this only lets the DDL that schedules the",
    "-- retention purge run without the extension being installed.",
    "create schema cron;",
    "create function cron.schedule(text, text, text) returns bigint",
    "  language sql as $$ select 1::bigint $$;",
    "create function cron.unschedule(text) returns boolean",
    "  language sql as $$ select true $$;",
    '',
  ].join('\n'));
  psql(`-q -v ON_ERROR_STOP=1 -f ${preamble}`);

  const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const wanted = all.filter((f) => f.includes('web_events') || f.includes('stats'));
  // web_events_backup ships its own table and trigger; nothing the reporting
  // functions read, and it drags in extensions this cluster does not have.
  const files = wanted.filter((f) => !f.includes('web_events_backup') && !f.includes('backup_run_now'));

  console.log('applying migrations, oldest first:');
  let applyFailed = false;
  for (const f of files) {
    const src = readFileSync(join(MIGRATIONS, f), 'utf8')
      .replace(/create\s+extension\s+if\s+not\s+exists\s+pg_cron\s*;/gi, '-- [pg_cron stubbed by run-verify-stats.cjs]');
    const p = scratch(f, src);
    try {
      psql(`-q -v ON_ERROR_STOP=1 -f ${p}`, { stdio: ['ignore', 'ignore', 'pipe'] });
      console.log(`  ok    ${f}`);
    } catch (err) {
      applyFailed = true;
      console.log(`  FAIL  ${f}`);
      console.log(String(err.stderr || err.message).split('\n').map((l) => `        ${l}`).join('\n'));
    }
  }
  if (applyFailed) {
    console.error('\nA migration failed to apply. Not running the assertions — they would be meaningless.');
    process.exitCode = 1;
  } else {
    const suite = scratch('verify.sql', readFileSync(join(REPO, 'tools', 'verify-stats-sql.sql'), 'utf8'));
    console.log('');
    const out = psql(`-q -v ON_ERROR_STOP=1 -f ${suite}`);
    console.log(out.trim());
    const m = out.match(/FAILURES=(\d+)/);
    if (!m) {
      console.error('\nThe suite did not report a failure count. Treating that as a failure.');
      process.exitCode = 1;
    } else if (m[1] !== '0') {
      console.error(`\n${m[1]} assertion(s) failed.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll assertions passed.');
    }
  }
} catch (err) {
  console.error(String(err.stderr || err.message));
  process.exitCode = 1;
}

if (KEEP) {
  console.log(`\n--keep: cluster left running. Connect with:`);
  console.log(`  ${AS_ROOT ? `su ${PGUSER} -c "` : ''}${join(BIN, 'psql')} -h ${SOCK} -p ${PORT} -U ${PGUSER} -d ${DB}${AS_ROOT ? '"' : ''}`);
  console.log(`  stop it: ${AS_ROOT ? `su ${PGUSER} -c "` : ''}${join(BIN, 'pg_ctl')} -D ${DATA} -m immediate stop${AS_ROOT ? '"' : ''} && rm -rf ${DIR}`);
}
