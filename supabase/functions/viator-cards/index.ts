// viator-cards — returns live Aruba group cards (price/duration/rating/image)
// from the Viator Partner API. Same { groups, items } shape getCatalog() uses,
// so the frontend merges editorial fields by id and falls back to the stub on
// any error. JWT verification stays ON (anon key required) — not a public proxy.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { GROUPS, ARUBA_DESTINATION_ID } from './groups.ts';
import { normalizeProduct } from './normalize.ts';
import { hasKey, ping, searchProducts, searchProductsPaged, freetextSearch, getProduct, getTags } from './viator.ts';
import { embedBatch, clusterByEmbedding, activeProvider, MODEL_ID, isSearchableProvider } from './embeddings.ts';
// suitability.ts / suitabilityData.ts are NOT imported: the corpus they build
// was deployed, measured at 63% against a 66% baseline, and reverted. They stay
// on disk as measurement infrastructure for the next variant — see the note in
// the embedding block below, and the spec.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function supabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function readCache(): Promise<{ payload: unknown; cachedAt: Date } | null> {
  try {
    const { data } = await supabaseAdmin()
      .from('catalog_cache')
      .select('payload, cached_at')
      .eq('id', 'main')
      .single();
    if (!data) return null;
    return { payload: data.payload, cachedAt: new Date(data.cached_at) };
  } catch { return null; }
}

async function writeCache(payload: unknown): Promise<void> {
  try {
    await supabaseAdmin()
      .from('catalog_cache')
      .upsert({ id: 'main', payload, cached_at: new Date().toISOString() });
  } catch { /* non-fatal */ }
}

// Max products fetched AND emitted per group (paged, 50/request). Represents
// nearly the full live Aruba inventory (adventure ~105, watersports ~67,
// food ~40, sailing ~233) while bounding payload + latency. Raise to widen.
const PER_GROUP_MAX = 400;

// Curated matches: local editorial pick id → real Viator product code. The card
// keeps its editorial title/blurb but pulls rating/image/price/link from this product.
const LOCAL_MATCHES: Record<string, string> = {
  'boca-catalina-snorkel': '8936P1',          // Arusun Catamaran Sail w/ Snorkeling
  'antilla-wreck-dive':    '2785AFTSNORKEL',  // Antilla Shipwreck & Catalina Bay Snorkel Sail
  'natural-pool-jeep':     '6841POOL',        // Natural Pool & Indian Cave Jeep Safari
  'oranjestad-walking':    '62666P1',         // Downtown Historic & Cultural Walking Tour
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!hasKey()) return json({ error: 'VIATOR_API_KEY_PRODUCTION not set' }, 500);

  const op = new URL(req.url).searchParams.get('op');
  if (op === 'health') {
    try { return json(await ping()); }
    catch (e) { return json({ ok: false, error: String(e) }, 502); }
  }
  // TEMPORARY (taxonomy build): dump Viator tag tree (id → name → parents).
  if (op === 'taxonomy') {
    try {
      const tags = await getTags();
      return json(tags.map((t) => ({ id: t.tagId, name: t.allNamesByLocale?.en ?? '', parents: t.parentTagIds ?? [] })));
    } catch (e) { return json({ error: String(e) }, 502); }
  }
  // TEMPORARY: find the best Viator product match for each bookable local pick.
  if (op === 'match') {
    const queries: Array<{ localId: string; q: string }> = [
      { localId: 'boca-catalina-snorkel', q: 'Boca Catalina snorkel' },
      { localId: 'antilla-wreck-dive',    q: 'Antilla shipwreck snorkel dive' },
      { localId: 'arikok-hiking',         q: 'Arikok National Park hike' },
      { localId: 'natural-pool-jeep',     q: 'Natural Pool Conchi jeep' },
      { localId: 'kitesurfing-lesson',    q: 'kitesurfing lesson' },
      { localId: 'baby-beach-snorkel',    q: 'Baby Beach snorkel' },
      { localId: 'flamingo-renaissance',  q: 'flamingo island' },
      { localId: 'oranjestad-walking',    q: 'Oranjestad walking tour' },
    ];
    const out: Record<string, unknown> = {};
    await Promise.all(queries.map(async ({ localId, q }) => {
      try {
        const res = await freetextSearch(q, ARUBA_DESTINATION_ID, 2);
        out[localId] = res.map(normalizeProduct).map((n) => ({ id: n.id, title: n.title, price: n.price_usd, rating: n.rating, reviews: n.review_count }));
      } catch (e) { out[localId] = { error: String(e) }; }
    }));
    return json(out);
  }
  // TEMPORARY: report Aruba inventory count per candidate anchor tag.
  if (op === 'counts') {
    const candidates = [22046,13126,12035,21421,21704,13143,11973,11902,12038, 13142,11912,12021,12062,12047,11974,13209,13202,20255, 21701,11885,11888,12979,11963,12691, 21911,12694,21567,13283,11891,11953,13284,12053];
    const counts: Record<number, number> = {};
    await Promise.all(candidates.map(async (t) => {
      try { counts[t] = (await searchProducts(ARUBA_DESTINATION_ID, [t], 1)).totalCount; }
      catch { counts[t] = -1; }
    }));
    return json(counts);
  }

  // Serve from cache if fresh enough, stale cache as fallback on Viator failure.
  //
  // `op=refresh` bypasses it. Added 2026-08-12 because there was no operator
  // control at all over a 6-hour cache: after the item_embeddings migration
  // landed, the embedding corpus stayed empty and the only way to fill it was to
  // wait for the TTL to expire and hope a visitor arrived. `search` refuses with
  // no_corpus until it is populated, so "wait up to six hours" was the entire
  // recovery procedure.
  //
  // Cost of a refresh is one Viator round-trip plus one embedding pass over the
  // catalog (~366 items, fractions of a cent). It is exposed on the same footing
  // as the existing `counts` / `taxonomy` / `match` ops, which also hit Viator —
  // so this adds no new class of exposure, but see docs/ROADMAP.md: none of them
  // is rate-limited, and that is worth closing as a group rather than one-off.
  const cached = await readCache();
  if (op !== 'refresh' && cached && (Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS)) {
    return json({ ...(cached.payload as object), source: 'cache' });
  }

  try {
    const groups: unknown[] = [];
    const items: unknown[] = [];
    const seen = new Set<string>(); // de-dupe products across groups (first group wins)

    for (let i = 0; i < GROUPS.length; i++) {
      const g = GROUPS[i];
      // filtering.tags is an AND across all ids, and a parent tag also returns
      // its child-tag products — so search with the single broad anchor (tagIds[0]).
      const { products, totalCount } = await searchProductsPaged(ARUBA_DESTINATION_ID, [g.tagIds[0]], PER_GROUP_MAX);

      const groupItems = products
        .map(normalizeProduct)
        .filter((it) => it.id && !seen.has(it.id));

      let order = 0;
      for (const it of groupItems) {
        seen.add(it.id);
        items.push({
          id: it.id,
          group_id: g.id,
          title: it.title,
          image_url: it.image_url,
          price_usd: it.price_usd,
          duration: it.duration,
          rating: it.rating,
          review_count: it.review_count,
          viator_item_url: it.viator_item_url,
          description: it.description,
          tags: it.tags,
          // Viator's own merchandising flags (LIKELY_TO_SELL_OUT and friends).
          // The item is assembled field-by-field here, so anything added to
          // NormalizedItem has to be listed or it silently never arrives.
          flags: it.flags,
          is_best_seller: order === 0,
          display_order: order,
        });
        order++;
      }

      groups.push({
        id: g.id,
        name: g.name,
        tagline: `${totalCount} options on Aruba`,
        viator_taxonomy: String(g.tagIds[0]),
        viator_group_url: g.viator_group_url,
        display_order: g.displayOrder,
        matched_by: g.matched_by,
        region: g.region,
        allowed_slots: g.allowed_slots,
      });
    }

    // ── Semantic clustering via embeddings ────────────────────────────────────
    // Assigns each item an experience_cluster_id. Items sharing a cluster
    // represent the same real-world experience (e.g. two Natural Pool jeep-safari
    // listings from different operators). Clusters are sorted by rating desc so
    // the highest-rated product is always the cluster founder (its id becomes the
    // cluster id). The generator uses cluster ids — not raw vectors — to prevent
    // placing semantically identical items in the same plan.
    // Falls back silently when no embedding provider is configured.
    // Cosine threshold for "same real-world experience". Measured on the live
    // catalog: two Natural-Pool jeep safaris embed at ~0.83 and two sunset dinner
    // cruises at ~0.89 (should merge), while genuinely different activities — a
    // private charter vs a party cruise, a charter vs a jeep — sit at ~0.56–0.60
    // (must stay apart). 0.82 sits just under the jeep pair so union-find merges
    // it, while staying high enough to avoid chaining unrelated products.
    const EMBEDDING_CLUSTER_THRESHOLD = 0.82;
    const provider = activeProvider();
    if (provider) {
      try {
        type Row = Record<string, unknown>;
        // Sort descending by rating so the best item founds each cluster.
        const sorted = [...(items as Row[])].sort(
          (a, b) => (b.rating as number) - (a.rating as number),
        );
        const texts = sorted.map(
          (it) => `${it.title}. ${String(it.description ?? '')}`.slice(0, 500),
        );
        const embeddings = await embedBatch(texts);
        const ids = sorted.map((it) => String(it.id));
        const clusters = clusterByEmbedding(ids, embeddings, EMBEDDING_CLUSTER_THRESHOLD);
        // Write cluster ids back onto the original items array (order-independent).
        const clusterById = new Map(sorted.map((it, i) => [String(it.id), clusters.get(ids[i])!]));
        for (const it of items as Row[]) {
          it.experience_cluster_id = clusterById.get(String(it.id)) ?? String(it.id);
        }
        const nClusters = new Set(clusters.values()).size;
        console.log(`[viator-cards] ${provider}: ${(items as Row[]).length} items → ${nClusters} experience clusters`);

        // ── Persist the vectors for semantic search ────────────────────────
        // Never added to the payload — no vector reaches the browser.
        //
        // WHAT IS EMBEDDED, and why it is written down: NOT the clustering text
        // above. Search embeds `searchText()` — title + description + the
        // product's own suitability lines from ./suitabilityData.ts. The search
        // function embeds queries into the SAME space, so changing this
        // composition silently degrades ranking without failing anything.
        //
        // Why a SECOND embedding pass rather than reusing `embeddings`:
        // clustering asks "is this the same product", search asks "does this
        // suit me", and they want different text. The suitability lines are
        // shared boilerplate — 234 of 328 products say "Suitable for all
        // physical fitness levels" — so folding them into the clustering text
        // would make every listing more alike and destabilise
        // EMBEDDING_CLUSTER_THRESHOLD, which is measured and load-bearing for
        // plan variety. The extra pass costs ~$0.001 per refresh.
        //
        // Only the 256-dim provider is storable: the column is vector(256).
        // Under Voyage (512) we skip and say so, rather than corrupting the
        // table — a mixed-model table makes cosine similarity meaningless.
        if (!isSearchableProvider(provider)) {
          console.warn(`[viator-cards] embeddings not stored: provider ${provider} is not the 256-dim one; semantic search will report a model mismatch`);
        } else {
          try {
            const db = supabaseAdmin();
            const runStart = new Date().toISOString();
            // REVERTED 2026-08-15 — the suitability corpus was DEPLOYED AND
            // MEASURED, and it made recall WORSE: 63% against the 66% baseline
            // (`node tools/run-search-golden.cjs`). Not a deploy accident and
            // not a composition bug — the text was exactly what the spec
            // described. The hypothesis was wrong.
            //
            // What the numbers say went wrong: the added lines are dominated by
            // boilerplate — "Suitable for all physical fitness levels" is on
            // 234 of 327 products, the three "Not recommended for…" lines on
            // 163-180 each — so appending them pulled every vector toward a
            // common centroid instead of separating them. The signature is in
            // the result set: "good with toddler" went from 9 distinct
            // experience clusters in its 30 results to 5, i.e. MORE
            // near-duplicates, and two name queries that used to work
            // ("Zeerover", "kitesurfing") dropped to 0/1.
            //
            // The composer, the probe and the snapshot are kept: they are
            // measurement infrastructure and the next variant needs them. The
            // untried variant is to keep only the DISCRIMINATIVE lines — the
            // stroller (116), infant-seat (50) and wheelchair (37) strings —
            // and drop anything carried by more than ~60% of the catalog. See
            // docs/superpowers/specs/2026-08-14-search-corpus-suitability-design.md.
            const rows = sorted.map((it, i) => ({
              item_id: String(it.id),
              embedding: JSON.stringify(embeddings[i]),   // pgvector accepts the JSON array form
              model: MODEL_ID[provider],
              updated_at: new Date().toISOString(),
            }));
            const { error: upErr } = await db.from('item_embeddings').upsert(rows, { onConflict: 'item_id' });
            if (upErr) throw upErr;

            // Drop rows for products that have left the catalog, so the table
            // cannot grow without bound as Viator's inventory churns.
            //
            // By timestamp, not by an id list: 328 quoted ids is a ~6KB query
            // string already, and the migration's own comment says this table is
            // expected to grow. Everything the upsert just touched has
            // updated_at >= runStart; anything older is gone from the feed. This
            // also clears rows written by a previous model for free.
            const { error: delErr } = await db.from('item_embeddings')
              .delete().lt('updated_at', runStart);
            if (delErr) throw delErr;

            console.log(`[viator-cards] stored ${rows.length} embeddings (${MODEL_ID[provider]})`);
          } catch (e) {
            // Non-fatal, exactly as writeCache is: a storage failure must never
            // cost the traveller their catalog.
            console.warn(`[viator-cards] embedding store failed: ${String(e).slice(0, 160)}`);
          }
        }
      } catch (e) {
        console.warn(`[viator-cards] embedding clustering skipped (${provider}): ${String(e).slice(0, 160)}`);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Live data for curated local-pick matches (rating/image/price/link).
    const localMatches: Record<string, unknown> = {};
    await Promise.all(Object.entries(LOCAL_MATCHES).map(async ([localId, code]) => {
      try {
        const n = normalizeProduct(await getProduct(code));
        localMatches[localId] = {
          title: n.title,
          rating: n.rating,
          review_count: n.review_count,
          image_url: n.image_url,
          viator_item_url: n.viator_item_url,
          price_usd: n.price_usd,
          duration: n.duration,
          // The product's own Overview. A matched pick adopts the product's
          // TITLE, so its card is read as that product — and without this it
          // would show the editorial blurb written about the free local spot
          // under a heading naming a commercial operator's tour.
          description: n.description,
        };
      } catch { /* leave unmatched → card stays editorial */ }
    }));

    const payload = { groups, items, localMatches };
    await writeCache(payload);
    return json({ ...payload, source: 'viator-live' });
  } catch (e) {
    // Serve stale cache rather than failing completely.
    if (cached) return json({ ...(cached.payload as object), source: 'cache-stale' });
    return json({ error: String(e) }, 502);
  }
});
