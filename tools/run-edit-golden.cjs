/**
 * Runs tools/edit-golden.json against the deployed itinerary-edit function and
 * reports per-case agreement.
 *
 * Deliberately NOT a vitest file: it needs a deployed function and burns real
 * tokens, and `npm test` must stay offline and free. Run it by hand when the
 * prompt, the schema, or the model changes.
 *
 *   node tools/run-edit-golden.cjs
 *
 * Reads VITE_ITINERARY_EDIT_FN_URL and VITE_SUPABASE_ANON_KEY from
 * ./.env.production, the same way run-trace.cjs does.
 */
const { readFileSync } = require('node:fs');

const raw = (() => {
  try { return readFileSync(`${process.cwd()}/.env.production`, 'utf8'); }
  catch { return ''; }
})();
const read = (k) => (raw.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const FN = read('VITE_ITINERARY_EDIT_FN_URL');
const ANON = read('VITE_SUPABASE_ANON_KEY');
if (!FN || !ANON) {
  console.error('Need VITE_ITINERARY_EDIT_FN_URL and VITE_SUPABASE_ANON_KEY in ./.env.production. Run from the repo root.');
  process.exit(1);
}

const golden = JSON.parse(readFileSync(`${process.cwd()}/tools/edit-golden.json`, 'utf8'));

// A representative current card, so the model has the same shape of context it
// gets in the app. Values are catalog data, not anyone's personal information.
const CURRENT = { title: 'Aruba Sunset Catamaran Cruise', priceUsd: 89, region: 'palm-beach', kind: 'sailing-cruises' };
const TAGS = ['mid-range', 'couple', 'beach-chill'];

async function parse(text) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, current: CURRENT, tags: TAGS }),
  });
  if (!r.ok) return { error: `${r.status}` };
  return r.json();
}

// Exact match on the fields the case names, AND no extra fields — over-reach
// (inventing a preference the traveller did not express) is a failure.
function agrees(got, want) {
  const g = got ?? {};
  const gk = Object.keys(g).sort();
  const wk = Object.keys(want).sort();
  if (gk.join() !== wk.join()) return false;
  return wk.every((k) => JSON.stringify(g[k]) === JSON.stringify(want[k]));
}

(async () => {
  let pass = 0;
  const misses = [];

  for (const c of golden.cases) {
    const res = await parse(c.text);
    const got = res.constraint;
    if (res.error) { misses.push([c.text, `ERROR ${res.error}`]); continue; }
    if (agrees(got, c.expect)) pass++;
    else misses.push([c.text, `got ${JSON.stringify(got)} want ${JSON.stringify(c.expect)}`]);
  }

  console.log(`\nagreement: ${pass}/${golden.cases.length} (${Math.round((100 * pass) / golden.cases.length)}%)\n`);
  for (const [text, why] of misses) console.log(`  ✗ "${text}"\n      ${why}`);

  console.log('\n--- adversarial (read these, do not score them) ---');
  for (const a of golden.adversarial) {
    const res = await parse(a.text);
    console.log(`\n  "${a.text}"\n      → ${JSON.stringify(res)}\n      expect: ${a.note}`);
  }
})();
