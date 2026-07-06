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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ReviewHighlight = {
  reviewer: string;   // first initial + dot, e.g. "J."
  rating: number;     // 1–5
  quote: string;      // trimmed to ~160 chars
  locale: string;     // language code, e.g. "en"
};

// Fetch top-rated review highlights for a product.
// Requires Full-access tier — Basic-access gets 403.
// Throws { tier: true } on 403 so callers can stop retrying across products.
// Retries up to 2× on 429 with exponential backoff.
export async function getProductReviews(
  productCode: string,
  count = 4,
): Promise<ReviewHighlight[]> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(1500 * (attempt - 1));
    const r = await fetch(`${BASE}/reviews/product`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        productCode,
        provider: 'ALL',
        count,
        start: 1,
        sortBy: 'MOST_HELPFUL_HIGHEST_RATING_FIRST',
        ratings: [4, 5],
      }),
    });
    if (r.status === 403) {
      await r.text(); // drain
      throw Object.assign(
        new Error(`reviews/product 403 for ${productCode}: endpoint not available on current access tier`),
        { tier: true },
      );
    }
    if (r.status === 429) {
      await r.text();
      if (attempt === MAX_ATTEMPTS) throw new Error(`reviews/product rate-limited after ${MAX_ATTEMPTS} attempts`);
      continue;
    }
    if (!r.ok) {
      throw new Error(`reviews/product ${r.status} for ${productCode}: ${(await r.text()).slice(0, 200)}`);
    }
    const body = await r.json();
    const reviews: Record<string, unknown>[] = body?.reviews ?? [];
    return reviews
      .slice(0, count)
      .map((rv) => {
        const raw = String(rv.text ?? rv.reviewText ?? '').trim();
        const quote = raw.length > 160
          ? raw.slice(0, 160).replace(/\s+\S*$/, '') + '…'
          : raw;
        const name = String(rv.userName ?? rv.authorName ?? '');
        return {
          reviewer: name ? name.charAt(0).toUpperCase() + '.' : 'Traveler',
          rating: Number(rv.rating ?? 5),
          quote,
          locale: String(rv.language ?? 'en'),
        };
      })
      .filter((h) => h.quote.length > 20);
  }
  return [];
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
