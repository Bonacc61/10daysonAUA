/**
 * Derives the committed suitability snapshot from the probe's evidence file.
 *
 *   npm run probe:suitability     # measures — one Viator call per product
 *   npm run build:suitability     # derives — offline, no key, no network
 *
 * This is the step the start-time snapshot did BY HAND (roadmap item 11: "the
 * probe writes only the evidence file, and src/data/startTimes.json was derived
 * from it by hand"). Doing it in code instead means the snapshot is reproducible
 * and the transform is reviewable — re-run it and the diff is the drift.
 *
 * Output is a TypeScript module, not JSON, because the consumer is a Deno edge
 * function: a .ts module bundles with no import-attribute or loader questions
 * at deploy time, and the file is small enough that the difference costs
 * nothing.
 *
 * Nothing here talks to Viator. If the numbers look wrong, re-run the probe.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { suitabilityProfile, type AgeBand } from '../supabase/functions/viator-cards/suitability';

const IN = 'docs/map/viator-suitability.json';
const OUT = 'supabase/functions/viator-cards/suitabilityData.ts';

type Record_ = {
  id: string;
  title: string;
  status: number;
  additionalInfo: string[];
  ageBands: AgeBand[];
};

const evidence = JSON.parse(readFileSync(IN, 'utf8')) as {
  probedAt: string;
  products: Record_[];
};

const ok = evidence.products.filter((p) => p.status === 200);
if (ok.length === 0) {
  console.error(`No successful records in ${IN}. Run \`npm run probe:suitability\` first.`);
  process.exit(1);
}

const profiles: Array<[string, string]> = [];
for (const p of ok) {
  const profile = suitabilityProfile(p.additionalInfo ?? [], p.ageBands ?? []);
  // Empty profiles are omitted rather than stored as "": the consumer falls
  // back to no profile anyway, and a map of blanks is noise in review.
  if (profile) profiles.push([p.id, profile]);
}
profiles.sort((a, b) => (a[0] < b[0] ? -1 : 1));   // stable diffs across runs

const body = profiles.map(([id, s]) => `  ${JSON.stringify(id)}: ${JSON.stringify(s)},`).join('\n');
writeFileSync(OUT, `// GENERATED FILE — do not edit by hand.
// Run \`npm run build:suitability\` to regenerate from docs/map/viator-suitability.json,
// which \`npm run probe:suitability\` writes from the Viator product endpoint.
//
// Probed: ${evidence.probedAt}
// ${profiles.length} of ${ok.length} catalog products carry a suitability profile.
//
// Each value is composed only of Viator's own standardised \`additionalInfo\`
// lines plus an age sentence derived from its own \`pricingInfo.ageBands\`.
// Nothing is generated or paraphrased. See ./suitability.ts for the rules and
// docs/superpowers/specs/2026-08-14-search-corpus-suitability-design.md for why.
export const SUITABILITY_PROFILES: Record<string, string> = {
${body}
};
`);

// --- Summary ---------------------------------------------------------------
const lens = profiles.map(([, s]) => s.length).sort((a, b) => a - b);
const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
const SIGNAL = /\b(infants?|children|child|kids?|age[ds]?|wheelchair|stroller|pram|accessible|fitness|mobility)\b/i;
const withSignal = ok.filter((p) => {
  const profile = suitabilityProfile(p.additionalInfo ?? [], p.ageBands ?? []);
  return SIGNAL.test(profile);
}).length;

console.log(`Read  ${IN}  (probed ${evidence.probedAt})`);
console.log(`Wrote ${OUT}`);
console.log(`\n  products with a profile      ${profiles.length} of ${ok.length}  (${((profiles.length / ok.length) * 100).toFixed(0)}%)`);
console.log(`  profile chars: median        ${median}  (max ${lens[lens.length - 1] ?? 0})`);
console.log(`  profile mentions age/access  ${withSignal}  (${((withSignal / ok.length) * 100).toFixed(0)}%)`);
console.log('\nNothing is live until viator-cards is deployed AND the catalog cache refreshes.');
