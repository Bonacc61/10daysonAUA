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
  const cached = await readCache();
  if (cached && (Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS)) {
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
        // These used to be discarded the moment clustering finished, so every
        // refresh paid to compute something it then binned. They are written
        // here, never added to the payload — no vector reaches the browser.
        //
        // WHAT IS EMBEDDED, and why it is written down: `${it.title}. ${it.description}`
        // truncated to 500 chars (see `texts` above). The search function must
        // embed queries into the SAME space, so changing this composition
        // silently degrades ranking without failing anything. If golden-set
        // recall is poor, a trimmed description is the first thing to try —
        // long prose tends to embed to a bland, generic position, which is
        // fine for spotting duplicates and mediocre for search.
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
