// Per-route <head>. Until this existed, all 11 routes shared the one title and
// description baked into index.html, so a crawler saw one page repeated.
//
// This module is PURE — it computes metadata and nothing else. The DOM writer
// lives in `applyHead` (added in the next task) so the table itself stays
// testable in the node environment.

import { PAGE_TO_PATH, PRIVATE_PAGES, type PageId } from './pages';

export const ORIGIN = 'https://10daysonaruba.com';

export type PageMeta = {
  title: string;
  description: string;
  canonical: string;
  /** false → emit <meta name="robots" content="noindex, follow">. */
  index: boolean;
};

// Descriptions are capped at 160 characters: past that Google truncates, and a
// truncated sentence reads worse than a short one. The test enforces it.
const COPY: Record<PageId, { title: string; description: string }> = {
  landing: {
    title: '10 days on Aruba — Build your perfect itinerary',
    description: 'Plan your Aruba trip in 8 questions and get a day-by-day itinerary you can tweak, save and share. Free, no sign-up.',
  },
  questionnaire: {
    title: 'Plan your Aruba trip — 8 quick questions',
    description: 'Tell us how you travel: how long, who with, and what you would rather skip. We build the day-by-day plan around the answers.',
  },
  explore: {
    title: 'Things to do in Aruba — beaches, boat trips and tours',
    description: 'Browse hundreds of Aruba activities: beaches, snorkel trips, sunset sails, 4x4 tours and the local spots most guides leave out.',
  },
  itinerary: {
    title: 'Your Aruba itinerary',
    description: 'Your day-by-day Aruba plan — reorder it, swap activities, and share it with whoever you are travelling with.',
  },
  map: {
    title: 'Your Aruba trip map',
    description: 'Every activity in your itinerary on one map of Aruba, day by day, so you can see what sits near what.',
  },
  privacy: {
    title: 'Privacy Policy — 10 days on Aruba',
    description: 'What we collect, why, and how to opt out. Written for the GDPR, in plain language rather than legalese.',
  },
  terms: {
    title: 'Terms of Use — 10 days on Aruba',
    description: 'The terms that apply to using this Aruba trip planner, including how affiliate links work and what we do not promise.',
  },
  surprise: {
    title: 'Surprise me — a random Aruba day plan',
    description: 'Not sure what you want? Get a complete Aruba day built at random from the same catalogue the planner uses.',
  },
  dashboard: {
    title: 'Your saved Aruba itineraries',
    description: 'Every Aruba itinerary you have saved to your account, ready to open, rename, duplicate or delete.',
  },
  preview: {
    title: 'Saved itineraries — preview',
    description: 'A preview of what saving an Aruba itinerary to an account gives you, before you decide to create one.',
  },
  stats: {
    title: 'Traffic — 10 days on Aruba',
    description: 'The operator dashboard for this site: visitors, referrers and clicks out to booking partners. Not a public page.',
  },
};

const PRIVATE = new Set<PageId>(PRIVATE_PAGES);

export function pageMeta(page: PageId): PageMeta {
  const { title, description } = COPY[page];
  return {
    title,
    description,
    canonical: ORIGIN + PAGE_TO_PATH[page],
    index: !PRIVATE.has(page),
  };
}

/**
 * A shared itinerary at /i/<id>.
 *
 * NEVER indexable. The URL is public and guessable-ish, and the page holds one
 * traveller's trip — `specialNotes` is stripped by src/lib/shares.ts, but a
 * plan tied to a shareable link still has no business in a search index. The id
 * is deliberately kept out of the title and description too, so it cannot leak
 * through a link preview.
 */
export function sharedItineraryMeta(shareId: string): PageMeta {
  return {
    title: 'A shared Aruba itinerary',
    description: 'Someone shared their day-by-day Aruba plan with you. Open it to see the trip, or build your own.',
    canonical: `${ORIGIN}/i/${shareId}`,
    index: false,
  };
}

/**
 * Write a PageMeta into <head>. Idempotent: reuses the tags index.html already
 * ships rather than appending duplicates, and REMOVES the robots tag when the
 * page is indexable — without that, one visit to /itinerary would leave the
 * noindex in place for every subsequent client-side navigation in the session.
 */
export function applyHead(meta: PageMeta): void {
  document.title = meta.title;

  upsertMeta('description', meta.description);

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = meta.canonical;

  const robots = document.head.querySelector('meta[name="robots"]');
  if (meta.index) {
    robots?.remove();
  } else {
    // "follow" on purpose: exclude the page, still let its links pass equity.
    upsertMeta('robots', 'noindex, follow');
  }
}

function upsertMeta(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}
