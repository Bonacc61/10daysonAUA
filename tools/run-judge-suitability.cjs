/**
 * Ask a reasoning model whether each catalog product suits a given traveller,
 * and write the verdict WITH ITS REASON so a wrong call shows up in a diff.
 *
 * Why this exists: Viator's own `additionalInfo` cannot answer the question.
 * Measured 2026-08-15 on the 68 off-road products (UTV/ATV/Jeep by title):
 * 31 of them positively claim child-friendliness — 16 say "Children welcome
 * from age N", 15 say "Specialized infant seats are available" (22%, ABOVE the
 * 15% catalog rate). An operator ticking a box is not a judgment about whether
 * a two-year-old belongs in a roll-caged buggy on rough terrain. Embeddings
 * cannot fix that either: they measure what a text is ABOUT, and the text says
 * the wrong thing. So the judgment has to come from something that knows what
 * a UTV is.
 *
 *   node tools/run-judge-suitability.cjs --rides   # the 68 off-road products
 *   node tools/run-judge-suitability.cjs --all     # the whole catalog
 *
 * Reads OPENAI_API_KEY from .env.local. Runs OFFLINE of production: it touches
 * no Supabase table and no edge function, and its output is a file for review.
 *
 * GDPR: sends Viator PRODUCT COPY to OpenAI, which already receives exactly
 * that at ingest (`viator-cards` -> OpenAI, always on). No traveller words, no
 * new sub-processor, no Privacy Policy change, no feature flag.
 *
 * Deliberately NOT a vitest file: it needs a network call and a real key.
 */
const { readFileSync, writeFileSync } = require('node:fs');

const ALL = process.argv.includes('--all');
const MODEL = (process.argv.find((a) => a.startsWith('--model=')) || '').split('=')[1] || 'gpt-5-mini';
const CONCURRENCY = 6;

// gpt-5 models spend completion tokens on hidden reasoning BEFORE writing a
// visible answer. Probed 2026-08-15: a 16-token ceiling returned an empty
// string with finish_reason "stop" and no error — a silent blank, not a
// failure. 400 leaves room for ~60-120 reasoning tokens plus the JSON.
const MAX_COMPLETION_TOKENS = 400;
const REASONING_EFFORT = 'low';

const env = (() => {
  try { return readFileSync(`${process.cwd()}/.env.local`, 'utf8'); } catch { return ''; }
})();
const KEY = process.env.OPENAI_API_KEY
  || (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
  || '';
if (!KEY) {
  console.error('No OPENAI_API_KEY in .env.local or the environment.');
  console.error('Note the exact spelling — OPEN_API_KEY is silently ignored by every reader in this repo.');
  process.exit(1);
}

// ── The traveller being judged for ─────────────────────────────────────────
// One profile for now. Adding a second means another pass, not a rewrite:
// the verdict key is what `entryExcludedByFlags` would read.
// SAFE IS NOT THE SAME QUESTION AS GOOD, and the first version of this prompt
// asked the wrong one. Phrased as "is this suitable", the model answered on
// SAFETY and returned 53 products of which 40 were sightseeing tours and
// couples photoshoots — a 60-minute beach photoshoot will not hurt a toddler,
// and no parent searching "good with toddler" wants one. The traveller is
// asking what to DO with the child, so the prompt has to ask that.
const PROFILE = {
  key: 'toddler-ok',
  who: 'a family travelling with a toddler (roughly 1-3 years old)',
  guidance: [
    'Two things must BOTH hold: it is safe and practical with a toddler, AND it is something a toddler would actually enjoy and get something out of.',
    'An activity aimed at adults that merely tolerates a child present — a couples photoshoot, a dinner cruise, a tasting, a scenic drive the child sleeps through — is NOT a good answer, even though nothing about it is dangerous. Answer false for those.',
    'Judge the ACTIVITY, not the marketing copy. Operators fill in the accessibility checkboxes themselves and are often optimistic; treat those lines as claims to weigh, not facts to obey.',
    'On the practical side weigh restraint and seating, terrain and speed, water and depth, duration, noise, heat exposure, and whether leaving early is possible.',
    'A minimum age above 3 settles it: false.',
  ].join(' '),
};

const probe = JSON.parse(readFileSync(`${process.cwd()}/docs/map/viator-suitability.json`, 'utf8')).products;
const RIDE = /\b(utv|atv|off-?road|4wd|jeep|buggy|quad|dune|polaris)\b/i;

const targets = (ALL ? probe : probe.filter((p) => RIDE.test(p.title || ''))).filter((p) => p.status === 200);
console.log(`judging ${targets.length} product(s) for: ${PROFILE.who}`);
console.log(`model ${MODEL}, reasoning_effort ${REASONING_EFFORT}\n`);

function prompt(p) {
  const info = (p.additionalInfo || []).map((l) => `- ${l}`).join('\n') || '- (none given)';
  const bands = (p.ageBands || []).map((b) => `${b.ageBand ?? b.band ?? '?'} ${b.startAge ?? '?'}-${b.endAge ?? '?'}`).join(', ') || '(none given)';
  return `Product title: ${p.title}

Operator's accessibility notes (their own words, may be optimistic):
${info}

Ticket age bands: ${bands}
Duration: ${p.durationMin ? p.durationMin + ' minutes' : 'not stated'}

Is this suitable for ${PROFILE.who}? ${PROFILE.guidance}

Reply with JSON only: {"${PROFILE.key}": true|false, "confidence": "high"|"low", "reason": "one short sentence"}`;
}

async function judge(p) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          reasoning_effort: REASONING_EFFORT,
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt(p) }],
        }),
      });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
      const body = await r.json();
      if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
      const txt = body.choices[0].message.content;
      // An empty string here is the reasoning-budget trap, not a parse failure —
      // say so, because "" would otherwise read as a malformed model reply.
      if (!txt) throw new Error(`empty reply (finish_reason ${body.choices[0].finish_reason}); raise MAX_COMPLETION_TOKENS`);
      const v = JSON.parse(txt);
      return {
        id: p.id, title: p.title,
        verdict: v[PROFILE.key] === true,
        confidence: v.confidence ?? 'unknown',
        reason: v.reason ?? '',
        usage: body.usage,
      };
    } catch (e) {
      if (attempt === 2) return { id: p.id, title: p.title, error: String(e.message).slice(0, 160) };
    }
  }
}

(async () => {
  const out = [];
  let done = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = await Promise.all(targets.slice(i, i + CONCURRENCY).map(judge));
    out.push(...batch);
    done += batch.length;
    process.stderr.write(`  judged ${done}/${targets.length}\r`);
  }
  process.stderr.write('                          \r');

  const ok = out.filter((r) => !r.error);
  const errs = out.filter((r) => r.error);
  const yes = ok.filter((r) => r.verdict);
  const no = ok.filter((r) => !r.verdict);

  console.log(`=== verdicts (${PROFILE.key}) ===`);
  console.log(`  suitable      ${yes.length}`);
  console.log(`  NOT suitable  ${no.length}`);
  if (errs.length) console.log(`  errored       ${errs.length}`);

  // Print the SUITABLE ones in full when spot-checking rides: on this block a
  // "yes" is the surprising answer and the one worth auditing by hand.
  const show = ALL ? no.slice(0, 25) : yes;
  console.log(`\n=== ${ALL ? 'ruled out (first 25)' : 'judged SUITABLE — audit these by hand'} ===`);
  for (const r of show) {
    console.log(`  [${r.confidence}] ${r.title.slice(0, 62)}`);
    console.log(`        ${r.reason}`);
  }
  if (!ALL && !yes.length) console.log('  (none — every off-road product was ruled out)');

  for (const e of errs) console.log(`  ERROR ${e.title.slice(0, 50)}: ${e.error}`);

  const tokIn = ok.reduce((s, r) => s + (r.usage?.prompt_tokens ?? 0), 0);
  const tokOut = ok.reduce((s, r) => s + (r.usage?.completion_tokens ?? 0), 0);
  console.log(`\ntokens: ${tokIn} in / ${tokOut} out  (price per token is on your OpenAI billing page; this tool does not guess it)`);

  const path = `${process.cwd()}/docs/map/judged-${PROFILE.key}${ALL ? '' : '-rides'}.json`;
  writeFileSync(path, JSON.stringify({
    judgedAt: new Date().toISOString(), model: MODEL, profile: PROFILE.key,
    counts: { suitable: yes.length, not: no.length, errored: errs.length },
    products: out.map(({ usage, ...r }) => r),
  }, null, 2));
  console.log(`evidence written to ${path.replace(process.cwd() + '/', '')}`);
})();
