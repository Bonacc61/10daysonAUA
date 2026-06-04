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

export type ViatorTag = { tagId: number; parentTagIds?: number[]; allNamesByLocale?: Record<string, string> };

// Full Viator tag taxonomy (id → name → parentTagIds). Used to roll a product's
// tags up to our curated sections.
export async function getTags(): Promise<ViatorTag[]> {
  const r = await fetch(`${BASE}/products/tags`, { headers: headers() });
  if (!r.ok) throw new Error(`Viator tags ${r.status}`);
  const body = await r.json();
  return body?.tags ?? [];
}

export type SearchResult = { products: ViatorProduct[]; totalCount: number };

const PAGE_MAX = 50; // Viator /products/search hard cap on `count` per request

export async function searchProducts(
  destinationId: number,
  tagIds: number[],
  count: number,
  start = 1,
): Promise<SearchResult> {
  const r = await fetch(`${BASE}/products/search`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      filtering: { destination: String(destinationId), tags: tagIds },
      sorting: { sort: 'TRAVELER_RATING', order: 'DESCENDING' },
      pagination: { start, count },
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

// Fetch up to `max` products for a tag by paging (50/request). Page 1 reveals
// totalCount; the remaining pages are fetched in parallel, so wall time is
// ~2 round-trips no matter how many pages are needed.
export async function searchProductsPaged(
  destinationId: number,
  tagIds: number[],
  max: number,
): Promise<SearchResult> {
  const first = await searchProducts(destinationId, tagIds, Math.min(PAGE_MAX, max), 1);
  const target = Math.min(first.totalCount || first.products.length, max);
  const products = [...first.products];

  const starts: number[] = [];
  for (let start = products.length + 1; start <= target; start += PAGE_MAX) starts.push(start);
  if (starts.length) {
    const rest = await Promise.all(
      starts.map((start) => searchProducts(destinationId, tagIds, Math.min(PAGE_MAX, target - start + 1), start)),
    );
    for (const r of rest) products.push(...r.products);
  }
  return { products: products.slice(0, target), totalCount: first.totalCount };
}
