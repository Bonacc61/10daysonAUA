// Thin Viator Partner API v2 client. Key + base come from env (never bundled).
import type { ViatorProduct } from './normalize.ts';

const KEY = (Deno.env.get('VIATOR_API_KEY_PRODUCTION') ?? Deno.env.get('VIATOR_API_KEY') ?? '').trim();
const BASE = (Deno.env.get('VIATOR_BASE_URL') ?? 'https://api.viator.com/partner').replace(/\/$/, '');

function headers() {
  return {
    'exp-api-key': KEY,
    'Accept': 'application/json;version=2.0',
    'Accept-Language': 'en-US',
    'Content-Type': 'application/json',
  };
}

export function hasKey(): boolean {
  return KEY.length > 0;
}

// Cheap authenticated call for the health op.
export async function ping(): Promise<{ ok: boolean; status: number }> {
  const r = await fetch(`${BASE}/products/tags`, { headers: headers() });
  // Drain the body so the connection is freed.
  await r.text();
  return { ok: r.ok, status: r.status };
}

// Free-text product search scoped to a destination — used to match a local
// editorial pick (by name) to its closest real Viator product.
export async function freetextSearch(term: string, destinationId: number, count: number): Promise<ViatorProduct[]> {
  const r = await fetch(`${BASE}/search/freetext`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      searchTerm: term,
      searchTypes: [{ searchType: 'PRODUCTS', pagination: { start: 1, count } }],
      productFiltering: { destination: String(destinationId) },
      currency: 'USD',
    }),
  });
  if (!r.ok) throw new Error(`Viator freetext ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const body = await r.json();
  return body?.products?.results ?? body?.products ?? [];
}

// Single product by code — live detail for a curated local-pick match.
export async function getProduct(code: string): Promise<ViatorProduct> {
  const r = await fetch(`${BASE}/products/${encodeURIComponent(code)}`, { headers: headers() });
  if (!r.ok) throw new Error(`Viator product ${code} ${r.status}`);
  return await r.json();
}

export type SearchResult = { products: ViatorProduct[]; totalCount: number };

export async function searchProducts(
  destinationId: number,
  tagIds: number[],
  count: number,
): Promise<SearchResult> {
  const r = await fetch(`${BASE}/products/search`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      filtering: { destination: String(destinationId), tags: tagIds },
      sorting: { sort: 'TRAVELER_RATING', order: 'DESCENDING' },
      pagination: { start: 1, count },
      currency: 'USD',
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Viator search ${r.status}: ${text.slice(0, 200)}`);
  }
  const body = await r.json();
  return { products: body?.products ?? [], totalCount: body?.totalCount ?? 0 };
}
