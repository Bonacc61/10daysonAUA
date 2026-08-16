// search — ranks the catalog by what a query MEANS, not how it is spelled.
//
// The traveller's words are turned into a vector and compared against the
// product vectors viator-cards stores at ingest. This function returns ids and
// scores; no embedding ever reaches the browser, and the ranking itself happens
// in Postgres (see search_items in the migration).
//
// It does NOT replace substring search. The client runs that locally on every
// keystroke and puts its hits first — semantic results are appended below.
// Similarity blurs exactly the distinctions proper nouns depend on, so a
// traveller typing "Arikok" is better served by the substring layer, and that
// layer is permanently load-bearing rather than a transitional fallback.
//
// JWT verification stays ON (anon key required) — not a public proxy.
//
// PRIVACY: the query is text a traveller typed and can contain personal data.
// It is never logged, never stored, and never echoed into an error. The cache
// is keyed on a SHA-256 of the normalised query, never the text — a table of
// query strings would be a search-history log and would need its own legal
// basis; a table of hashes is not one.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { embedBatch, activeProvider, MODEL_ID, isSearchableProvider } from '../viator-cards/embeddings.ts';
import { parseConstraint, forStorage, type ParsedConstraint, type StoredConstraint } from './parse.ts';

// Layer 2 is OFF unless a secret says otherwise, so deploying this function is
// inert. Enabling it costs a model call per NEW phrasing and changes what
// results a traveller sees, which makes it a decision rather than a deploy —
// the same footing as the VITE_ flags, one layer down. Rollback is unsetting it.
// THREE STATES, and the body field is not one of them.
//
//   unset    the parse cannot run at all, for anyone
//   'probe'  off for ordinary traffic; honoured ONLY for a request that asks
//   'on'     on for everyone
//
// `{parse: true}` alone used to be enough, which handed a switch the operator
// had deliberately left dark to any caller — and VITE_SUPABASE_ANON_KEY is
// intentionally public, so "any caller" means anyone with the bundle. It also
// made "rollback is unsetting the secret" false. .claude/CLAUDE.md is explicit
// that turning an AI feature on is a legal decision rather than a technical
// one; a request body must not be able to take it.
const PARSE_MODE = Deno.env.get('SEARCH_PARSE') ?? '';
const PARSE_ENABLED = PARSE_MODE === 'on';
const PARSE_PROBEABLE = PARSE_MODE === 'probe';

const MAX_QUERY = 200;
const MATCH_COUNT = 30;
const FEATURE = 'search';         // discriminator: edit_requests is shared with itinerary-edit
const RATE_LIMIT_PER_HOUR = 60;   // looser than itinerary-edit: searching is cheaper and more frequent
const DAILY_CEILING = 5000;

// Below this, a result is noise. Cosine similarity on short-query-to-product
// text rarely exceeds ~0.5 even for a good match, so this is deliberately low —
// and it is UNMEASURED. tools/run-search-golden.cjs is how it gets tuned; treat
// this value as a starting point, not a finding.
const MIN_SIMILARITY = 0.20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Same shape as itinerary-edit: the last X-Forwarded-For entry (the leftmost is
// client-supplied and hands out a fresh quota per spoofed IP), salted so the
// stored value is a pseudonym rather than a reversible identifier.
async function callerHash(req: Request): Promise<string> {
  const xff = req.headers.get('x-forwarded-for')?.split(',') ?? [];
  const ip = xff[xff.length - 1]?.trim() || 'unknown';
  return await sha256(`ip:${ip}:${Deno.env.get('RATE_LIMIT_SALT')!}`);
}

async function checkLimits(hash: string): Promise<Response | null> {
  const db = admin();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Every count is scoped to this feature. Without that, search traffic burns
  // itinerary-edit's 2000/day ceiling and the swap box returns 503 for everyone
  // for the rest of the day — one feature silently taking out another.
  const { count: mine, error: mineErr } = await db.from('edit_requests')
    .select('*', { count: 'exact', head: true })
    .eq('feature', FEATURE).eq('caller_hash', hash).gte('created_at', hourAgo);
  // FAIL CLOSED. Both counts used to discard `error`, so an outage — or simply
  // deploying this function before the migration that adds `feature` — turned
  // the ceiling off entirely on a paid endpoint behind a public anon key. An
  // unavailable limiter must mean "no", not "yes".
  if (mineErr) {
    console.warn(`[rate-limit] count failed: ${String(mineErr.message ?? '').slice(0, 120)}`);
    return json({ error: 'unavailable' }, 503);
  }
  if ((mine ?? 0) >= RATE_LIMIT_PER_HOUR) return json({ error: 'rate_limited' }, 429);

  const { count: all, error: allErr } = await db.from('edit_requests')
    .select('*', { count: 'exact', head: true })
    .eq('feature', FEATURE).gte('created_at', dayAgo);
  if (allErr || (all ?? 0) >= DAILY_CEILING) return json({ error: 'unavailable' }, 503);

  await db.from('edit_requests').insert({ caller_hash: hash, feature: FEATURE });
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const provider = activeProvider();
  if (!provider) return json({ error: 'not configured' }, 500);
  // Fail closed: without the salt, caller_hash is a bare SHA-256 of an IP and
  // brute-forceable across the whole IPv4 space in seconds.
  if (!Deno.env.get('RATE_LIMIT_SALT')) return json({ error: 'not configured' }, 500);

  // A 512-dim provider cannot be compared against a vector(256) corpus. Refuse
  // rather than rank on a mismatch — the failure mode is confident nonsense,
  // not an error, which is precisely what must not reach a traveller.
  if (!isSearchableProvider(provider)) {
    console.warn(`[search] provider ${provider} cannot rank against a 256-dim corpus`);
    return json({ error: 'model_mismatch' }, 503);
  }
  const model = MODEL_ID[provider];

  let query: string;
  // Per-request opt-in to the parse, so it can be MEASURED before it is
  // switched on for everyone. Without it the only way to find out whether the
  // constraint layer helps would be to enable it globally and then look — i.e.
  // to ship in order to find out.
  //
  // Safe to expose: it buys no capability an attacker does not already have.
  // The same rate limit applies, the cost profile is the cost of the feature
  // itself, and it cannot reach anything the query could not already reach.
  let wantParse = false;
  try {
    const body = await req.json();
    query = String(body?.query ?? '').trim();
    wantParse = body?.parse === true;
  } catch {
    return json({ error: 'bad payload' }, 400);
  }
  if (!query) return json({ error: 'empty' }, 400);
  if (query.length > MAX_QUERY) return json({ error: 'too long' }, 400);

  const parseOn = PARSE_ENABLED || (PARSE_PROBEABLE && wantParse);

  const limited = await checkLimits(await callerHash(req));
  if (limited) return limited;

  const db = admin();
  // Is there a corpus we can actually rank against? BEFORE the embed, not after.
  //
  // `search_items` filters on model in SQL, so a mismatch — and an EMPTY table,
  // which is the guaranteed state until the first catalog refresh after deploy —
  // both return zero rows, indistinguishable from "nothing matched". That would
  // tell the traveller we looked and found nothing when we could not look.
  //
  // Ordering matters for more than tidiness: run this after the embed and every
  // search in that window ships the traveller's free text to a third party and
  // stores a fingerprint of it, for a request that can only 503. A transfer with
  // no possible benefit is not covered by the justification the Privacy Policy
  // gives for the cache.
  //
  // Scoped to the ACTIVE model rather than reading an arbitrary row: a single
  // stale row — the window between upsert and delete in viator-cards, or a run
  // whose delete failed — would otherwise 503 a perfectly good corpus.
  const { data: corpus, error: corpusErr } = await db
    .from('item_embeddings').select('item_id').eq('model', model).limit(1).maybeSingle();
  if (corpusErr) {
    console.warn(`[search] corpus probe failed: ${String(corpusErr.message ?? '').slice(0, 120)}`);
    return json({ error: 'upstream' }, 502);
  }
  if (!corpus) {
    console.warn(`[search] no item_embeddings rows for model ${model} — catalog refresh since deploy?`);
    return json({ error: 'no_corpus' }, 503);
  }


  // Normalise before hashing so "Snorkeling " and "snorkeling" share a cache
  // entry — travel searches repeat heavily and a hit costs no third-party call.
  //
  // SALTED, for the same reason callerHash is: an unsalted SHA-256 of a search
  // phrase is not a pseudonym. The plaintext space for a travel search box is
  // tiny and enumerable — tools/search-golden.json is literally a dictionary of
  // the likely inputs — so a wordlist would recover most of this table in
  // seconds, and the migration's claim that "a table of hashes is not a
  // search-history log" would be false.
  const normalised = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const hash = await sha256(`q:${normalised}:${Deno.env.get('RATE_LIMIT_SALT')}`);

  let vector: number[] | null = null;
  let constraint: ParsedConstraint | null = null;
  try {
    const { data: cached } = await db.from('query_embeddings')
      .select('embedding, model, parsed_constraint').eq('query_hash', hash).maybeSingle();
    // A cached vector from a different model is ignored, never reused.
    if (cached?.model === model && cached.embedding) {
      vector = typeof cached.embedding === 'string' ? JSON.parse(cached.embedding) : cached.embedding;
      // The stored shape has NO residual — see the upsert below. `residual` is
      // only ever needed to decide what to embed, and on a cache hit that is
      // already decided, so '' here is not a loss.
      const stored = parseOn ? (cached.parsed_constraint as StoredConstraint | null) ?? null : null;
      constraint = stored ? { ...stored, residual: '' } : null;
    }
    // THE CACHE HOLDS ONE OF TWO INCOMPATIBLE THINGS, and a row is only usable
    // by the mode that wrote it. A parsed search embeds the RESIDUAL; an
    // unparsed one embeds the WHOLE query. Crossing them is silently wrong in
    // both directions:
    //
    //   parsed request, unparsed row   -> whole-query vector, no constraint
    //   unparsed request, parsed row   -> residual vector, constraint ignored
    //
    // The second matters because `parse: true` is a per-request opt-in used for
    // measurement: without this, measuring would quietly change what ordinary
    // traffic gets ranked by. Either mismatch counts as a MISS and is recomputed.
    if (parseOn && vector && !constraint) vector = null;
    if (!parseOn && vector && cached?.parsed_constraint) vector = null;
  } catch { /* a cache miss and a cache failure are the same thing here */ }

  // Parse BEFORE embedding, because what gets embedded depends on the answer:
  // a query the constraints fully describe has nothing left to rank by, and
  // asks the provider nothing at all.
  if (parseOn && !vector) {
    constraint = await parseConstraint(normalised);
  }
  const toEmbed = constraint ? constraint.residual.trim() : normalised;

  // A FULLY COMPILED QUERY ASKS NOTHING. Every word was a concept, so the
  // constraints already say what it meant: no provider call, no rate-limit cost,
  // no cache row, and the traveller's text never leaves this function. The
  // client filters its own catalog by the constraint and has nothing to rank.
  // `!vector` matters: with a cached vector there IS something to rank, and the
  // stored constraint carries no residual, so without this guard a cache hit
  // would return an empty result set for a query that had perfectly good ids.
  if (constraint && !toEmbed && !vector) {
    console.log(`[search] compiled whole: must=${constraint.must} mustNot=${constraint.mustNot}`);
    return json({ results: [], constraint: forStorage(constraint) });
  }

  if (!vector) {
    try {
      // The NORMALISED string, so the cache key and the stored vector describe
      // the same input — otherwise whichever casing arrived first would decide
      // the vector every later variant gets. When a constraint was parsed this
      // is its residual, which is a SUBSET of those same words, never more.
      const [v] = await embedBatch([toEmbed]);
      if (!v) throw new Error('empty embedding');
      vector = v;
      // Store the vector against the hash. THE TEXT IS NEVER WRITTEN, and that
      // required care rather than intent: `residual` is BY CONSTRUCTION a subset
      // of the words the traveller typed, and when nothing is recognised
      // `sanitise` hands back the WHOLE query as the residual — so persisting
      // the constraint whole would have put "my mother uses a walker" in a
      // database column for 30 days. Only the closed-vocabulary halves are
      // stored, which is what Privacy.tsx describes and what the invariant in
      // .claude/CLAUDE.md requires.
      //
      // Written UNCONDITIONALLY, null included. PostgREST's merge-duplicates
      // upsert only touches columns present in the payload, so omitting the key
      // on the unparsed path left a STALE constraint beside a fresh whole-query
      // vector — a pairing both miss-checks above would then wave through.
      await db.from('query_embeddings')
        .upsert({
          query_hash: hash, embedding: JSON.stringify(v), model,
          parsed_constraint: constraint ? forStorage(constraint) : null,
        }, { onConflict: 'query_hash' });
    } catch (e) {
      // Name only — an embedding provider's error body can quote the input back.
      console.warn(`[search] embed failed: ${e instanceof Error ? e.name : 'error'}`);
      return json({ error: 'upstream' }, 502);
    }
  }

  const { data, error } = await db.rpc('search_items', {
    query_embedding: JSON.stringify(vector),
    query_model: model,
    match_count: MATCH_COUNT,
    min_similarity: MIN_SIMILARITY,
  });
  if (error) {
    console.warn(`[search] rank failed: ${String(error.message ?? '').slice(0, 120)}`);
    return json({ error: 'upstream' }, 502);
  }

  const results = (data ?? []).map((r: { item_id: string; similarity: number }) => ({
    id: r.item_id, score: r.similarity,
  }));
  // Count and the PARSED CONSTRAINT — never the words. A constraint is a derived
  // result over a closed vocabulary, which is the same line itinerary-edit
  // draws: it logs the parse, not the sentence.
  console.log(`[search] ${results.length} results${constraint ? ` must=${constraint.must} mustNot=${constraint.mustNot}` : ''}`);
  return json(constraint ? { results, constraint: forStorage(constraint) } : { results });
});
