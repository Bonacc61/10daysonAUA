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
const MODEL = 'claude-opus-5';
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

kind must be one of the listed values or "none". Do not stretch a value to fit: a submarine tour is "none", not "dive".`;

type Product = { id: string; title: string; description: string; tags: number[] };

async function callClaude(batch: Product[], key: string): Promise<EnrichmentRecord[]> {
  const body = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: batch.map((p) =>
        `id: ${p.id}\ntitle: ${p.title}\ndescription: ${p.description || '(none supplied)'}`,
      ).join('\n\n---\n\n'),
    }],
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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

  // loadCatalog has already applied isExcludedFromCatalog, so anything here can
  // reach a surface and is worth paying for.
  const todo = catalog.items.filter((i) => has('force') || !existing[i.id]);
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
      console.log(`FAILED (${String(e).slice(0, 80)}) — skipping this batch`);
      continue;
    }

    for (const rec of records) {
      const item = byId.get((rec as EnrichmentRecord & { id: string }).id);
      if (!item) { rejected++; continue; }
      const clean: EnrichmentRecord = { confidence: rec.confidence };
      if (rec.kind && rec.kind !== 'none' && KIND_VOCABULARY.has(rec.kind)) clean.kind = rec.kind;
      if (typeof rec.adventure === 'number' && rec.adventure >= 0 && rec.adventure <= 100) clean.adventure = rec.adventure;
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
