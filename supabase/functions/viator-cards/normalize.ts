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
  tags: number[];
};

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
    viator_item_url: p.productUrl ?? '',
    tags: p.tags ?? [],
  };
}
