/**
 * Catalog enrichment — proposes, never ships.
 *
 * Reads the live catalog through the app's own loadCatalog(), asks Claude for
 * structured attributes on every product it has no record for, and writes
 * src/data/enrichment.json. A human reads the diff and commits it; production
 * only ever reads committed data. Same shape as the map-pin coordinate
 * registry: the tool proposes, a human accepts.
 *
 * Run:  node tools/run-enrich.cjs [--limit N] [--force] [--dry-run]
 *
 * Needs ANTHROPIC_API_KEY in the environment. The key never enters the repo,
 * the client bundle, or CI — this runs on a developer machine, on demand.
 *
 * Design: docs/superpowers/specs/2026-08-11-catalog-enrichment-design.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadCatalog } from '../src/data/activitySource';
import { activityKind, itemAdventure, KIND_VOCABULARY } from '../src/data/itemFit';
import type { EnrichmentRecord, EnrichmentSnapshot } from '../src/data/enrichment';
import type { ViatorItem } from '../src/types';

const SNAPSHOT = 'src/data/enrichment.json';
// Haiku, deliberately. The account has no Opus-tier quota — an 8-token request
// 429s on claude-opus-5 and claude-opus-4-8 while this returns 200 on the same
// key — and this task is extraction, not deep reasoning: the 287 toddler_ok
// records already in the snapshot came from gpt-5-mini and held up under audit
// (68/68 off-road rides excluded, each one checked by hand).
const MODEL = 'claude-haiku-4-5';

// `effort` is rejected outright by Haiku 4.5 — it is an Opus/Sonnet control.
// Sending it 400s every batch, so it is included only where it is accepted.
const SUPPORTS_EFFORT = !/haiku/.test(MODEL);
const BATCH = 20;

const argv = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (n: string) => argv.includes(`--${n}`);

const KINDS = [...KIND_VOCABULARY].sort();

const RECORD_SCHEMA = {
  type: 'object',
  properties: {
    id:        { type: 'string', description: 'The product code you were given. Copy it exactly.' },
    kind:      { type: 'string', enum: [...KINDS, 'none'], description: 'What KIND of activity this is. "none" if no listed kind fits — do not stretch one.' },
    adventure: { type: 'integer', description: '0 = lying on a beach, 100 = the most intense thing on the island. Judge the EXPERIENCE, not the marketing.' },
    physical:  {
      type: 'object',
      properties: {
        demand:      { type: 'string', enum: ['low', 'moderate', 'high'] },
        mobility_ok: { type: 'boolean', description: 'Could someone with limited mobility do this? Only true if the listing says something that supports it.' },
      },
      required: ['demand', 'mobility_ok'],
      additionalProperties: false,
    },
    kids: {
      type: 'object',
      properties: {
        min_age: { type: 'integer', description: 'Youngest age this sensibly suits. 0 if genuinely any age.' },
        baby_ok: { type: 'boolean' },
      },
      required: ['min_age', 'baby_ok'],
      additionalProperties: false,
    },
    setting: {
      type: 'string', enum: ['beach', 'ocean', 'land', 'town', 'mixed'],
      description: 'Where the activity PHYSICALLY happens. beach = on or at a beach; ocean = on or in open water away from shore; land = inland/outdoors; town = streets, buildings, indoors; mixed = genuinely both. Judge what a traveller would be standing on or in.',
    },
    // A 'none' sentinel rather than a nullable type: structured outputs reject
    // `type: ['string','null']` with an enum ("Enum value 'boat' does not match
    // declared type"). Same shape `kind` already uses. Mapped to null on the way in.
    vessel: {
      type: 'string', enum: ['boat', 'catamaran', 'submarine', 'jetski', 'none'],
      description: 'What the traveller is ABOARD for the main part of the activity, or "none" if they are not aboard anything. A shore snorkel is "none". A catamaran snorkel is "catamaran".',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence:   { type: 'string', description: 'A VERBATIM span copied from the description that backs physical/kids. Copy it exactly — do not paraphrase, summarise or invent. Omit if the description does not say.' },
  },
  required: ['id', 'confidence'],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: 'object',
  properties: { records: { type: 'array', items: RECORD_SCHEMA } },
  required: ['records'],
  additionalProperties: false,
} as const;

const SYSTEM = `You are reading Aruba tour listings and extracting structured attributes for a trip planner.

You are describing what the OPERATOR'S OWN LISTING says, not what you know about Aruba and not what the activity is probably like. If the listing does not say, the honest answer is a lower confidence or an omitted field. An omitted field is safe — the planner falls back to what it already does. An invented one is not.

confidence:
- high   — the description states this plainly.
- medium — the description strongly implies it.
- low    — you are inferring from the title or from general knowledge. Use this freely; it is not a failure.

evidence is a VERBATIM span copied from the description, and it is REQUIRED for physical and kids to be used at all — the planner shows that quote to travellers word for word, attributed to the operator, rather than paraphrasing it. Copy the exact characters. If you cannot find a span that genuinely supports the claim, omit physical and kids.

adventure judges the experience, not the copywriting. A "thrilling" sunset catamaran with an open bar is a 20. A UTV through Arikok is an 80.

kind must be one of the listed values or "none". Do not stretch a value to fit: a submarine tour is "none", not "dive".

setting and vessel describe WHAT THE ACTIVITY PHYSICALLY INVOLVES, and they are the two fields most likely to be corrupted by marketing. Ignore claims about who will enjoy it — "fun for all ages", "perfect for the whole family", "an unforgettable experience for everyone" say nothing about where you stand or what you are aboard. Ask only: at the main part of this activity, what is under the traveller's feet, and are they on a vessel? A sunset cruise is setting ocean, vessel catamaran or boat, however family-friendly the copy claims it is. A beach day pass is setting beach, vessel null. A walking tour of Oranjestad is setting town, vessel null.

vessel "none" is a real answer and must be given whenever the traveller is not aboard anything. Omitting the field is not the same as "none": omitted means you could not tell.`;

// --- The additive facets pass (--facets) ------------------------------------
//
// A SECOND pass that only ever ADDS. It asks four questions the extraction pass
// either never asked or answered for less than half the catalog, and it writes
// nothing else: `kind`, `adventure`, `setting` and `vessel` are carried forward
// untouched.
//
// Additive rather than `--force` for a measured reason. Those four fields are
// the ONLY enrichment the app acts on today — `itemAdventure` (itemFit.ts:99)
// prefers a real `adventure` over its keyword guess, and that number drives both
// the Explore vibe slider and the generator. Re-judging them would move a result
// that has already been measured through tools/run-plan-diff.cjs and settled.
// The four fields here have no consumer in src/ at all, so this pass cannot
// change an itinerary or a slider — a claim run-plan-diff.cjs is used to prove
// rather than assert.
//
// WHY physical/kids ARE ASKED AGAIN. The extraction pass produced them for only
// 144 of 328 products, and the cause is not the merge gate — exactly 0 records
// are blocked there for want of a quote. It is that both the prompt AND
// evidenceIsVerbatim drop the fields when no verbatim span backs them. That rule
// is right for anything QUOTED to a traveller and wrong for a filter: it is the
// same lesson `toddler_ok` already carries in enrichment.ts, where an
// exclusionary judgement deliberately has no evidence requirement because
// nothing renders it. So these carry their own confidence and no quote.
const FACET_RECORD_SCHEMA = {
  type: 'object',
  properties: {
    id:       { type: 'string', description: 'The product code you were given. Copy it exactly.' },
    physical: {
      type: 'object',
      properties: {
        demand:      { type: 'string', enum: ['low', 'moderate', 'high'], description: 'How much walking, climbing, heat and stamina the activity actually asks for.' },
        mobility_ok: { type: 'boolean', description: 'Could someone who walks slowly, uses a stick, or uses a wheelchair do this? Boarding a boat by ladder, walking over rocks, or a 4x4 over dunes are all false.' },
      },
      required: ['demand', 'mobility_ok'],
      additionalProperties: false,
    },
    kids: {
      type: 'object',
      properties: {
        min_age: { type: 'integer', description: 'Youngest age this sensibly suits. 0 if genuinely any age.' },
        baby_ok: { type: 'boolean' },
      },
      required: ['min_age', 'baby_ok'],
      additionalProperties: false,
    },
    kid_appeal: { type: 'integer', description: 'Would a 1-3 year old ENJOY this, 0-3. Judge the CHILD experience, not whether children are permitted.' },
    teen_appeal: { type: 'integer', description: 'Would a bored 13-17 year old ENJOY this, 0-3. A different question from kid_appeal, often its opposite.' },
    swim_required: { type: 'boolean', description: 'Must the traveller get INTO the water for the main part of this? A snorkel trip is true. A glass-bottom boat is false. A beach day pass is false — you may swim, you need not.' },
    indoor:        { type: 'string', enum: ['indoor', 'outdoor', 'mixed'], description: 'Is the traveller under a roof for the main part? A cooking class or a museum is indoor. A walking tour of the same town is outdoor. A bus tour with stops is mixed.' },
    facet_confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Your confidence in THESE four fields specifically.' },
  },
  required: ['id', 'facet_confidence'],
  additionalProperties: false,
} as const;

const FACETS_SCHEMA = {
  type: 'object',
  properties: { records: { type: 'array', items: FACET_RECORD_SCHEMA } },
  required: ['records'],
  additionalProperties: false,
} as const;

const FACETS_SYSTEM = `You are reading Aruba tour listings and judging four practical attributes for a trip planner's SEARCH FILTER.

None of these four is ever shown to a traveller. They are used to EXCLUDE activities that contradict what someone asked for — "wheelchair accessible", "no walking, we are tired", "we want to see fish but not swim", "something indoors for a rainy afternoon". So unlike the fields you may have seen elsewhere in this project, you do NOT need to find a quote to support them, and you must NOT omit a field merely because the listing does not spell it out.

ANSWER EVERY FIELD FOR EVERY PRODUCT. Use facet_confidence to say how sure you are:
- high   — the listing states or unmistakably entails it (a snorkel tour requires swimming; a submarine does not).
- medium — the activity type makes it clear even though the listing does not say.
- low    — you are guessing from the title alone.

Judge the ACTIVITY, not the marketing. "Fun for all ages", "suitable for everyone" and "no experience necessary" are sales copy and tell you nothing about stamina, mobility or water. Operators routinely tick a child-friendly box on a ride with a minimum age of 8.

mobility_ok is the field with the highest cost when it is wrong, because someone will rely on it. Ask a concrete question: could a person who uses a wheelchair, or who walks slowly and cannot manage steps, actually do this? Climbing a ladder onto a catamaran, walking over rock to a cove, a 4x4 across dunes, a hike, a horseback ride, kayaking, snorkelling from a boat — all false. A bus tour, a sunset cruise boarded from a dock, a cooking class, a museum — likely true. When it is genuinely unclear, answer false and mark the confidence: a false negative costs someone a suggestion, a false positive costs them a wasted trip.

swim_required means the water is not optional. Snorkelling, diving and swim-with-turtles are true. A catamaran cruise, a glass-bottom boat, a beach day pass and a kayak tour are false — you are on or beside the water, not in it.

indoor asks what is over the traveller's head for the main part of the activity, which is a different question from where it happens. A walking tour of a town is outdoor. A rum tasting in that same town is indoor.

kid_appeal is the question everything else about children misses. Not "is this permitted", not "is this safe" — WOULD A ONE TO THREE YEAR OLD ENJOY IT. A private air-conditioned island tour is perfectly safe for a toddler and a toddler will hate it. A couples photoshoot is harmless and pointless. Score the child's hour, not the parent's booking:

0 = nothing in it for them. Scenic drives, tastings, adult photoshoots, sunset cruises, historic walking tours, anything whose interest is conversation or a view.
1 = they can be carried through it without misery, but it is built for the adults.
2 = genuinely engaging for a small child — animals, shallow calm water they can stand in, sand, boats with things to look at, short and varied.
3 = built for small children. Playgrounds, toddler pools, water parks with a shallow area, petting farms, a beach specifically known as safe for babies.

Most of this catalog is 0 or 1 and that is the correct answer. Do not inflate it because the listing says "fun for the whole family" — that phrase is on almost everything and means nothing.

teen_appeal is the same question for a bored 13-17 year old, and it is frequently the OPPOSITE answer. A shallow toddler lagoon is kid_appeal 3 and teen_appeal 0. A UTV through the dunes is kid_appeal 0 and teen_appeal 3. Score what a teenager who did not choose this holiday would actually think:

0 = they will be on their phone. Tastings, historic walks, scenic drives, anything whose interest is conversation.
1 = tolerable. A beach, a boat with a view.
2 = genuinely engaging — snorkelling, kayaking, something with a bit of speed or skill to it.
3 = the thing they will talk about afterwards. Off-road, jet ski, kitesurf, cliff jumping, diving.

A teenager is not a small adult and not a big child. Do not derive this from kid_appeal.`;

type Product = { id: string; title: string; description: string; tags: number[] };

async function callClaude(
  batch: Product[],
  key: string,
  system: string = SYSTEM,
  schema: object = SCHEMA,
): Promise<EnrichmentRecord[]> {
  const body = {
    model: MODEL,
    max_tokens: 8000,
    system,
    output_config: {
      ...(SUPPORTS_EFFORT ? { effort: 'medium' } : {}),
      format: { type: 'json_schema', schema },
    },
    messages: [{
      role: 'user',
      content: batch.map((p) =>
        `id: ${p.id}\ntitle: ${p.title}\ndescription: ${p.description || '(none supplied)'}`,
      ).join('\n\n---\n\n'),
    }],
  };
  // Two credential shapes reach this tool and they authenticate DIFFERENTLY.
  // A console API key (`sk-ant-api…`) goes on `x-api-key`. An OAuth access
  // token — what `ant auth login` mints and what a pasted `sk-ant-oat…` string
  // is — must go on `Authorization: Bearer` with the oauth beta header, and
  // returns a bare 401 on `x-api-key` with nothing to say the header was the
  // problem. Sniffing the prefix costs one line and removes that dead end.
  //
  // Caveat for the OAuth path: an access token passed via env var is short-lived
  // and is NOT auto-refreshed here, so a full 328-item run (17 batches) can 401
  // partway through where a console key would not. Re-run — already-enriched
  // items are skipped — or use an `sk-ant-api…` key for the full pass.
  const isOAuth = key.startsWith('sk-ant-oat');
  const auth: Record<string, string> = isOAuth
    ? { authorization: `Bearer ${key}`, 'anthropic-beta': 'oauth-2025-04-20' }
    : { 'x-api-key': key };
  // RETRY THE RETRYABLE ONES. Without this a single 429 or 529 dropped a whole
  // batch of 20 products on the floor — the run reported "FAILED — skipping"
  // and carried on, so a 328-item pass could finish looking complete while
  // silently missing a third of the catalog. 4xx other than 429 is a request
  // problem and retrying it just burns quota, so only 429 and 5xx come back.
  const RETRYABLE = (status: number) => status === 429 || status >= 500;
  const MAX_ATTEMPTS = 5;
  let r: Response | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { ...auth, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok || !RETRYABLE(r.status) || attempt === MAX_ATTEMPTS) break;
    // Honour the server's own retry-after when it sends one; otherwise back off
    // 2, 4, 8, 16 seconds.
    const stated = Number(r.headers.get('retry-after'));
    const waitMs = Number.isFinite(stated) && stated > 0
      ? stated * 1000
      : 2000 * 2 ** (attempt - 1);
    process.stdout.write(`${r.status}, retrying in ${Math.round(waitMs / 1000)}s … `);
    await new Promise((res) => setTimeout(res, waitMs));
  }
  if (!r) throw new Error('no response');
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = await r.json();
  if (out.stop_reason === 'refusal') throw new Error('refused');
  const text = (out.content ?? []).find((b: { type: string }) => b.type === 'text')?.text;
  if (!text) throw new Error('empty response');
  return JSON.parse(text).records ?? [];
}

// An evidence span the model did not copy verbatim is not evidence. Checked
// here rather than trusted, because the whole tier-2 safety story rests on the
// quote being the operator's words.
function evidenceIsVerbatim(rec: EnrichmentRecord, description: string): boolean {
  if (!rec.evidence) return false;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(description).includes(norm(rec.evidence));
}

(async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  const dryRun = has('dry-run');
  if (!key && !dryRun) {
    console.error('ANTHROPIC_API_KEY is not set. Export it, or pass --dry-run to see what would be sent.');
    process.exit(1);
  }

  const catalog = await loadCatalog();
  if (catalog.items.length < 50) {
    console.error(`only ${catalog.items.length} items — that is the offline stub, not the live catalog.`);
    console.error('Run from the repo root so ./.env.production is readable.');
    process.exit(1);
  }

  let existing: EnrichmentSnapshot = {};
  try { existing = JSON.parse(readFileSync(SNAPSHOT, 'utf8')); } catch { /* first run */ }

  // --- --facets: the additive pass ------------------------------------------
  if (has('facets')) {
    // THE CURATED LOCALS ARE IN THIS PASS TOO, and their absence was the whole
    // reason "good with toddler" had no good answers. Of 328 Viator products
    // only 2 score kid_appeal 3 and 41 score 2 — the bookable catalog is
    // overwhelmingly adult. The best toddler answers on this island are the 26
    // editorial picks (Baby Beach, "a natural nursery"; Druif, "where locals
    // bring the kids on a Sunday"), and they carried no facet record at all, so
    // the filter could not see them. They reached the semantic INDEX on
    // 2026-08-16 and stopped there.
    const curated = catalog.activities.map((a) => ({
      id: a.id,
      title: a.title,
      description: [a.description, a.localsSay, a.fitReason].filter(Boolean).join(' '),
      tags: [] as number[],
    }));
    // Keyed on kid_appeal, not facet_confidence: the pass has run before and
    // every row already carries the latter, so a fresh facet needs its own
    // completeness check or the run does nothing.
    const done = (id: string) => existing[id]?.teen_appeal !== undefined;
    const todo = [
      ...catalog.items.map((i) => ({ id: i.id, title: i.title, description: i.description ?? '', tags: i.tags ?? [] })),
      ...curated,
    ].filter((i) => has('force') || !done(i.id));
    const lim = arg('limit') ? parseInt(arg('limit')!, 10) : todo.length;
    const work = todo.slice(0, lim);

    console.log(`catalog: ${catalog.items.length} items + ${curated.length} curated locals`);
    console.log(`already carrying the new facets: ${catalog.items.filter((i) => done(i.id)).length}`);
    console.log(`to do this run: ${work.length}${lim < todo.length ? ` (of ${todo.length}, --limit)` : ''}\n`);

    if (dryRun) {
      const p = work[0];
      console.log('--dry-run: first product as it would be sent\n');
      if (p) console.log(`id: ${p.id}\ntitle: ${p.title}\ndescription: ${(p.description ?? '').slice(0, 300)}`);
      console.log(`\nbatches: ${Math.ceil(work.length / BATCH)} × ${BATCH}`);
      return;
    }
    if (!work.length) { console.log('nothing to do.'); return; }

    const next: EnrichmentSnapshot = { ...existing };
    const byId = new Map<string, ViatorItem>(catalog.items.map((i) => [i.id, i]));
    let written = 0;

    for (let i = 0; i < work.length; i += BATCH) {
      const slice = work.slice(i, i + BATCH);
      process.stdout.write(`batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(work.length / BATCH)} … `);
      let records: EnrichmentRecord[];
      try {
        records = await callClaude(slice, key!, FACETS_SYSTEM, FACETS_SCHEMA);
      } catch (e) {
        console.log(`FAILED — skipping this batch\n  ${String(e).slice(0, 400)}`);
        continue;
      }

      const validIds = new Set(work.map((w) => w.id));
      for (const rec of records) {
        const id = (rec as EnrichmentRecord & { id: string }).id;
        if (!validIds.has(id)) continue;
        const item = { id } as ViatorItem;
        // SPREAD THE EXISTING RECORD FIRST. The extraction pass writes `clean`
        // wholesale and had to hand-carry `toddler_ok` to avoid deleting it;
        // this pass cannot make that mistake, because everything it does not
        // touch is copied by construction.
        const add: EnrichmentRecord = { ...(next[id] ?? { confidence: 'low' }) };
        add.facet_confidence = rec.facet_confidence;
        // AN EVIDENCE QUOTE BACKS A SPECIFIC JUDGEMENT, and this pass writes a
        // new one into the same field the extraction pass used. Overwriting
        // without dropping the quote leaves `evidence` attached to a value it
        // never supported — it happened to 43 `physical` and 73 `kids` records
        // before this guard existed, and it was invisible because nothing
        // renders `evidence` yet. It stops being invisible the day something
        // does. The quote goes with the value it justified.
        if (rec.physical || rec.kids) delete add.evidence;
        if (rec.physical) add.physical = rec.physical;
        if (rec.kids) add.kids = rec.kids;
        if (typeof rec.swim_required === 'boolean') add.swim_required = rec.swim_required;
        if (rec.indoor) add.indoor = rec.indoor;
        if (typeof rec.kid_appeal === 'number') add.kid_appeal = rec.kid_appeal;
        if (typeof rec.teen_appeal === 'number') add.teen_appeal = rec.teen_appeal;
        next[id] = add;
        written++;
      }
      console.log(`${records.length} records`);
    }

    const sortedF: EnrichmentSnapshot = {};
    for (const k of Object.keys(next).sort()) sortedF[k] = next[k];
    writeFileSync(SNAPSHOT, JSON.stringify(sortedF, null, 2) + '\n');

    const count = (pred: (r: EnrichmentRecord) => boolean) =>
      catalog.items.filter((i) => sortedF[i.id] && pred(sortedF[i.id]!)).length;
    const hiFacet = (r: EnrichmentRecord) => (r.facet_confidence ?? r.confidence) === 'high';
    console.log(`\nwrote ${written} records to ${SNAPSHOT}`);
    console.log('coverage across the live catalog, at high facet confidence:');
    console.log(`  physical      ${count((r) => hiFacet(r) && !!r.physical)}`);
    console.log(`  kids          ${count((r) => hiFacet(r) && !!r.kids)}`);
    console.log(`  swim_required ${count((r) => hiFacet(r) && r.swim_required !== undefined)}`);
    console.log(`  indoor        ${count((r) => hiFacet(r) && !!r.indoor)}`);
    console.log(`  kid_appeal    ${count((r) => hiFacet(r) && r.kid_appeal !== undefined)}`);
    console.log(`  teen_appeal   ${count((r) => hiFacet(r) && r.teen_appeal !== undefined)}`);
    return;
  }

  // loadCatalog has already applied isExcludedFromCatalog, so anything here can
  // reach a surface and is worth paying for.
  // "Already enriched" means carrying the facets THIS version produces, not
  // merely having a row. The 287 records mapped from the toddler pilot hold only
  // `toddler_ok`, so a bare `!existing[i.id]` would skip 287 of 327 products and
  // silently enrich the ~40 the pilot never judged.
  const complete = (id: string) => {
    const r = existing[id] as (EnrichmentRecord | undefined);
    return Boolean(r && r.setting !== undefined);
  };
  const todo = catalog.items.filter((i) => has('force') || !complete(i.id));
  const limit = arg('limit') ? parseInt(arg('limit')!, 10) : todo.length;
  const batchItems = todo.slice(0, limit);

  console.log(`catalog: ${catalog.items.length} items`);
  console.log(`already enriched: ${Object.keys(existing).length}`);
  console.log(`to do this run: ${batchItems.length}${limit < todo.length ? ` (of ${todo.length}, --limit)` : ''}\n`);

  if (dryRun) {
    console.log('--dry-run: first product as it would be sent\n');
    const p = batchItems[0];
    if (p) console.log(`id: ${p.id}\ntitle: ${p.title}\ndescription: ${(p.description ?? '').slice(0, 300)}`);
    console.log(`\nkind vocabulary: ${KINDS.join(', ')}`);
    console.log(`batches: ${Math.ceil(batchItems.length / BATCH)} × ${BATCH}`);
    return;
  }
  if (!batchItems.length) { console.log('nothing to do.'); return; }

  const next: EnrichmentSnapshot = { ...existing };
  const byId = new Map<string, ViatorItem>(catalog.items.map((i) => [i.id, i]));
  let added = 0, changed = 0, rejected = 0, quoteFailed = 0;

  for (let i = 0; i < batchItems.length; i += BATCH) {
    const slice = batchItems.slice(i, i + BATCH);
    process.stdout.write(`batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(batchItems.length / BATCH)} … `);
    let records: EnrichmentRecord[];
    try {
      records = await callClaude(
        slice.map((it) => ({ id: it.id, title: it.title, description: it.description ?? '', tags: it.tags ?? [] })),
        key!,
      );
    } catch (e) {
      // 80 chars truncated the API's own message mid-sentence, which is where
      // the reason lives — a schema rejection reads as a bare 'anthropic 400:'.
      console.log(`FAILED — skipping this batch\n  ${String(e).slice(0, 400)}`);
      continue;
    }

    for (const rec of records) {
      const item = byId.get((rec as EnrichmentRecord & { id: string }).id);
      if (!item) { rejected++; continue; }
      // Carry forward what THIS tool does not produce. `next[id] = clean`
      // replaces the record wholesale, and the 287 rows mapped from the toddler
      // pilot carry `toddler_ok` and nothing else — a run without this would
      // have silently deleted the only data behind "good with toddler".
      const clean: EnrichmentRecord = { confidence: rec.confidence };
      const prev = existing[item.id];
      if (prev?.toddler_ok !== undefined) clean.toddler_ok = prev.toddler_ok;
      if (rec.kind && rec.kind !== 'none' && KIND_VOCABULARY.has(rec.kind)) clean.kind = rec.kind;
      if (typeof rec.adventure === 'number' && rec.adventure >= 0 && rec.adventure <= 100) clean.adventure = rec.adventure;
      // Filter facets, not rendered copy, so they carry no evidence requirement
      // — but `vessel: null` is a real answer ("not aboard anything") and must
      // survive, which an `if (rec.vessel)` would drop.
      if (rec.setting) clean.setting = rec.setting;
      // The model answers with the 'none' sentinel; the snapshot stores null,
      // which is what "explicitly not a vessel" means to every reader of it.
      const rawVessel = (rec as unknown as { vessel?: string }).vessel;
      if (rawVessel) clean.vessel = rawVessel === 'none'
        ? null
        : (rawVessel as NonNullable<EnrichmentRecord['vessel']>);
      if (evidenceIsVerbatim(rec, item.description ?? '')) {
        clean.evidence = rec.evidence;
        if (rec.physical) clean.physical = rec.physical;
        if (rec.kids) clean.kids = rec.kids;
      } else if (rec.physical || rec.kids) {
        quoteFailed++;
      }
      const before = JSON.stringify(existing[item.id]);
      const after = JSON.stringify(clean);
      if (before === undefined) added++;
      else if (before !== after) changed++;
      next[item.id] = clean;
    }
    console.log(`${records.length} records`);
  }

  // Sorted keys so the file diffs cleanly run to run.
  const sorted: EnrichmentSnapshot = {};
  for (const k of Object.keys(next).sort()) sorted[k] = next[k];
  writeFileSync(SNAPSHOT, JSON.stringify(sorted, null, 2) + '\n');

  // --- What the run bought ---------------------------------------------------
  const merged = catalog.items.map((it) => {
    const r = sorted[it.id];
    const kindOk = r && (r.confidence === 'high' || r.confidence === 'medium') && r.kind;
    return { ...it, enriched_kind: kindOk ? r.kind : undefined,
             adventure: it.adventure ?? (kindOk && typeof r.adventure === 'number' ? r.adventure : undefined) };
  });
  const resolvedBefore = catalog.items.filter((i) => !activityKind(i).startsWith('sec:')).length;
  const resolvedAfter = merged.filter((i) => !activityKind(i).startsWith('sec:')).length;
  const advBefore = new Set(catalog.items.map(itemAdventure)).size;
  const advAfter = new Set(merged.map(itemAdventure)).size;
  const bytes = Buffer.byteLength(JSON.stringify(sorted));

  console.log(`\nkind resolved:              ${resolvedBefore}/${catalog.items.length}  ->  ${resolvedAfter}/${catalog.items.length}`);
  console.log(`distinct adventure values:  ${advBefore}  ->  ${advAfter}`);
  console.log(`snapshot: ${Object.keys(sorted).length} items, ${(bytes / 1024).toFixed(0)}KB raw`);
  console.log(`new: ${added}   changed: ${changed}   rejected (unknown id): ${rejected}   tier-2 dropped (quote not verbatim): ${quoteFailed}`);
  if (changed) console.log(`\n  ${changed} EXISTING product(s) changed — a product's kind should not move. Read those hunks first.`);
  console.log(`\nwritten to ${SNAPSHOT}. Review the diff before committing.`);
})();
