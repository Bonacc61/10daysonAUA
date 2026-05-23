// viator-cards — returns live Aruba group cards (price/duration/rating/image)
// from the Viator Partner API. Same { groups, items } shape getCatalog() uses,
// so the frontend merges editorial fields by id and falls back to the stub on
// any error. JWT verification stays ON (anon key required) — not a public proxy.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { GROUPS, ARUBA_DESTINATION_ID } from './groups.ts';
import { normalizeProduct } from './normalize.ts';
import { hasKey, ping, searchProducts } from './viator.ts';

const SEARCH_COUNT = 24; // candidates fetched per group (room to backfill after de-dup)
const EMIT_CAP = 8;      // cards emitted per group

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
      const { products, totalCount } = await searchProducts(ARUBA_DESTINATION_ID, [g.tagIds[0]], SEARCH_COUNT);

      const groupItems = products
        .map(normalizeProduct)
        .filter((it) => it.id && !seen.has(it.id))
        .slice(0, EMIT_CAP);

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

    return json({ groups, items, source: 'viator-live' });
  } catch (e) {
    // Frontend falls back to the local stub on any failure.
    return json({ error: String(e) }, 502);
  }
});
