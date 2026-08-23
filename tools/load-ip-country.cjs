/**
 * Loads DB-IP IP-to-Country Lite into public.ip_country.
 *
 *   node tools/load-ip-country.cjs                  # fetch this month's dataset and load it
 *   node tools/load-ip-country.cjs --file x.csv     # load a CSV already on disk
 *   node tools/load-ip-country.cjs --dry-run        # parse and report, write nothing
 *   node tools/load-ip-country.cjs --verify         # don't load; just check what is already there
 *
 * Needs the service-role key, and only ever in one process:
 *
 *   SUPABASE_SERVICE_ROLE_KEY=$(supabase projects api-keys --project-ref <ref> -o json \
 *     | python3 -c "import json,sys;print([k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'][0])") \
 *     node tools/load-ip-country.cjs
 *
 * WHY THIS TABLE EXISTS AT ALL. Supabase edge functions expose no country
 * header, and the obvious alternative — a third-party geo API — would send
 * every visitor's IP to a US sub-processor, which is the exact thing the
 * cookieless beacon design exists to avoid. So the lookup happens inside our
 * own EU Postgres and only the two-letter code survives. `collect` calls
 * country_for_ip(ip) and writes the code; the IP is never stored in any column
 * of web_events. See supabase/migrations/20260820091000_ip_country.sql.
 *
 * COUNTRY CANNOT BE BACKFILLED. web_events holds no IP by design, so a row
 * written while this table is empty has no geography, permanently. That is the
 * whole argument for loading it before `collect` is deployed rather than after.
 *
 * LICENCE: DB-IP IP-to-Country Lite is CC BY 4.0 — attribution to DB-IP.com is
 * REQUIRED wherever the data is shown. The credit line lives on /stats. Verified
 * on the download page 2026-08-23; check it again on each refresh, because these
 * terms do change and this comment is not authority on them.
 *
 * STALENESS: this is a hand-run script and NOTHING checks whether it has been
 * re-run. Ranges are reassigned between countries continuously, so a year-old
 * copy quietly misattributes traffic. Record every load in docs/ROADMAP.md the
 * way the start-times snapshot is recorded, or it will rot silently.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { gunzipSync } = require('node:zlib');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };

const DRY_RUN = has('--dry-run');
const VERIFY_ONLY = has('--verify');
const FILE = valueOf('--file');

// The dataset is published monthly at a dated URL. Default to the current UTC
// month; --file covers the case where that month is not up yet.
const MONTH = new Date().toISOString().slice(0, 7);
const DATASET_URL = `https://download.db-ip.com/free/dbip-country-lite-${MONTH}.csv.gz`;

const env = (() => {
  try { return readFileSync(`${process.cwd()}/.env.production`, 'utf8'); }
  catch { return ''; }
})();
const readEnv = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const BASE = `${readEnv('VITE_SUPABASE_URL')}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!readEnv('VITE_SUPABASE_URL')) {
  console.error('no VITE_SUPABASE_URL in ./.env.production — run from the repo root');
  process.exit(1);
}
if (!KEY && !DRY_RUN) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. ip_country has RLS on and no policies,');
  console.error('so the anon key cannot write to it — that is deliberate. See the header.');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  authorization: `Bearer ${KEY}`,
  'content-type': 'application/json',
};

/**
 * One CSV line → one row, or null if it is not usable.
 *
 * ZZ IS KEPT, NOT SKIPPED. The published ranges are non-overlapping and cover
 * the whole address space including the unknown blocks, and that completeness is
 * what lets country_for_ip stop at the first row it finds: with no gaps, the
 * greatest start_ip <= ip IS the containing range. Drop the ZZ rows and a
 * lookup that lands in a hole walks backwards into the previous country and
 * answers with it. The migration turns 'ZZ' into null at read time instead, so
 * the table stays a faithful copy of the dataset.
 */
function parseLine(line) {
  const t = line.trim();
  if (!t) return null;
  const parts = t.split(',');
  if (parts.length !== 3) return null;
  const [start_ip, end_ip, country] = parts.map((s) => s.trim());
  if (!start_ip || !end_ip) return null;
  // Two ASCII letters. Anything else is a malformed line, not a country.
  if (!/^[A-Z]{2}$/.test(country)) return null;
  // A v4 start with a v6 end (or the reverse) would be a corrupt row, and
  // Postgres would take it: `inet` accepts both families in the same column.
  // country_for_ip relies on v4 sorting below v6, so a mixed row could return a
  // country for an address in the other family entirely.
  if (start_ip.includes(':') !== end_ip.includes(':')) return null;
  return { start_ip, end_ip, country };
}

async function fetchDataset() {
  console.log(`fetching ${DATASET_URL}`);
  const res = await fetch(DATASET_URL);
  if (!res.ok) {
    console.error(`${res.status} ${res.statusText} — if this month is not published yet,`);
    console.error('download the previous month by hand and pass it with --file.');
    process.exit(1);
  }
  const gz = Buffer.from(await res.arrayBuffer());
  console.log(`  ${(gz.length / 1e6).toFixed(1)} MB gzipped`);
  return gunzipSync(gz).toString('utf8');
}

async function rpcCountryFor(ip) {
  const res = await fetch(`${BASE}/rpc/country_for_ip`, {
    method: 'POST', headers, body: JSON.stringify({ ip }),
  });
  if (!res.ok) return `HTTP ${res.status}`;
  return JSON.parse(await res.text());
}

async function rowCount() {
  const res = await fetch(`${BASE}/ip_country?select=country&limit=1`, {
    headers: { ...headers, prefer: 'count=exact' },
  });
  return Number((res.headers.get('content-range') || '*/0').split('/')[1]);
}

/**
 * The addresses the load is checked against. Each one is verifiable
 * independently of the dataset — that is the point; checking a row against the
 * file it came from proves only that the insert ran.
 *
 * NO ANYCAST ADDRESSES HERE, and that is a correction rather than a preference.
 * The first version of this list used 8.8.8.8, 1.1.1.1 and Google's IPv6
 * resolver. The v6 one came back CA, which looked like a lookup bug and was not:
 * DB-IP puts 2001:4860:4802::/… in Canada, and Cloudflare's v6 resolver too. An
 * anycast address is announced from many countries at once, so it has no single
 * right answer and cannot tell a broken load from a coarse dataset. University
 * and research networks have fixed, registry-verifiable allocations, so they can.
 *
 * Four countries across three registries (RIPE, ARIN, APNIC) and both address
 * families — enough that a load which silently answered one country for
 * everything, or lost the v6 half, would fail here.
 */
const PROBES = [
  ['145.100.0.1', 'NL', 'SURFnet, the Dutch research network'],
  ['2001:610::1', 'NL', 'SURFnet again, over IPv6 — covers the v6 half of the table'],
  ['85.10.159.81', 'NL', 'the TransIP host this site is served from'],
  ['18.9.22.69', 'US', 'MIT, the legacy 18.0.0.0/8 allocation'],
  ['129.132.0.1', 'CH', 'ETH Zurich'],
  ['133.11.0.1', 'JP', 'the University of Tokyo'],
];

async function verify() {
  const n = await rowCount();
  console.log(`\nip_country holds ${n.toLocaleString('en-US')} ranges`);
  if (n === 0) {
    console.log('  empty — country_for_ip answers null for every address');
    return false;
  }
  let ok = true;
  for (const [ip, expected, why] of PROBES) {
    const got = await rpcCountryFor(ip);
    const good = got === expected;
    ok = ok && good;
    console.log(`  ${good ? 'ok  ' : 'FAIL'} ${ip.padEnd(22)} -> ${String(got).padEnd(6)} expected ${expected}  (${why})`);
  }
  return ok;
}

async function main() {
  if (VERIFY_ONLY) { process.exit((await verify()) ? 0 : 1); }

  const csv = FILE ? readFileSync(FILE, 'utf8') : await fetchDataset();

  const rows = [];
  let skipped = 0;
  for (const line of csv.split('\n')) {
    const row = parseLine(line);
    if (row) rows.push(row); else if (line.trim()) skipped++;
  }

  const countries = new Set(rows.map((r) => r.country));
  const v6 = rows.filter((r) => r.start_ip.includes(':')).length;
  console.log(`parsed ${rows.length.toLocaleString('en-US')} ranges — ${countries.size} distinct codes, ` +
              `${(rows.length - v6).toLocaleString('en-US')} v4 / ${v6.toLocaleString('en-US')} v6, ${skipped} unusable lines`);

  // A dataset this size should never collapse to a handful of codes or a few
  // thousand rows. If it does, the download is a truncated or an error page and
  // loading it would replace a good table with rubbish.
  if (rows.length < 100_000 || countries.size < 100) {
    console.error('that is too small to be the real dataset — refusing to load it');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written');
    console.log(`  first: ${JSON.stringify(rows[0])}`);
    console.log(`  last:  ${JSON.stringify(rows[rows.length - 1])}`);
    return;
  }

  // Replace rather than merge. A range that changed hands keeps its start_ip, so
  // an upsert would catch it, but a range that was SPLIT leaves the old wider
  // row behind and the lookup then answers from stale data. There is no
  // cross-request transaction over PostgREST, so this leaves a window — a few
  // minutes — where country_for_ip answers null and collect writes NULL country.
  // That is why the first load happens before `collect` is deployed, and why a
  // refresh belongs at a quiet hour.
  console.log('\nclearing ip_country');
  const del = await fetch(`${BASE}/ip_country?start_ip=not.is.null`, {
    method: 'DELETE', headers: { ...headers, prefer: 'return=minimal' },
  });
  if (!del.ok) { console.error(`delete failed: ${del.status} ${await del.text()}`); process.exit(1); }

  const BATCH = 5_000;
  const started = Date.now();
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await fetch(`${BASE}/ip_country`, {
      method: 'POST', headers: { ...headers, prefer: 'return=minimal' }, body: JSON.stringify(chunk),
    });
    if (!res.ok) { console.error(`\nbatch at ${i} failed: ${res.status} ${await res.text()}`); process.exit(1); }
    const done = Math.min(i + BATCH, rows.length);
    process.stdout.write(`\r  ${done.toLocaleString('en-US')} / ${rows.length.toLocaleString('en-US')}`);
  }
  console.log(`\nloaded in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  const ok = await verify();
  if (!ok) { console.error('\nprobes did not all pass — do not record this load as good'); process.exit(1); }
  console.log(`\nRecord in docs/ROADMAP.md: dataset dbip-country-lite-${MONTH}, ` +
              `${rows.length.toLocaleString('en-US')} ranges, loaded ${new Date().toISOString().slice(0, 10)}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
