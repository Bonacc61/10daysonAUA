// viator-cards — returns live Aruba group cards (price/duration/rating/image)
// from the Viator Partner API. Same { groups, items } shape getCatalog() uses,
// so the frontend merges editorial fields by id and falls back to the stub on
// any error. JWT verification stays ON (anon key required) — not a public proxy.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { GROUPS, ARUBA_DESTINATION_ID } from './groups.ts';
import { normalizeProduct } from './normalize.ts';
import { hasKey, ping, searchProducts, searchProductsPaged, freetextSearch, getProduct, getTags } from './viator.ts';

// Max products fetched AND emitted per group (paged, 50/request). Represents
// nearly the full live Aruba inventory (adventure ~105, watersports ~67,
// food ~40, sailing ~233) while bounding payload + latency. Raise to widen.
const PER_GROUP_MAX = 150;

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

    // Live data for curated local-pick matches (rating/image/price/link).
    const localMatches: Record<string, unknown> = {};
    await Promise.all(Object.entries(LOCAL_MATCHES).map(async ([localId, code]) => {
      try {
        const n = normalizeProduct(await getProduct(code));
        localMatches[localId] = {
          rating: n.rating,
          review_count: n.review_count,
          image_url: n.image_url,
          viator_item_url: n.viator_item_url,
          price_usd: n.price_usd,
          duration: n.duration,
        };
      } catch { /* leave unmatched → card stays editorial */ }
    }));

    return json({ groups, items, localMatches, source: 'viator-live' });
  } catch (e) {
    // Frontend falls back to the local stub on any failure.
    return json({ error: String(e) }, 502);
  }
});
