// Page identity for the hand-rolled router, extracted from App.tsx so that
// non-React code can import it. `src/lib/head.ts` needs the path table, and a
// node-environment test cannot import App.tsx without evaluating React and the
// whole lazy-route graph.
//
// App.tsx re-exports PageId so existing `import type { PageId } from '../App'`
// call sites (Explore, Questionnaire, SurpriseMe, DashboardPreview, Stats) keep
// working untouched.

export type PageId =
  | 'landing' | 'questionnaire' | 'explore' | 'itinerary' | 'map'
  | 'privacy' | 'terms' | 'surprise' | 'dashboard' | 'preview' | 'stats';

export const PAGE_TO_PATH: Record<PageId, string> = {
  landing: '/',
  questionnaire: '/questionnaire',
  explore: '/explore',
  itinerary: '/itinerary',
  map: '/map',
  privacy: '/privacy',
  terms: '/terms',
  surprise: '/surprise',
  dashboard: '/dashboard',
  preview: '/preview',
  stats: '/stats',
};

export const PATH_TO_PAGE: Record<string, PageId> = {
  '/explore': 'explore',
  '/itinerary': 'itinerary',
  '/map': 'map',
  '/questionnaire': 'questionnaire',
  '/privacy': 'privacy',
  '/terms': 'terms',
  '/surprise': 'surprise',
  '/dashboard': 'dashboard',
  '/preview': 'preview',
  '/stats': 'stats',
};

// Pages whose content belongs to one traveller, or is the operator's own
// dashboard. These get `noindex` — never a robots.txt Disallow, because a
// robots-blocked URL can still be indexed by reference, and blocking it stops
// the crawler ever reading the noindex that would have excluded it.
export const PRIVATE_PAGES: readonly PageId[] = [
  'itinerary', 'map', 'dashboard', 'preview', 'stats',
] as const;
