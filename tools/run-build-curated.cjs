/**
 * Generates supabase/functions/viator-cards/curatedData.ts from src/data/activities.ts.
 *
 * WHY THIS FILE EXISTS. `viator-cards` embeds the Viator payload and nothing
 * else, so the 26 curated locals have never been in `item_embeddings` — which
 * means `search_items` cannot return them at any dimension count, with any
 * text. Measured 2026-08-15: seven of the golden set's 56 expected fragments
 * name curated locals (zeerover twice, flamingo, museum, aloe, savaneta, kite),
 * capping achievable recall at 85% and making two queries score a guaranteed
 * zero. The runner's note blaming "Zeerover" on weak proper-noun handling was a
 * misdiagnosis: the restaurant is not in the index.
 *
 * WHY A GENERATED SNAPSHOT rather than an import. `ACTIVITIES` is a client-side
 * TypeScript constant under src/; a Deno edge function cannot import it. And it
 * cannot be written to `item_embeddings` out of band either, because the ingest
 * ends with `.delete().lt('updated_at', runStart)` — anything not upserted in
 * that same run is deleted. So the curated entries must travel INTO the
 * function and be embedded in the same pass. Same shape as suitabilityData.ts.
 *
 *   node tools/run-build-curated.cjs     (npm run build:curated)
 *
 * Re-run whenever src/data/activities.ts changes. Nothing checks this for you —
 * the same hand-step problem startTimes.json has (roadmap item 11).
 */
const { writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

// Mirrors the 500-char slice viator-cards applies to its own items, so both
// halves of the corpus are composed on the same rule. Curated text runs well
// under it (median ~350 chars), so this is a guard, not a working limit.
const MAX_CHARS = 500;

const out = 'node_modules/.cache/curated-activities.mjs';
execFileSync('node_modules/.bin/esbuild', [
  '--bundle', '--platform=node', '--format=esm', '--log-level=warning',
  `--outfile=${out}`, '--loader=ts',
], {
  input: `
    import { ACTIVITIES } from '${process.cwd()}/src/data/activities';
    console.log(JSON.stringify(ACTIVITIES.map((a) => ({
      id: a.id, title: a.title, description: a.description,
      localsSay: a.localsSay, location: a.location, category: a.category,
    }))));
  `,
  stdio: ['pipe', 'inherit', 'inherit'],
});

const activities = JSON.parse(execFileSync('node', [out], { encoding: 'utf8' }).trim());

// Composition. `localsSay` is the reason this is worth doing at all: it is
// editorial prose about what the place actually is ("Order the wahoo", "Aruba's
// most authentic food experience"), which is exactly the who-is-this-for signal
// Viator's marketing copy never carries. `location` earns its place too — it is
// the only thing that makes "Savaneta" findable.
const strip = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const entries = activities.map((a) => {
  const text = `${strip(a.title)}. ${strip(a.description)} ${strip(a.localsSay)} Located in ${strip(a.location)}. Category: ${strip(a.category)}.`;
  return { id: a.id, text: text.slice(0, MAX_CHARS) };
});

const lens = entries.map((e) => e.text.length).sort((a, b) => a - b);
const truncated = entries.filter((e) => e.text.length === MAX_CHARS).length;

const body = entries.map((e) => `  { id: ${JSON.stringify(e.id)}, text: ${JSON.stringify(e.text)} },`).join('\n');
const file = `// GENERATED FILE — do not edit by hand.
// Run \`npm run build:curated\` to regenerate from src/data/activities.ts.
//
// Built: ${new Date().toISOString()}
// ${entries.length} curated locals, median ${lens[Math.floor(lens.length / 2)]} chars, ${truncated} truncated at ${MAX_CHARS}.
//
// These are the island's own picks — beaches, fish fries, walking tours — that
// live in src/data/activities.ts and never reached \`item_embeddings\`, so
// semantic search could not return them. See tools/run-build-curated.cjs for
// why they are copied rather than imported.
export const CURATED_SEARCH_ENTRIES: Array<{ id: string; text: string }> = [
${body}
];
`;

const path = `${process.cwd()}/supabase/functions/viator-cards/curatedData.ts`;
writeFileSync(path, file);
console.log(`wrote ${entries.length} curated entries -> ${path.replace(process.cwd() + '/', '')}`);
console.log(`  text length: median ${lens[Math.floor(lens.length / 2)]}, max ${lens[lens.length - 1]}, truncated ${truncated}`);
