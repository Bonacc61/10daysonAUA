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
  return await sha256(`${ip}:${Deno.env.get('RATE_LIMIT_SALT')!}`);
}

async function checkLimits(hash: string): Promise<Response | null> {
  const db = admin();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Every count is scoped to this feature. Without that, search traffic burns
  // itinerary-edit's 2000/day ceiling and the swap box returns 503 for everyone
  // for the rest of the day — one feature silently taking out another.
  const { count: mine } = await db.from('edit_requests')
    .select('*', { count: 'exact', head: true })
    .eq('feature', FEATURE).eq('caller_hash', hash).gte('created_at', hourAgo);
  if ((mine ?? 0) >= RATE_LIMIT_PER_HOUR) return json({ error: 'rate_limited' }, 429);

  const { count: all } = await db.from('edit_requests')
    .select('*', { count: 'exact', head: true })
    .eq('feature', FEATURE).gte('created_at', dayAgo);
  if ((all ?? 0) >= DAILY_CEILING) return json({ error: 'unavailable' }, 503);

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
  try {
    const body = await req.json();
    query = String(body?.query ?? '').trim();
  } catch {
    return json({ error: 'bad payload' }, 400);
  }
  if (!query) return json({ error: 'empty' }, 400);
  if (query.length > MAX_QUERY) return json({ error: 'too long' }, 400);

  const limited = await checkLimits(await callerHash(req));
  if (limited) return limited;

  const db = admin();
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
  const hash = await sha256(`${normalised}:${Deno.env.get('RATE_LIMIT_SALT')}`);

  let vector: number[] | null = null;
  try {
    const { data: cached } = await db.from('query_embeddings')
      .select('embedding, model').eq('query_hash', hash).maybeSingle();
    // A cached vector from a different model is ignored, never reused.
    if (cached?.model === model && cached.embedding) {
      vector = typeof cached.embedding === 'string' ? JSON.parse(cached.embedding) : cached.embedding;
    }
  } catch { /* a cache miss and a cache failure are the same thing here */ }

  if (!vector) {
    try {
      // The NORMALISED string, so the cache key and the stored vector describe
      // the same input — otherwise whichever casing arrived first would decide
      // the vector every later variant gets.
      const [v] = await embedBatch([normalised]);
      if (!v) throw new Error('empty embedding');
      vector = v;
      // Store the vector against the hash. The text is never written.
      await db.from('query_embeddings')
        .upsert({ query_hash: hash, embedding: JSON.stringify(v), model }, { onConflict: 'query_hash' });
    } catch (e) {
      // Name only — an embedding provider's error body can quote the input back.
      console.warn(`[search] embed failed: ${e instanceof Error ? e.name : 'error'}`);
      return json({ error: 'upstream' }, 502);
    }
  }

  // Is there a comparable corpus at all? `search_items` filters on model in SQL,
  // so a mismatch — and an EMPTY table, which is the guaranteed state until the
  // first catalog refresh after deploy — both return zero rows, indistinguishable
  // from "nothing matched". That would tell the traveller we looked and found
  // nothing when we could not look at all.
  const { data: corpus } = await db.from('item_embeddings').select('model').limit(1).maybeSingle();
  if (!corpus) {
    console.warn('[search] item_embeddings is empty — no catalog refresh since deploy?');
    return json({ error: 'no_corpus' }, 503);
  }
  if (corpus.model !== model) {
    console.warn(`[search] corpus model ${corpus.model} != active ${model}`);
    return json({ error: 'model_mismatch' }, 503);
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
  // Count only. Never the words.
  console.log(`[search] ${results.length} results`);
  return json({ results });
});
