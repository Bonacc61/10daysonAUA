// Pure, network-free mapping: a Viator Partner API v2 product → the fields our
// cards need. No Deno/edge imports, so it's unit-testable with vitest.

export type ViatorProduct = {
  productCode: string;
  title: string;
  description?: string;
  images?: Array<{
    isCover?: boolean;
    variants?: Array<{ height: number; width: number; url: string }>;
  }>;
  reviews?: {
    combinedAverageRating?: number;
    totalReviews?: number;
    sources?: Array<{ provider: string; totalCount: number; averageRating: number }>;
  };
  duration?: {
    fixedDurationInMinutes?: number;
    variableDurationFromMinutes?: number;
    variableDurationToMinutes?: number;
  };
  pricing?: { summary?: { fromPrice?: number }; currency?: string };
  productUrl?: string;
  tags?: number[];
};

export type NormalizedItem = {
  id: string;            // productCode
  title: string;
  price_usd: number;     // pricing.summary.fromPrice (rounded)
  currency: string;
  duration: string;      // human label, e.g. "3–4 hrs"
  rating: number;        // reviews.combinedAverageRating (1dp)
  review_count: number;  // reviews.totalReviews
  image_url: string;     // largest cover-image variant
  viator_item_url: string; // productUrl (PID already included by the API)
  description: string;   // short blurb from the product summary (trimmed)
  tags: number[];
};

// Collapse whitespace and trim a product description to a short card blurb.
function shortDescription(d?: string): string {
  if (!d) return '';
  const s = d.replace(/\s+/g, ' ').trim();
  if (s.length <= 200) return s;
  return s.slice(0, 197).replace(/\s+\S*$/, '') + '…';
}

// Minutes → compact hours/minutes label. 180 → "3 hrs", 90 → "1.5 hrs", 45 → "45 min".
function label(min: number): string {
  if (!min || min <= 0) return '';
  if (min < 60) return `${min} min`;
  const h = min / 60;
  const rounded = Number.isInteger(h) ? String(h) : h.toFixed(1);
  return `${rounded} ${h === 1 ? 'hr' : 'hrs'}`;
}

function durationLabel(d: ViatorProduct['duration']): string {
  if (!d) return '';
  if (typeof d.fixedDurationInMinutes === 'number') return label(d.fixedDurationInMinutes);
  const from = d.variableDurationFromMinutes;
  const to = d.variableDurationToMinutes;
  if (typeof from === 'number' && typeof to === 'number') {
    if (from === to) return label(from);
    // Range — drop the unit on the low end if both share it: "3–4 hrs".
    const loH = from / 60, hiH = to / 60;
    if (from >= 60 && to >= 60 && Number.isInteger(loH) && Number.isInteger(hiH)) {
      return `${loH}–${hiH} ${hiH === 1 ? 'hr' : 'hrs'}`;
    }
    return `${label(from)}–${label(to)}`;
  }
  if (typeof from === 'number') return label(from);
  return '';
}

// Largest cover-image variant by width (falls back to first image / any variant).
function coverImage(images: ViatorProduct['images']): string {
  if (!images?.length) return '';
  const cover = images.find((i) => i.isCover) ?? images[0];
  const variants = cover.variants ?? [];
  if (!variants.length) return '';
  return variants.reduce((best, v) => (v.width > best.width ? v : best), variants[0]).url;
}

// Build the canonical Viator product page URL from the product code + title.
// The API's productUrl field uses a "TTD" category-browse format
// (/Aruba/d28-ttd/p-{code}) that lands on a 400-thumbnail page, not the
// individual product. We construct the direct URL instead:
//   https://www.viator.com/tours/Aruba/{slug}/d28-{code}
// and preserve the affiliate params (pid/mcid) from the raw productUrl.
function productPageUrl(code: string, title: string, raw: string): string {
  // Prefer Viator's own canonical product URL from the API: its slug is the one
  // Viator's affiliate routing resolves directly once the pid is attached. A
  // slug we rebuild from the title often differs from Viator's canonical slug
  // and gets bounced to a search page. So reuse the API URL and only normalise
  // the tracking params: drop the API markers, force medium=link, keep pid/mcid.
  try {
    const u = new URL(raw);
    if (/^\/tours\/.+\/d28-/i.test(u.pathname)) {
      u.searchParams.delete('api_version');
      u.searchParams.set('medium', 'link');
      return u.toString();
    }
  } catch { /* fall through to a constructed URL */ }
  // Fallback (raw is a non-product/TTD URL or unparseable): build a /tours/
  // product URL from the title slug + code, carrying any affiliate params.
  let pid: string | null = null;
  let mcid: string | null = null;
  try {
    const ru = new URL(raw);
    pid = ru.searchParams.get('pid');
    mcid = ru.searchParams.get('mcid');
  } catch { /* no params available */ }
  const slug = title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ +/g, '-');
  const u = new URL(`https://www.viator.com/tours/Aruba/${slug}/d28-${code}`);
  if (pid) u.searchParams.set('pid', pid);
  if (mcid) u.searchParams.set('mcid', mcid);
  u.searchParams.set('medium', 'link');
  return u.toString();
}

export function normalizeProduct(p: ViatorProduct): NormalizedItem {
  const rating = p.reviews?.combinedAverageRating ?? 0;
  return {
    id: p.productCode,
    title: p.title,
    price_usd: Math.round(p.pricing?.summary?.fromPrice ?? 0),
    currency: p.pricing?.currency ?? 'USD',
    duration: durationLabel(p.duration),
    rating: Math.round(rating * 10) / 10,
    review_count: p.reviews?.totalReviews ?? 0,
    image_url: coverImage(p.images),
    viator_item_url: productPageUrl(p.productCode, p.title, p.productUrl ?? ''),
    description: shortDescription(p.description),
    tags: p.tags ?? [],
  };
}
