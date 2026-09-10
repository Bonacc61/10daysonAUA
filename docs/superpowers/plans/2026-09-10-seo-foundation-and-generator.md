# SEO Foundation and Content Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing site legible to crawlers (Phase 0), then publish 58 static, data-backed activity pages that no competitor can reproduce (Phase 1).

**Architecture:** Phase 0 adds a `robots.txt`, extracts the router's page/path tables into a React-free module, and gives every route its own `<head>` — including `noindex` on private and shared-itinerary URLs. Phase 1 adds a build-time generator: pure page-building functions live in `src/seo/` (typechecked and unit-tested with the rest of the app), and thin `tools/` CLIs bundle them with esbuild to emit HTML into `dist/` after `vite build`. No React on the generated pages; they link the app's own fingerprinted stylesheet.

**Tech Stack:** TypeScript, Vite 5, vitest (node env unless a file opts into jsdom), esbuild for `tools/` bundling, plain string-template HTML. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-seo-geo-strategy-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include these.

- **Every outbound Viator link carries `pid=P00302487&mcid=42383`.** `viatorLink()` only guarantees `medium=link`; the `pid`/`mcid` come from the canonical URL the edge function serves. The generator therefore ASSERTS this at build time and fails loudly, rather than assuming it.
- **Editorial ratings are never published as platform ratings.** `rating` and `reviewCount` on `ACTIVITIES` are curation weights (`src/data/activities.ts:26`: *"NOT a platform rating… no TripAdvisor or Viator listing backs them"*). They may order pages. They may never be rendered and never appear in JSON-LD.
- **The headline rating is the COMBINED figure** from `combinedBreakdown(id)`, never a per-platform number (`src/data/reviewBreakdown.ts:50`). A per-platform split may appear only as a secondary "where these reviews come from" block, and only when platforms disagree by `>= 0.3`.
- **A URL, once published, is never reused for different content.** Slugs come from `content/slugs.json`, never derived from titles at build time.
- **No build-time network access.** `npm run build` must stay offline and deterministic. Network and API keys live in hand-run `tools/` scripts only.
- **No `aggregateRating` in JSON-LD.** Google's review-snippet rules require ratings the site collected itself.
- **Traveller-typed text never reaches a generated page.** Nothing here reads user data; the constraint is stated so it stays true.
- **Origin is `https://10daysonaruba.com`** (no trailing slash) for all canonical and sitemap URLs.

---

# PHASE 0 — Foundation

Ships value on its own: the existing 11 routes become individually indexable, and private URLs stop being indexable. Stop here safely if Phase 1 is deferred.

---

### Task 1: Extract page identity into a React-free module

`src/lib/head.ts` (Task 3) needs the page→path table, and a node-environment test cannot import `App.tsx` without pulling in React, dnd-kit and mapbox. Extracting the tables is the smallest change that makes both testable.

**Files:**
- Create: `src/lib/pages.ts`
- Create: `src/lib/pages.test.ts`
- Modify: `src/App.tsx:27` (the `PageId` type), `src/App.tsx:54-77` (both map literals)

**Interfaces:**
- Consumes: nothing.
- Produces: `type PageId`, `const PAGE_TO_PATH: Record<PageId, string>`, `const PATH_TO_PAGE: Record<string, PageId>`, `const PRIVATE_PAGES: readonly PageId[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PAGE_TO_PATH, PATH_TO_PAGE, PRIVATE_PAGES, type PageId } from './pages';

describe('page identity tables', () => {
  it('round-trips every page through its path', () => {
    for (const page of Object.keys(PAGE_TO_PATH) as PageId[]) {
      const path = PAGE_TO_PATH[page];
      if (page === 'landing') { expect(path).toBe('/'); continue; }
      expect(PATH_TO_PAGE[path]).toBe(page);
    }
  });

  it('maps every non-landing path back to a page that claims it', () => {
    for (const [path, page] of Object.entries(PATH_TO_PAGE)) {
      expect(PAGE_TO_PATH[page]).toBe(path);
    }
  });

  it('lists exactly the per-traveller pages as private', () => {
    expect([...PRIVATE_PAGES].sort()).toEqual(
      ['dashboard', 'itinerary', 'map', 'preview', 'stats'].sort(),
    );
  });

  it('gives every private page a real path', () => {
    for (const page of PRIVATE_PAGES) expect(PAGE_TO_PATH[page]).toMatch(/^\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pages.test.ts`
Expected: FAIL — `Failed to resolve import "./pages"`.

- [ ] **Step 3: Create the module**

Create `src/lib/pages.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pages.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Point App.tsx at the new module**

In `src/App.tsx`, delete the local `export type PageId = …` declaration and both map literals (`PATH_TO_PAGE` and `PAGE_TO_PATH`), then add near the other `src/lib` imports:

```ts
import { PAGE_TO_PATH, PATH_TO_PAGE, type PageId } from './lib/pages';
// Re-exported so `import type { PageId } from '../App'` keeps resolving in the
// five page components that already do it.
export type { PageId };
```

- [ ] **Step 6: Verify nothing broke**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; the full suite passes with no new failures.

- [ ] **Step 7: Mutation-check the test**

Temporarily change `PAGE_TO_PATH.explore` to `'/explore-x'`, run `npx vitest run src/lib/pages.test.ts`, and confirm it FAILS. Revert.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pages.ts src/lib/pages.test.ts src/App.tsx
git commit -m "refactor(router): extract page/path tables into a React-free module

Needed so head metadata and its node-environment tests can import the path
table without evaluating App.tsx's whole lazy-route graph. App.tsx re-exports
PageId, so the five components importing it are untouched."
```

---

### Task 2: robots.txt with a deliberate AI-crawler policy

**Files:**
- Create: `public/robots.txt`
- Create: `src/seo/robots.test.ts`

**Interfaces:**
- Consumes: `PRIVATE_PAGES` and `PAGE_TO_PATH` from Task 1.
- Produces: a static file Vite copies to `dist/robots.txt`. The existing `.htaccess` rule `RewriteCond %{REQUEST_FILENAME} !-f` passes real files through, so no server change is needed.

- [ ] **Step 1: Write the failing test**

Create `src/seo/robots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRIVATE_PAGES, PAGE_TO_PATH } from '../lib/pages';

const TXT = readFileSync('public/robots.txt', 'utf8');

describe('robots.txt', () => {
  it('allows the default crawler', () => {
    expect(TXT).toMatch(/^User-agent: \*$/m);
    expect(TXT).toMatch(/^Allow: \/$/m);
  });

  it('names the sitemap', () => {
    expect(TXT).toMatch(/^Sitemap: https:\/\/10daysonaruba\.com\/sitemap\.xml$/m);
  });

  // The policy is deliberate: we trade content for citations in AI answers.
  // Listing them explicitly is what makes it a decision rather than a default.
  it.each(['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'])(
    'explicitly allows %s',
    (bot) => {
      const block = TXT.split(/\n(?=User-agent:)/).find((b) => b.includes(`User-agent: ${bot}`));
      expect(block, `no block for ${bot}`).toBeDefined();
      expect(block).toMatch(/^Allow: \/$/m);
      expect(block).not.toMatch(/^Disallow: \//m);
    },
  );

  // Blocking these here would PREVENT the noindex tag from ever being read,
  // which is the opposite of the intent. This test exists to stop a future
  // well-meant "tidy-up" from adding them.
  it('never disallows a private route — those use noindex instead', () => {
    for (const page of PRIVATE_PAGES) {
      expect(TXT).not.toContain(`Disallow: ${PAGE_TO_PATH[page]}`);
    }
    expect(TXT).not.toContain('Disallow: /i/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/seo/robots.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'public/robots.txt'`.

- [ ] **Step 3: Create the file**

Create `public/robots.txt`:

```
# 10daysonaruba.com
#
# Private and per-traveller URLs (/itinerary, /map, /dashboard, /preview,
# /stats, /i/<id>) are deliberately NOT disallowed here. A robots-blocked URL
# can still be indexed by reference, and blocking it guarantees the crawler
# never reads the noindex tag that would have excluded it properly.
# See src/lib/head.ts.

User-agent: *
Allow: /

# AI crawlers — allowed on purpose. This trades content for citations in AI
# answers, which is the point of the GEO half of the strategy. It is a business
# decision, and it is reversible: change Allow to Disallow here.
# Spec: docs/superpowers/specs/2026-09-10-seo-geo-strategy-design.md

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://10daysonaruba.com/sitemap.xml
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/seo/robots.test.ts`
Expected: PASS (8 tests — 3 plus the 5 parameterised bots).

- [ ] **Step 5: Verify the build copies it**

Run: `npm run build && cat dist/robots.txt | head -3`
Expected: the file's first three lines. Vite copies `public/` verbatim.

- [ ] **Step 6: Commit**

```bash
git add public/robots.txt src/seo/robots.test.ts
git commit -m "feat(seo): add robots.txt with an explicit AI-crawler policy

Until now /robots.txt fell through the SPA rewrite and returned index.html as
text/html. Private routes are deliberately not disallowed: blocking them would
stop a crawler ever reading the noindex that actually excludes them."
```

**Note for the operator:** the `Sitemap:` line points at a URL that does not exist until Phase 1 Task 12. Submitting to Search Console before then will show a "couldn't fetch" warning. Either wait for Phase 1, or expect the warning.

---

### Task 3: The per-route metadata table

**Files:**
- Create: `src/lib/head.ts`
- Create: `src/lib/head.test.ts`

**Interfaces:**
- Consumes: `PageId`, `PAGE_TO_PATH`, `PRIVATE_PAGES` from Task 1.
- Produces: `type PageMeta = { title: string; description: string; canonical: string; index: boolean }`, `function pageMeta(page: PageId): PageMeta`, `function sharedItineraryMeta(shareId: string): PageMeta`, `const ORIGIN: string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/head.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pageMeta, sharedItineraryMeta, ORIGIN } from './head';
import { PAGE_TO_PATH, PRIVATE_PAGES, type PageId } from './pages';

const ALL = Object.keys(PAGE_TO_PATH) as PageId[];

describe('pageMeta', () => {
  it('gives every page a distinct, non-empty title', () => {
    const titles = ALL.map((p) => pageMeta(p).title);
    for (const t of titles) expect(t.length).toBeGreaterThan(10);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('gives every page a description within the length search engines show', () => {
    for (const p of ALL) {
      const d = pageMeta(p).description;
      expect(d.length).toBeGreaterThan(50);
      expect(d.length).toBeLessThanOrEqual(160);
    }
  });

  it('builds the canonical from the origin and the route path', () => {
    expect(pageMeta('landing').canonical).toBe(`${ORIGIN}/`);
    expect(pageMeta('explore').canonical).toBe(`${ORIGIN}/explore`);
  });

  it('marks every private page noindex', () => {
    for (const p of PRIVATE_PAGES) expect(pageMeta(p).index).toBe(false);
  });

  it('marks the public pages indexable', () => {
    for (const p of ['landing', 'explore', 'questionnaire', 'privacy', 'terms', 'surprise'] as PageId[]) {
      expect(pageMeta(p).index).toBe(true);
    }
  });
});

describe('sharedItineraryMeta', () => {
  // A shared itinerary is one traveller's trip at a guessable public URL. It
  // must never enter a search index, however widely the link gets posted.
  it('is never indexable', () => {
    expect(sharedItineraryMeta('abc123').index).toBe(false);
  });

  it('canonicalises to its own share URL', () => {
    expect(sharedItineraryMeta('abc123').canonical).toBe(`${ORIGIN}/i/abc123`);
  });

  it('never puts the share id in the title or description', () => {
    const m = sharedItineraryMeta('abc123');
    expect(m.title).not.toContain('abc123');
    expect(m.description).not.toContain('abc123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/head.test.ts`
Expected: FAIL — `Failed to resolve import "./head"`.

- [ ] **Step 3: Write the module**

Create `src/lib/head.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/head.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Mutation-check the noindex guard**

Temporarily remove `'itinerary'` from `PRIVATE_PAGES` in `src/lib/pages.ts`, run `npx vitest run src/lib/head.test.ts src/lib/pages.test.ts`, and confirm BOTH files fail. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/lib/head.ts src/lib/head.test.ts
git commit -m "feat(seo): per-route title, description, canonical and index policy

Shared itineraries at /i/<id> are explicitly never indexable: the URL is public
and the page is one traveller's trip."
```

---

### Task 4: Apply the metadata to the DOM on every navigation

**Files:**
- Modify: `src/lib/head.ts` (append `applyHead`)
- Create: `src/lib/head.dom.test.ts`
- Modify: `src/App.tsx` (the existing `useEffect` keyed on `page`, around `:174-181`)

**Interfaces:**
- Consumes: `PageMeta` from Task 3.
- Produces: `function applyHead(meta: PageMeta): void` — idempotent; safe to call on every navigation.

- [ ] **Step 1: Write the failing test**

Create `src/lib/head.dom.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyHead, pageMeta, sharedItineraryMeta } from './head';

const tag = (sel: string) => document.head.querySelector(sel);
const all = (sel: string) => document.head.querySelectorAll(sel);

describe('applyHead', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.title = ''; });

  it('writes the title, description and canonical', () => {
    applyHead(pageMeta('explore'));
    expect(document.title).toBe(pageMeta('explore').title);
    expect(tag('meta[name="description"]')!.getAttribute('content'))
      .toBe(pageMeta('explore').description);
    expect(tag('link[rel="canonical"]')!.getAttribute('href'))
      .toBe('https://10daysonaruba.com/explore');
  });

  it('does not duplicate tags when applied repeatedly', () => {
    applyHead(pageMeta('explore'));
    applyHead(pageMeta('privacy'));
    applyHead(pageMeta('landing'));
    expect(all('meta[name="description"]')).toHaveLength(1);
    expect(all('link[rel="canonical"]')).toHaveLength(1);
    expect(tag('link[rel="canonical"]')!.getAttribute('href'))
      .toBe('https://10daysonaruba.com/');
  });

  it('emits noindex for a private page', () => {
    applyHead(pageMeta('itinerary'));
    expect(tag('meta[name="robots"]')!.getAttribute('content')).toBe('noindex, follow');
  });

  it('emits noindex for a shared itinerary', () => {
    applyHead(sharedItineraryMeta('abc123'));
    expect(tag('meta[name="robots"]')!.getAttribute('content')).toBe('noindex, follow');
  });

  // The dangerous direction: navigating from a private page to a public one
  // must REMOVE the noindex, or the whole site inherits it for that session.
  it('removes noindex when navigating back to an indexable page', () => {
    applyHead(pageMeta('itinerary'));
    applyHead(pageMeta('landing'));
    expect(tag('meta[name="robots"]')).toBeNull();
  });

  it('reuses a description tag that index.html already shipped', () => {
    document.head.innerHTML = '<meta name="description" content="from index.html">';
    applyHead(pageMeta('explore'));
    expect(all('meta[name="description"]')).toHaveLength(1);
    expect(tag('meta[name="description"]')!.getAttribute('content'))
      .toBe(pageMeta('explore').description);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/head.dom.test.ts`
Expected: FAIL — `applyHead is not a function` (it is not exported yet).

- [ ] **Step 3: Append the DOM writer to `src/lib/head.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/head.dom.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire it into App.tsx**

In `src/App.tsx`, add to the imports:

```ts
import { applyHead, pageMeta, sharedItineraryMeta } from './lib/head';
```

Then, immediately BEFORE the existing beacon effect (the one commented "Cookieless traffic beacon"), add:

```ts
  // Per-route <head>. Keyed on the same state as the beacon effect below and
  // for the same reason: setPage pushes history without a navigation, so there
  // is no load event to hang this on after the first one.
  useEffect(() => {
    applyHead(shareId ? sharedItineraryMeta(shareId) : pageMeta(page));
  }, [page, shareId]);
```

- [ ] **Step 6: Verify in a real browser**

Run: `npm run build && npm run preview`

In the preview tab, confirm by hand:
- `/` → title is "10 days on Aruba — Build your perfect itinerary", no `meta[name=robots]`.
- Navigate to the itinerary → title changes, `meta[name=robots]` is `noindex, follow`.
- Navigate back to the landing page → the robots tag is gone again.

Never use `npm run dev` for this check — the dev server carries the path-traversal advisories noted in `.claude/CLAUDE.md`.

- [ ] **Step 7: Run the full suite**

Run: `npm run typecheck && npx vitest run`
Expected: clean typecheck, no new failures.

- [ ] **Step 8: Commit**

```bash
git add src/lib/head.ts src/lib/head.dom.test.ts src/App.tsx
git commit -m "feat(seo): apply per-route head metadata on every navigation

Removes the robots tag when returning to an indexable page — without that, one
visit to /itinerary left noindex in place for the rest of the session."
```

---

### Task 5: Site-level JSON-LD

`WebSite` + `Organization` are constant across every route, so they belong in `index.html` rather than in JavaScript — a crawler that does not execute JS still reads them.

**Files:**
- Modify: `index.html` (inside `<head>`, after the Twitter Card block)
- Create: `src/seo/jsonld.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable — a static block, guarded by a test.

- [ ] **Step 1: Write the failing test**

Create `src/seo/jsonld.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const HTML = readFileSync('index.html', 'utf8');

function blocks(): unknown[] {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  return [...HTML.matchAll(re)].map((m) => JSON.parse(m[1]));
}

describe('site-level JSON-LD in index.html', () => {
  it('parses as valid JSON', () => {
    expect(() => blocks()).not.toThrow();
    expect(blocks().length).toBeGreaterThan(0);
  });

  it('declares a WebSite and an Organization', () => {
    const types = blocks().map((b) => (b as { '@type': string })['@type']);
    expect(types).toContain('WebSite');
    expect(types).toContain('Organization');
  });

  it('uses the canonical origin with no trailing slash on the id', () => {
    for (const b of blocks()) {
      const url = (b as { url?: string }).url;
      if (url) expect(url).toBe('https://10daysonaruba.com/');
    }
  });

  // Ratings we did not collect ourselves must never be marked up: Google's
  // review-snippet policy requires first-party ratings, and aggregating
  // Viator's and TripAdvisor's here would invite a manual action.
  it('markets no aggregateRating', () => {
    expect(HTML).not.toContain('aggregateRating');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/seo/jsonld.test.ts`
Expected: FAIL — `blocks().length` is 0.

- [ ] **Step 3: Add the block to `index.html`**

Insert immediately after the Twitter Card `<meta>` tags:

```html
    <!-- Site-level structured data. Static rather than injected by JS: a
         crawler that does not execute JavaScript still reads it, and these two
         entities never change per route. Entity consistency is what lets an
         answer engine connect scattered mentions of the site to this domain.
         Deliberately no aggregateRating anywhere — see src/seo/jsonld.test.ts. -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "10 Days on Aruba",
      "url": "https://10daysonaruba.com/",
      "description": "A free Aruba trip planner that turns 8 questions into a day-by-day itinerary."
    }
    </script>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "10 Days on Aruba",
      "url": "https://10daysonaruba.com/",
      "logo": "https://10daysonaruba.com/logo-horizontal.png"
    }
    </script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/seo/jsonld.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Confirm it survives the build**

Run: `npm run build && grep -c 'application/ld+json' dist/index.html`
Expected: `2`.

- [ ] **Step 6: Commit**

```bash
git add index.html src/seo/jsonld.test.ts
git commit -m "feat(seo): site-level WebSite and Organization JSON-LD

Static in index.html so crawlers that do not run JavaScript still read it. No
aggregateRating anywhere — those ratings are not ours to mark up."
```

### Task 6: Make internal navigation crawlable

**Files:**
- Modify: `src/components/Footer.tsx:80-93`
- Create: `src/components/Footer.dom.test.tsx`

The site currently has **no crawlable internal links at all**. Every navigation
is `<button onClick={() => setPage(...)}>`; `grep 'href="/'` across `src/pages`
and `src/components` returns nothing. A crawler therefore cannot walk from one
route to another, no link equity flows anywhere, and the generated pages of
Phase 1 would be reachable only from the sitemap.

The fix is progressive enhancement, not a router rewrite: render a real `<a
href>` and keep the SPA navigation in an `onClick` that calls `preventDefault`.
Crawlers follow the href, users get the same instant navigation as before, and
cmd-click / open-in-new-tab starts working — which it never did.

**Interfaces:**
- Consumes: `PAGE_TO_PATH` from Task 1.
- Produces: `function SpaLink(props: { page: PageId; setPage: (p: PageId) => void; children: React.ReactNode; className?: string; style?: React.CSSProperties }): JSX.Element`, exported from `src/components/Footer.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Footer.dom.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpaLink } from './Footer';

describe('SpaLink', () => {
  it('renders a real href a crawler can follow', () => {
    render(<SpaLink page="privacy" setPage={() => {}}>Privacy Policy</SpaLink>);
    expect(screen.getByRole('link', { name: 'Privacy Policy' }))
      .toHaveAttribute('href', '/privacy');
  });

  it('navigates in-app on a plain click, without a page load', async () => {
    const setPage = vi.fn();
    render(<SpaLink page="terms" setPage={setPage}>Terms</SpaLink>);
    await userEvent.click(screen.getByRole('link', { name: 'Terms' }));
    expect(setPage).toHaveBeenCalledWith('terms');
  });

  // The whole point of using an anchor: these gestures must reach the browser.
  it('lets the browser handle a modifier-click so open-in-new-tab works', async () => {
    const setPage = vi.fn();
    render(<SpaLink page="terms" setPage={setPage}>Terms</SpaLink>);
    await userEvent.keyboard('{Meta>}');
    await userEvent.click(screen.getByRole('link', { name: 'Terms' }));
    await userEvent.keyboard('{/Meta}');
    expect(setPage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Footer.dom.test.tsx`
Expected: FAIL — `SpaLink is not exported from './Footer'`.

- [ ] **Step 3: Add the component to `src/components/Footer.tsx`**

Add near the top of the file, after the existing imports:

```tsx
import { PAGE_TO_PATH, type PageId } from '../lib/pages';

/**
 * An in-app navigation that is also a real link.
 *
 * Every internal navigation on this site used to be a <button onClick>. That is
 * invisible to a crawler — there was no path from any page to any other page,
 * so nothing could be discovered by following links and no link equity moved.
 *
 * The href is what a crawler reads; preventDefault on a plain click is what
 * keeps the SPA navigation instant. Modifier-clicks and middle-clicks fall
 * through to the browser deliberately, so open-in-new-tab works — it never did
 * while these were buttons.
 */
export function SpaLink({
  page, setPage, children, className, style,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <a
      href={PAGE_TO_PATH[page]}
      className={className}
      style={style}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        setPage(page);
      }}
    >
      {children}
    </a>
  );
}
```

- [ ] **Step 4: Replace the two footer buttons**

Swap the `privacy` and `terms` `<button>` elements for:

```tsx
          <SpaLink page="privacy" setPage={setPage}
            style={{ fontSize: 11, color: '#666', textDecoration: 'underline' }}>
            Privacy Policy
          </SpaLink>
          <SpaLink page="terms" setPage={setPage}
            style={{ fontSize: 11, color: '#666', textDecoration: 'underline' }}>
            Terms of Service
          </SpaLink>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/Footer.dom.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Confirm the footer still looks right**

Run: `npm run build && npm run preview`

Check the footer renders identically to before, both links navigate without a
page reload, and cmd-clicking one opens a new tab.

- [ ] **Step 7: Run the full suite**

Run: `npm run typecheck && npx vitest run`
Expected: clean; no new failures.

- [ ] **Step 8: Commit**

```bash
git add src/components/Footer.tsx src/components/Footer.dom.test.tsx
git commit -m "feat(seo): give footer navigation real hrefs

The site had no crawlable internal links at all — every navigation was a
button, so nothing could be reached by following a link and no equity moved.
Anchors with preventDefault keep SPA navigation and fix open-in-new-tab."
```

**Note:** this converts the footer only. The Nav and in-page CTAs are the same
pattern and worth the same treatment, but they are not on this plan's critical
path — Task 13 links the generated surface from the footer, which is what
Phase 1 needs.

---

**Phase 0 is complete here.** The site is now crawlable, every route is distinguishable, internal navigation is followable, and no private URL is indexable. Verify against production after the next deploy, then have Jan add the property to Google Search Console and Bing Webmaster Tools.

---

# PHASE 1 — The generator and the first 58 pages

---

### Task 7: Enable the Vite manifest and resolve built asset paths

Generated pages link the app's own stylesheet, whose filename is fingerprinted per build. The manifest is how a post-build script finds it.

**Files:**
- Modify: `vite.config.ts` (add `build.manifest`)
- Create: `src/seo/assets.ts`
- Create: `src/seo/assets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function cssHrefFromManifest(manifestJson: string): string` — takes the manifest's text, returns the site-absolute href of the entry stylesheet (e.g. `/assets/index-CZLjywM4.css`). Throws with a clear message if absent.

- [ ] **Step 1: Write the failing test**

Create `src/seo/assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cssHrefFromManifest } from './assets';

const MANIFEST = JSON.stringify({
  'src/main.tsx': {
    file: 'assets/index-DmUJTFYN.js',
    name: 'index',
    src: 'src/main.tsx',
    isEntry: true,
    css: ['assets/index-CZLjywM4.css'],
  },
  'src/pages/Explore.tsx': { file: 'assets/Explore-aaa.js', name: 'Explore' },
});

describe('cssHrefFromManifest', () => {
  it('finds the entry chunk stylesheet and makes it site-absolute', () => {
    expect(cssHrefFromManifest(MANIFEST)).toBe('/assets/index-CZLjywM4.css');
  });

  it('throws a useful message when the entry has no css', () => {
    const bad = JSON.stringify({ 'src/main.tsx': { file: 'a.js', isEntry: true } });
    expect(() => cssHrefFromManifest(bad)).toThrow(/no stylesheet/i);
  });

  it('throws a useful message when there is no entry chunk', () => {
    const bad = JSON.stringify({ 'src/pages/Explore.tsx': { file: 'a.js' } });
    expect(() => cssHrefFromManifest(bad)).toThrow(/no entry chunk/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/seo/assets.test.ts`
Expected: FAIL — `Failed to resolve import "./assets"`.

- [ ] **Step 3: Write the module**

Create `src/seo/assets.ts`:

```ts
// Generated pages link the app's own stylesheet so the two surfaces cannot
// drift visually. Vite fingerprints that filename on every build, so the
// generator reads it out of the build manifest rather than guessing.

type ManifestChunk = { file: string; isEntry?: boolean; css?: string[] };

export function cssHrefFromManifest(manifestJson: string): string {
  const manifest = JSON.parse(manifestJson) as Record<string, ManifestChunk>;
  const entry = Object.values(manifest).find((c) => c.isEntry);
  if (!entry) {
    throw new Error(
      'seo: no entry chunk in the Vite manifest — is build.manifest enabled in vite.config.ts?',
    );
  }
  const css = entry.css?.[0];
  if (!css) {
    throw new Error(
      'seo: the entry chunk lists no stylesheet — generated pages would be unstyled, so this fails the build rather than shipping them.',
    );
  }
  return '/' + css;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/seo/assets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Enable the manifest**

In `vite.config.ts`, add a `build` key alongside `plugins` and `define`:

```ts
  build: {
    // Written so the post-build SEO generator can find the fingerprinted
    // stylesheet to link from generated pages. See src/seo/assets.ts.
    manifest: true,
  },
```

- [ ] **Step 6: Verify the manifest appears**

Run:

```bash
npm run build
ls dist/.vite/manifest.json dist/manifest.json 2>/dev/null
node -e "const m=require('./dist/.vite/manifest.json');const e=Object.values(m).find(c=>c.isEntry);console.log(e.file, e.css)"
```

Expected: the manifest path exists, and the entry chunk prints a `css` array.
Vite 5 writes `dist/.vite/manifest.json`; if this project's version writes
`dist/manifest.json` instead, note which — Task 13's CLI checks both.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts src/seo/assets.ts src/seo/assets.test.ts
git commit -m "build: emit the Vite manifest and read the entry stylesheet from it

Generated SEO pages link the app's own fingerprinted CSS so the two surfaces
cannot drift visually."
```

---

### Task 8: The catalog snapshot script

The generator must not touch the network — `npm run build` runs on every push to main, and a build that depends on an edge function responding is a new way for the whole site to fail to deploy.

**Files:**
- Create: `src/seo/catalog.ts`
- Create: `tools/build-seo-catalog.ts`
- Create: `tools/run-build-seo-catalog.cjs`
- Modify: `package.json` (add the `seo:refresh` script)
- Creates on run: `src/data/seoCatalog.json`

**Interfaces:**
- Consumes: `loadCatalog()` from `src/data/activitySource`.
- Produces: `type SeoCatalogItem` (the single declaration — every later task imports it from `src/seo/catalog`), and `src/data/seoCatalog.json` shaped `{ measured: string; items: SeoCatalogItem[] }`.

- [ ] **Step 1: Declare the snapshot shape**

Create `src/seo/catalog.ts`. This is the ONLY declaration of the type — the
writer (`tools/build-seo-catalog.ts`) and every reader import it from here, so
the two halves cannot drift.

```ts
// The shape of src/data/seoCatalog.json.
//
// Only the fields a generated page actually needs. Deliberately not the whole
// ViatorItem: the snapshot is committed, so every unused field is diff noise on
// every refresh.

export type SeoCatalogItem = {
  /** Viator product code. Also the key into every committed snapshot. */
  id: string;
  title: string;
  image_url: string;
  viator_item_url: string;
  duration: string;
  price_usd: number;
  review_count: number;
  experience_cluster_id?: string;
  tags?: number[];
  sections?: string[];
};

export type SeoCatalogSnapshot = {
  /** ISO date the snapshot was taken, for the page's freshness line. */
  measured: string;
  items: SeoCatalogItem[];
};
```

- [ ] **Step 2: Write the snapshot script**

Create `tools/build-seo-catalog.ts`:

```ts
/**
 * Snapshot the live catalog for the SEO generator.
 *
 * WHY A SNAPSHOT. `npm run build` runs on every push to main and deploys the
 * whole site. Fetching the catalog there would make every deploy depend on an
 * edge function responding — a new failure mode for a site that has none. So
 * this script is run BY HAND, its output is committed, and the build is offline
 * and deterministic. Same contract as the coordinate registry, the start-time
 * snapshot and reviewBreakdown.json.
 *
 * A side benefit: catalog drift arrives as a reviewable git diff instead of
 * silently changing what deploys.
 *
 *   npm run seo:refresh
 */
import { writeFileSync } from 'node:fs';
import { loadCatalog } from '../src/data/activitySource';
import type { SeoCatalogItem } from '../src/seo/catalog';

const OUT = 'src/data/seoCatalog.json';

async function main(): Promise<void> {
  const catalog = await loadCatalog();
  const items: SeoCatalogItem[] = catalog.items.map((i) => ({
    id: i.id,
    title: i.title,
    image_url: i.image_url,
    viator_item_url: i.viator_item_url,
    duration: i.duration,
    price_usd: i.price_usd,
    review_count: i.review_count,
    experience_cluster_id: i.experience_cluster_id,
    tags: i.tags,
    sections: i.sections,
  }));

  items.sort((a, b) => a.id.localeCompare(b.id));   // stable diffs

  const missingAffiliate = items.filter(
    (i) => i.viator_item_url && !(i.viator_item_url.includes('pid=') && i.viator_item_url.includes('mcid=')),
  );
  if (missingAffiliate.length) {
    console.error(`\nWARNING: ${missingAffiliate.length} products have a URL without pid/mcid:`);
    for (const i of missingAffiliate.slice(0, 5)) console.error(`  ${i.id}  ${i.viator_item_url}`);
    console.error('These will be REFUSED a page by the generator (tools/build-seo.ts).\n');
  }

  writeFileSync(OUT, JSON.stringify({ measured: new Date().toISOString().slice(0, 10), items }, null, 1) + '\n');
  console.log(`wrote ${OUT}: ${items.length} items`);
}

void main();
```

- [ ] **Step 3: Write the runner wrapper**

Create `tools/run-build-seo-catalog.cjs`, mirroring `tools/run-drift.cjs`:

```js
/**
 * Builds and runs tools/build-seo-catalog.ts.
 *
 * Exists for the same reason as run-drift.cjs: the script calls the app's real
 * loadCatalog(), which needs import.meta.env baked in at bundle time.
 */
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const raw = (() => {
  try { return readFileSync(`${process.cwd()}/.env.production`, 'utf8'); }
  catch { return ''; }
})();
const read = (k) => (raw.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const env = JSON.stringify({
  VITE_VIATOR_FN_URL: read('VITE_VIATOR_FN_URL'),
  VITE_SUPABASE_ANON_KEY: read('VITE_SUPABASE_ANON_KEY'),
});
if (!read('VITE_SUPABASE_ANON_KEY')) {
  console.error('error: no VITE_SUPABASE_ANON_KEY in ./.env.production — refusing to snapshot the offline stub as if it were the catalog. Run from the repo root.');
  process.exit(1);
}

const out = 'node_modules/.cache/build-seo-catalog.mjs';
execFileSync('node_modules/.bin/esbuild', [
  'tools/build-seo-catalog.ts', '--bundle', '--platform=node', '--format=esm',
  `--define:import.meta.env=${env}`, `--outfile=${out}`, '--log-level=warning',
], { stdio: 'inherit' });
execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit' });
```

- [ ] **Step 4: Add the npm script**

In `package.json` `scripts`, after `"build:curated"`:

```json
    "seo:refresh": "node tools/run-build-seo-catalog.cjs",
```

- [ ] **Step 5: Run it**

Run: `npm run seo:refresh`
Expected: `wrote src/data/seoCatalog.json: <N> items`, where N is roughly 327. If the affiliate warning fires, record the count — Task 13 refuses those products a page.

- [ ] **Step 6: Sanity-check the snapshot**

Run:

```bash
node -e "const d=require('./src/data/seoCatalog.json');console.log(d.measured, d.items.length);console.log(d.items[0])"
```

Expected: today's date, the item count, and a first item carrying `id`, `title`, `viator_item_url`.

- [ ] **Step 7: Commit**

```bash
git add src/seo/catalog.ts tools/build-seo-catalog.ts tools/run-build-seo-catalog.cjs package.json src/data/seoCatalog.json
git commit -m "feat(seo): hand-run catalog snapshot for the page generator

The build must stay offline: it runs on every push to main and deploys the
site, so it cannot depend on an edge function answering."
```

---

### Task 9: The quality floor

**Files:**
- Create: `src/seo/floor.ts`
- Create: `src/seo/floor.test.ts`

**Interfaces:**
- Consumes: `combinedBreakdown`, `reviewSourcesFor` from `src/data/reviewBreakdown`; `whatToExpectFor` from `src/data/whatToExpect`; `ACTIVITIES` from `src/data/activities`; `SeoCatalogItem` from `src/seo/catalog` (Task 8).
- Produces: `const MIN_SEO_REVIEWS = 25`, `function productEarnsPage(id: string): boolean`, `function curatedEarnsPage(a: Activity): boolean`, `function selectPages(items: SeoCatalogItem[]): { products: SeoCatalogItem[]; curated: Activity[] }`.

- [ ] **Step 1: Write the failing test**

Create `src/seo/floor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { productEarnsPage, curatedEarnsPage, selectPages, MIN_SEO_REVIEWS } from './floor';
import { ACTIVITIES } from '../data/activities';
import { reviewSourcesFor } from '../data/reviewBreakdown';
import { whatToExpectFor } from '../data/whatToExpect';
import SNAPSHOT from '../data/seoCatalog.json';
import type { SeoCatalogItem } from './catalog';

const ITEMS = (SNAPSHOT as { items: SeoCatalogItem[] }).items;

describe('MIN_SEO_REVIEWS', () => {
  it('reuses the engine threshold rather than inventing a second one', () => {
    expect(MIN_SEO_REVIEWS).toBe(25);
  });
});

describe('productEarnsPage', () => {
  it('refuses a product with no review data at all', () => {
    expect(productEarnsPage('definitely-not-a-product-code')).toBe(false);
  });

  it('requires prose — both platforms and a big review count are not enough', () => {
    const proseless = ITEMS.find(
      (i) => !whatToExpectFor(i.id) && reviewSourcesFor(i.id).length >= 2,
    );
    expect(proseless, 'fixture: expected at least one prose-less product').toBeDefined();
    expect(productEarnsPage(proseless!.id)).toBe(false);
  });

  it('requires both platforms — prose alone is not enough', () => {
    const oneSided = ITEMS.find(
      (i) => whatToExpectFor(i.id) && reviewSourcesFor(i.id).length === 1,
    );
    if (oneSided) expect(productEarnsPage(oneSided.id)).toBe(false);
  });

  it('accepts a product that clears all three conditions', () => {
    const good = ITEMS.filter((i) => productEarnsPage(i.id));
    expect(good.length).toBeGreaterThan(0);
    for (const i of good.slice(0, 5)) {
      expect(whatToExpectFor(i.id)).toBeTruthy();
      const platforms = new Set(reviewSourcesFor(i.id).map((r) => r.p));
      expect(platforms.has('V') && platforms.has('T')).toBe(true);
    }
  });
});

describe('curatedEarnsPage', () => {
  it('accepts a curated pick with a hand-written localsSay', () => {
    expect(curatedEarnsPage(ACTIVITIES.find((a) => a.id === 'eagle-beach-morning')!)).toBe(true);
  });

  it('refuses the picks whose localsSay is deliberately empty', () => {
    expect(curatedEarnsPage(ACTIVITIES.find((a) => a.id === 'arashi-beach')!)).toBe(false);
  });
});

describe('selectPages', () => {
  // The number the spec commits to. It is allowed to drift with the catalog,
  // but not silently: this test is the alarm.
  it('selects 19 curated picks', () => {
    expect(selectPages(ITEMS).curated).toHaveLength(19);
  });

  it('selects a product set in the size the spec measured', () => {
    const { products } = selectPages(ITEMS);
    expect(products.length).toBeGreaterThanOrEqual(30);
    expect(products.length).toBeLessThanOrEqual(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/seo/floor.test.ts`
Expected: FAIL — `Failed to resolve import "./floor"`.

- [ ] **Step 3: Write the module**

Create `src/seo/floor.ts`:

```ts
// Which activities earn a public URL.
//
// The point of a floor is to bind. An earlier draft of the spec asked for both
// review platforms AND (prose OR a start time) — and startTimes.json covers 281
// of 327 products, so the "or" waved 246 pages through. A departure time is not
// unique content, and 246 near-identical pages is the pattern Google's
// scaled-content policy demotes. Measured on 2026-09-10, this floor selects 58.
//
// Growth comes from extending whatToExpect.json (89 of 327 — the binding
// constraint), never from lowering the bar. See the spec.

import { reviewSourcesFor } from '../data/reviewBreakdown';
import { whatToExpectFor } from '../data/whatToExpect';
import { ACTIVITIES, type Activity } from '../data/activities';
import type { SeoCatalogItem } from './catalog';

export type { SeoCatalogItem };

/**
 * Mirrors MIN_CHAMPION_REVIEWS in src/data/itineraryGenerator.ts:133 (and
 * tools/catalog-drift.ts:43). Reused rather than re-chosen: two thresholds
 * meaning "enough reviews to trust" would drift apart.
 */
export const MIN_SEO_REVIEWS = 25;

/** A Viator product earns a URL when all three hold. */
export function productEarnsPage(id: string): boolean {
  const rows = reviewSourcesFor(id);
  const platforms = new Set(rows.map((r) => r.p));
  if (!(platforms.has('V') && platforms.has('T'))) return false;   // 1. both platforms
  if (!whatToExpectFor(id)) return false;                          // 2. prose to summarise
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return total >= MIN_SEO_REVIEWS;                                 // 3. a histogram worth drawing
}

/**
 * A curated pick earns a URL when it carries hand-written localsSay — the only
 * genuinely original text on the page. Seven of the 26 have it deliberately
 * empty (activities.ts explains why: inventing quotes attributed to named
 * locals is not on), and those would be thin.
 */
export function curatedEarnsPage(a: Activity): boolean {
  return a.localsSay.trim().length > 0;
}

export function selectPages(items: SeoCatalogItem[]): {
  products: SeoCatalogItem[];
  curated: Activity[];
} {
  return {
    products: items.filter((i) => productEarnsPage(i.id)),
    curated: ACTIVITIES.filter(curatedEarnsPage),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/seo/floor.test.ts`
Expected: PASS. Note the actual product count printed by the count test if it fails the range — the spec measured 39.

- [ ] **Step 5: Print the real selection size**

Add a temporary scratch test to print the number, run it, then delete it:

```bash
cat > src/seo/_count.test.ts <<'EOF'
import { it } from 'vitest';
import { selectPages } from './floor';
import SNAPSHOT from '../data/seoCatalog.json';
it('prints the selection', () => {
  const r = selectPages((SNAPSHOT as any).items);
  console.log(`products=${r.products.length} curated=${r.curated.length} total=${r.products.length + r.curated.length}`);
});
EOF
npx vitest run src/seo/_count.test.ts 2>&1 | grep -E "products=|curated="
rm src/seo/_count.test.ts
```

Expected: `products=39 curated=19 total=58`, matching the spec's measurement.

If the product count falls outside 30–50, do NOT widen the test — investigate
why the catalog moved and record it. That divergence is exactly the signal the
test exists to raise.

- [ ] **Step 6: Mutation-check the floor**

Temporarily change `MIN_SEO_REVIEWS` to `0` and confirm `src/seo/floor.test.ts` fails on the count assertion. Then temporarily delete the `whatToExpectFor` condition and confirm the "requires prose" test fails. Revert both.

- [ ] **Step 7: Commit**

```bash
git add src/seo/floor.ts src/seo/floor.test.ts
git commit -m "feat(seo): quality floor selecting the activities that earn a URL

Both review platforms, prose to summarise, and MIN_CHAMPION_REVIEWS reviews.
An earlier draft's floor admitted 246 pages because startTimes covers 281
products; this one selects 58."
```

---

### Task 10: The slug registry

**Files:**
- Create: `content/slugs.json`
- Create: `src/seo/slugs.ts`
- Create: `src/seo/slugs.test.ts`

**Interfaces:**
- Consumes: `SeoCatalogItem` from Task 9.
- Produces: `function slugify(title: string): string`, `function slugFor(id: string, registry: Record<string, string>): string | null`, `function proposeRegistry(entries: {id: string; title: string}[], existing: Record<string, string>): Record<string, string>`, `function urlFor(slug: string, kind: 'things-to-do' | 'guides'): string`.

- [ ] **Step 1: Write the failing test**

Create `src/seo/slugs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify, slugFor, proposeRegistry, urlFor } from './slugs';

describe('slugify', () => {
  it('lowercases, strips punctuation and joins on hyphens', () => {
    expect(slugify('Jolly Pirates Sail & Snorkel')).toBe('jolly-pirates-sail-snorkel');
  });

  it('folds accents rather than dropping the letters', () => {
    expect(slugify('Café Presto — Aruba')).toBe('cafe-presto-aruba');
  });

  it('collapses runs of separators and trims the ends', () => {
    expect(slugify('  --A  //  B--  ')).toBe('a-b');
  });

  it('never emits an empty slug', () => {
    expect(slugify('!!!')).toBe('activity');
  });
});

describe('slugFor', () => {
  it('returns the registered slug', () => {
    expect(slugFor('245508', { '245508': 'sunset-catamaran-sail' })).toBe('sunset-catamaran-sail');
  });

  it('returns null for an unregistered id rather than inventing one', () => {
    expect(slugFor('999', {})).toBeNull();
  });
});

describe('proposeRegistry', () => {
  it('adds a slug for a new id', () => {
    const r = proposeRegistry([{ id: 'a1', title: 'Sunset Sail' }], {});
    expect(r.a1).toBe('sunset-sail');
  });

  // The invariant: Viator retitles products, and a retitle must never move a URL.
  it('keeps an existing slug even when the title changes completely', () => {
    const r = proposeRegistry(
      [{ id: 'a1', title: 'Completely Different Name Now' }],
      { a1: 'sunset-sail' },
    );
    expect(r.a1).toBe('sunset-sail');
  });

  it('keeps ids that have vanished from the catalog', () => {
    const r = proposeRegistry([{ id: 'a1', title: 'Sunset Sail' }], { gone: 'old-tour' });
    expect(r.gone).toBe('old-tour');
  });

  it('disambiguates two products that slugify identically', () => {
    const r = proposeRegistry(
      [{ id: 'a1', title: 'Sunset Sail' }, { id: 'a2', title: 'Sunset Sail' }],
      {},
    );
    expect(new Set(Object.values(r)).size).toBe(2);
    expect(r.a2).toMatch(/^sunset-sail-/);
  });
});

describe('urlFor', () => {
  it('builds a directory-style path so Apache serves a real file', () => {
    expect(urlFor('sunset-sail', 'things-to-do')).toBe('/things-to-do/sunset-sail/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/seo/slugs.test.ts`
Expected: FAIL — `Failed to resolve import "./slugs"`.

- [ ] **Step 3: Write the module**

Create `src/seo/slugs.ts`:

```ts
// URL slugs, from a committed registry rather than derived at build time.
//
// The invariant: a URL, once published, is never reused for different content
// and never moves. Viator retitles products without telling us; deriving the
// slug from the title would silently 404 an indexed page and throw away every
// link pointing at it. The registry is the authority; titles are not.

export function slugify(title: string): string {
  const s = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // fold accents, keep the letter
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'activity';
}

export function slugFor(id: string, registry: Record<string, string>): string | null {
  return registry[id] ?? null;
}

/**
 * Registry after adding any new ids. Existing entries are never rewritten, and
 * ids missing from the catalog are never dropped — a vanished product keeps its
 * URL, drops out of the sitemap, and its page points at a live alternative.
 */
export function proposeRegistry(
  entries: { id: string; title: string }[],
  existing: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...existing };
  const taken = new Set(Object.values(out));
  for (const { id, title } of entries) {
    if (out[id]) continue;
    const base = slugify(title);
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    out[id] = slug;
    taken.add(slug);
  }
  return out;
}

/** Directory-style so Apache serves <slug>/index.html as a real file. */
export function urlFor(slug: string, kind: 'things-to-do' | 'guides'): string {
  return `/${kind}/${slug}/`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/seo/slugs.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Seed the registry**

Create `content/slugs.json` with an empty object:

```json
{}
```

It is populated by the generator in Task 13, which writes back any new ids.

- [ ] **Step 6: Mutation-check the stability guarantee**

Temporarily change `proposeRegistry` so it overwrites (`out[id] = slug` unconditionally, removing the `if (out[id]) continue;`). Confirm "keeps an existing slug even when the title changes completely" FAILS. Revert.

- [ ] **Step 7: Commit**

```bash
git add content/slugs.json src/seo/slugs.ts src/seo/slugs.test.ts
git commit -m "feat(seo): committed slug registry so a retitle never moves a URL

Viator renames products without telling us. Deriving slugs from titles would
silently 404 indexed pages and discard the links pointing at them."
```

---

### Task 11: The data-page renderer

The biggest task. It produces the HTML for one activity page.

**Files:**
- Create: `src/seo/render.ts`
- Create: `src/seo/render.test.ts`

**Interfaces:**
- Consumes: `SeoCatalogItem` from `src/seo/catalog` (Task 8), `urlFor` (Task 10), `combinedBreakdown`/`reviewSourcesFor` (`src/data/reviewBreakdown`), `whatToExpectFor` (`src/data/whatToExpect`), `startTimesFor`/`formatStartTime` (`src/data/startTimes`), `viatorLink` (`src/data/exploreItems`), `ORIGIN` (`src/lib/head`).
- Produces: `function escapeHtml(s: string): string`, `function platformSplitWorthShowing(id: string): boolean`, `function renderDataPage(input: DataPageInput): string`, `function renderCuratedPage(input: { activity: Activity; slug: string; cssHref: string; buildDate: string; related: { title: string; url: string }[] }): string`, and `type DataPageInput = { item: SeoCatalogItem; slug: string; cssHref: string; buildDate: string; related: { title: string; url: string }[] }`.

- [ ] **Step 1: Write the failing test**

Create `src/seo/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderDataPage, escapeHtml, platformSplitWorthShowing } from './render';
import type { SeoCatalogItem } from './catalog';
import { combinedBreakdown } from '../data/reviewBreakdown';
import SNAPSHOT from '../data/seoCatalog.json';
import { selectPages } from './floor';

const ITEMS = (SNAPSHOT as { items: SeoCatalogItem[] }).items;
const SAMPLE = selectPages(ITEMS).products[0];

const page = (over: Partial<Parameters<typeof renderDataPage>[0]> = {}) =>
  renderDataPage({
    item: SAMPLE,
    slug: 'sample-activity',
    cssHref: '/assets/index-abc.css',
    buildDate: '2026-09-10',
    related: [{ title: 'Another Thing', url: '/things-to-do/another-thing/' }],
    ...over,
  });

describe('escapeHtml', () => {
  it('escapes the characters that would break out of markup', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('renderDataPage', () => {
  it('emits a complete document with the canonical and the app stylesheet', () => {
    const html = page();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(`<link rel="canonical" href="https://10daysonaruba.com/things-to-do/sample-activity/">`);
    expect(html).toContain('<link rel="stylesheet" href="/assets/index-abc.css">');
  });

  it('carries the affiliate parameters on the booking link', () => {
    const html = page();
    expect(html).toContain('pid=P00302487');
    expect(html).toContain('mcid=42383');
    expect(html).toContain('medium=link');
  });

  it('shows the COMBINED rating, matching the app and the Viator page', () => {
    const b = combinedBreakdown(SAMPLE.id)!;
    expect(page()).toContain(`${b.average}`);
    expect(page()).toContain(`${b.total}`);
  });

  it('renders a five-bar histogram with accessible labels', () => {
    const html = page();
    expect(html).toContain('data-seo-histogram');
    expect((html.match(/data-star=/g) ?? [])).toHaveLength(5);
  });

  it('links back to the planner with a ref the beacon can attribute', () => {
    expect(page()).toContain('?ref=seo-sample-activity');
  });

  it('stamps the build date', () => {
    expect(page()).toContain('2026-09-10');
  });

  it('emits TouristAttraction and BreadcrumbList JSON-LD and no aggregateRating', () => {
    const html = page();
    expect(html).toContain('"@type": "TouristAttraction"');
    expect(html).toContain('"@type": "BreadcrumbList"');
    expect(html).not.toContain('aggregateRating');
  });

  it('escapes a hostile title rather than injecting it', () => {
    const html = page({ item: { ...SAMPLE, title: '<script>alert(1)</script>' } });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('omits the price row when the catalog reports zero', () => {
    const html = page({ item: { ...SAMPLE, price_usd: 0 } });
    expect(html).not.toContain('data-row="price"');
  });

  it('shows the price row when the catalog reports one', () => {
    const html = page({ item: { ...SAMPLE, price_usd: 89 } });
    expect(html).toContain('data-row="price"');
    expect(html).toContain('89');
  });

  it('links every related activity', () => {
    expect(page()).toContain('/things-to-do/another-thing/');
  });
});

describe('platformSplitWorthShowing', () => {
  it('is false when the platforms agree', () => {
    // Agreement is the common case; showing "4.7 here, 4.7 there" is noise.
    const agreeing = ITEMS.filter((i) => !platformSplitWorthShowing(i.id));
    expect(agreeing.length).toBeGreaterThan(0);
  });

  it('never contradicts the combined headline when it does show', () => {
    // The rule from reviewBreakdown.ts:50 — the headline must stay the number
    // the traveller will see on the Viator page they land on.
    for (const i of ITEMS.slice(0, 50)) {
      if (!platformSplitWorthShowing(i.id)) continue;
      const html = renderDataPage({
        item: i, slug: 's', cssHref: '/a.css', buildDate: '2026-09-10', related: [],
      });
      const b = combinedBreakdown(i.id)!;
      const headline = html.slice(html.indexOf('data-seo-rating'), html.indexOf('data-seo-rating') + 400);
      expect(headline).toContain(`${b.average}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/seo/render.test.ts`
Expected: FAIL — `Failed to resolve import "./render"`.

- [ ] **Step 3: Write the renderer**

Create `src/seo/render.ts`:

```ts
// One activity page, as a complete static HTML document.
//
// No React here on purpose: these pages are documents, not app. They link the
// app's own fingerprinted stylesheet so the two surfaces cannot drift visually,
// and they ship no JavaScript beyond the small analytics beacon.

import { combinedBreakdown, reviewSourcesFor } from '../data/reviewBreakdown';
import { whatToExpectFor } from '../data/whatToExpect';
import { startTimesFor, formatStartTime } from '../data/startTimes';
import { viatorLink } from '../data/exploreItems';
import { ORIGIN } from '../lib/head';
import { urlFor } from './slugs';
import type { SeoCatalogItem } from './catalog';

export type DataPageInput = {
  item: SeoCatalogItem;
  slug: string;
  cssHref: string;
  buildDate: string;
  related: { title: string; url: string }[];
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Whether the per-platform split says anything.
 *
 * The headline rating is ALWAYS the combined figure — that is the number on the
 * Viator page the visitor lands on, and a page showing a different one reads as
 * stale even when both are right (src/data/reviewBreakdown.ts:50). The split is
 * provenance, not the rating, and it is only interesting when the platforms
 * actually disagree.
 */
const DISAGREEMENT = 0.3;

export function platformSplitWorthShowing(id: string): boolean {
  const rows = reviewSourcesFor(id).filter((r) => r.a !== null);
  if (rows.length < 2) return false;
  const averages = rows.map((r) => r.a as number);
  return Math.max(...averages) - Math.min(...averages) >= DISAGREEMENT;
}

export function renderDataPage(input: DataPageInput): string {
  const { item, slug, cssHref, buildDate, related } = input;
  const title = escapeHtml(item.title);
  const canonical = ORIGIN + urlFor(slug, 'things-to-do');
  const breakdown = combinedBreakdown(item.id);
  const prose = whatToExpectFor(item.id);
  const times = startTimesFor(item.id);
  const book = viatorLink(item.viator_item_url);

  const description = escapeHtml(
    `${item.title} in Aruba — real reviews, what the trip involves${
      times.length ? `, departs ${formatStartTime(times[0])}` : ''
    }.`,
  ).slice(0, 160);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — 10 days on Aruba</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="stylesheet" href="${cssHref}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${escapeHtml(item.image_url)}">
${jsonLd(item, title, canonical, slug)}
</head>
<body>
<main class="seo-page">
<nav class="seo-crumbs"><a href="/">10 days on Aruba</a> › <a href="/explore">Things to do</a> › <span>${title}</span></nav>

<h1>${title}</h1>
${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${title}" width="800" height="533" loading="lazy">` : ''}

${breakdown ? ratingBlock(item.id, breakdown) : ''}
${factsTable(item, times)}
${prose ? `<section><h2>What this involves</h2><p>${escapeHtml(summarise(prose))}</p></section>` : ''}
${faqBlock(item, times)}

<p class="seo-cta"><a class="btn" href="${escapeHtml(book)}" target="_blank" rel="noopener sponsored">Check dates and prices on Viator</a></p>
<p class="seo-plan"><a href="/questionnaire?ref=seo-${escapeHtml(slug)}">Build a full Aruba itinerary around this</a></p>

${related.length ? `<section><h2>Similar things to do</h2><ul>${
  related.map((r) => `<li><a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a></li>`).join('')
}</ul></section>` : ''}

<p class="seo-freshness">Data updated ${buildDate}</p>
</main>
<script>${BEACON}</script>
</body>
</html>
`;
}

function ratingBlock(id: string, b: { total: number; counts: number[]; average: number }): string {
  const max = Math.max(...b.counts, 1);
  const bars = b.counts
    .map((c, i) => {
      const star = i + 1;
      const pct = Math.round((c / max) * 100);
      return `<li data-star="${star}"><span class="seo-star">${star}★</span><span class="seo-bar" style="width:${pct}%"></span><span class="seo-count">${c}</span></li>`;
    })
    .reverse()
    .join('');

  // The headline is the COMBINED figure — the number the Viator page prints.
  let split = '';
  if (platformSplitWorthShowing(id)) {
    const rows = reviewSourcesFor(id)
      .filter((r) => r.a !== null)
      .map((r) => `<li>${r.p === 'V' ? 'Viator' : 'Tripadvisor'}: ${r.a}★ from ${r.n} reviews</li>`)
      .join('');
    split = `<details class="seo-split"><summary>Where these reviews come from</summary><ul>${rows}</ul><p>Both figures are real; the headline above is the combined total, which is what the booking page shows.</p></details>`;
  }

  return `<section data-seo-rating><h2>What ${b.total} reviewers actually said</h2>
<p class="seo-average"><strong>${b.average}</strong> out of 5, from ${b.total} reviews</p>
<ul data-seo-histogram>${bars}</ul>
${split}
</section>`;
}

function factsTable(item: SeoCatalogItem, times: string[]): string {
  const rows: string[] = [];
  if (item.duration) rows.push(row('duration', 'Duration', item.duration));
  if (times.length) rows.push(row('times', 'Starts', times.map(formatStartTime).join(', ')));
  // price_usd has historically arrived as 0 from viator-cards
  // (src/data/activitySource.ts:262) — check, never trust.
  if (item.price_usd > 0) rows.push(row('price', 'From', `$${item.price_usd}`));
  if (!rows.length) return '';
  return `<section><h2>The practical details</h2><table class="seo-facts"><tbody>${rows.join('')}</tbody></table></section>`;
}

function row(key: string, label: string, value: string): string {
  return `<tr data-row="${key}"><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function faqBlock(item: SeoCatalogItem, times: string[]): string {
  const qs: { q: string; a: string }[] = [];
  if (times.length) {
    qs.push({ q: `What time does ${item.title} start?`, a: `It departs at ${times.map(formatStartTime).join(' or ')}.` });
  }
  if (item.duration) {
    qs.push({ q: 'How long does it take?', a: `About ${item.duration}.` });
  }
  if (!qs.length) return '';
  return `<section><h2>Common questions</h2>${
    qs.map((x) => `<h3>${escapeHtml(x.q)}</h3><p>${escapeHtml(x.a)}</p>`).join('')
  }</section>`;
}

/** First two sentences of the operator's own text — a summary, not a reprint. */
function summarise(prose: string): string {
  const sentences = prose.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return sentences.length > 320 ? sentences.slice(0, 317) + '…' : sentences;
}

function jsonLd(item: SeoCatalogItem, title: string, canonical: string, slug: string): string {
  // No aggregateRating: Google's review-snippet policy wants first-party
  // ratings, and these are Viator's and Tripadvisor's. The histogram lives in
  // the visible HTML, which is what answer engines read anyway.
  const attraction = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: item.title,
    url: canonical,
    image: item.image_url || undefined,
    touristType: 'Leisure',
    address: { '@type': 'PostalAddress', addressCountry: 'AW' },
  };
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '10 days on Aruba', item: ORIGIN + '/' },
      { '@type': 'ListItem', position: 2, name: 'Things to do', item: ORIGIN + '/explore' },
      { '@type': 'ListItem', position: 3, name: item.title, item: canonical },
    ],
  };
  return [attraction, crumbs]
    .map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n</script>`)
    .join('\n');
}

/**
 * The beacon, inlined.
 *
 * src/lib/beacon.ts lives in the app bundle, which these pages deliberately do
 * not load — so without this they would be invisible to /stats and the whole
 * "did SEO send anyone" question would be unanswerable. Writes nothing to the
 * device, so it needs no consent banner, exactly like its app counterpart.
 * VITE_COLLECT_FN_URL is substituted at generate time by tools/build-seo.ts.
 */
const BEACON = `(function(){try{if(localStorage.getItem('10doa:no-analytics')==='true')return}catch(e){return}
var u='__COLLECT_URL__';if(!u)return;var b=JSON.stringify({name:'pageview',path:location.pathname});
try{navigator.sendBeacon?navigator.sendBeacon(u,new Blob([b],{type:'text/plain'})):fetch(u,{method:'POST',body:b,keepalive:true,headers:{'content-type':'text/plain'}})}catch(e){}})();`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/seo/render.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Mutation-check the two rules that matter most**

- Temporarily change the CTA to drop `viatorLink()` (use `item.viator_item_url` raw and strip `pid` from the fixture). Confirm "carries the affiliate parameters" FAILS. Revert.
- Temporarily make `ratingBlock` print a per-platform average as the headline. Confirm "shows the COMBINED rating" FAILS. Revert.

- [ ] **Step 6: Write the failing test for the curated renderer**

The 19 curated picks are the pages carrying genuinely original text — the
hand-written `localsSay`. They need a different renderer: they have no review
histogram, and their `rating`/`reviewCount` are editorial and must never appear.

Add to `src/seo/render.test.ts`:

```ts
import { renderCuratedPage } from './render';
import { ACTIVITIES } from '../data/activities';

const EAGLE = ACTIVITIES.find((a) => a.id === 'eagle-beach-morning')!;

const curated = (over: Partial<Parameters<typeof renderCuratedPage>[0]> = {}) =>
  renderCuratedPage({
    activity: EAGLE,
    slug: 'eagle-beach-morning-session',
    cssHref: '/assets/index-abc.css',
    buildDate: '2026-09-10',
    related: [{ title: 'Another Thing', url: '/things-to-do/another-thing/' }],
    ...over,
  });

describe('renderCuratedPage', () => {
  it('emits a complete document with a canonical', () => {
    expect(curated().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(curated()).toContain('https://10daysonaruba.com/things-to-do/eagle-beach-morning-session/');
  });

  it('renders the hand-written localsSay — the reason the page exists', () => {
    expect(curated()).toContain('Skip the hotel beach');
  });

  // THE invariant. activities.ts:26 — these are curation weights, not ratings.
  it('never publishes the editorial rating or review count', () => {
    const html = curated();
    expect(html).not.toContain('4.9');
    expect(html).not.toContain('2847');
    expect(html).not.toContain('reviews');
  });

  it('shows the practical facts it does have', () => {
    const html = curated();
    expect(html).toContain('Free');                  // cost
    expect(html).toContain('Eagle Beach, Noord');    // location
  });

  it('offers no booking CTA for a free activity', () => {
    expect(curated()).not.toContain('rel="noopener sponsored"');
  });

  it('still sends the reader to the planner', () => {
    expect(curated()).toContain('?ref=seo-eagle-beach-morning-session');
  });

  it('escapes a hostile localsSay rather than injecting it', () => {
    const html = curated({ activity: { ...EAGLE, localsSay: '<img onerror=x>' } });
    expect(html).not.toContain('<img onerror=x>');
    expect(html).toContain('&lt;img');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/seo/render.test.ts`
Expected: FAIL — `renderCuratedPage is not exported from './render'`.

- [ ] **Step 8: Write the curated renderer**

Append to `src/seo/render.ts`, and extend its imports with
`import type { Activity } from '../data/activities';` and
`bookUrlForActivity` from `'../data/exploreItems'`:

```ts
/**
 * A curated local pick.
 *
 * Deliberately NOT renderDataPage with different arguments: these pages have no
 * review histogram, and their `rating`/`reviewCount` are EDITORIAL ranking
 * weights that no platform backs (src/data/activities.ts:26). Sharing a
 * renderer with the Viator pages would be one refactor away from printing them
 * as if they were reviews. Two renderers, one of which structurally cannot.
 */
export function renderCuratedPage(input: {
  activity: Activity;
  slug: string;
  cssHref: string;
  buildDate: string;
  related: { title: string; url: string }[];
}): string {
  const { activity: a, slug, cssHref, buildDate, related } = input;
  const title = escapeHtml(a.title);
  const canonical = ORIGIN + urlFor(slug, 'things-to-do');
  const book = bookUrlForActivity(a);

  const facts: string[] = [];
  if (a.cost) facts.push(row('cost', 'Cost', a.cost));
  if (a.duration) facts.push(row('duration', 'How long', a.duration));
  if (a.timeOfDay) facts.push(row('when', 'Best time', a.timeOfDay));
  if (a.location) facts.push(row('location', 'Where', a.location));
  if (a.requires_car) facts.push(row('car', 'Getting there', 'You will want a car'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — 10 days on Aruba</title>
<meta name="description" content="${escapeHtml(a.description).slice(0, 160)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="stylesheet" href="${cssHref}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:url" content="${canonical}">
</head>
<body>
<main class="seo-page">
<nav class="seo-crumbs"><a href="/">10 days on Aruba</a> › <a href="/things-to-do/">Things to do</a> › <span>${title}</span></nav>

<h1>${title}</h1>
${a.image ? `<img src="${escapeHtml(a.image)}" alt="${title}" width="800" height="533" loading="lazy">` : ''}
<p>${escapeHtml(a.description)}</p>

${a.localsSay ? `<blockquote class="seo-locals">${escapeHtml(a.localsSay)}</blockquote>` : ''}

${facts.length ? `<section><h2>The practical details</h2><table class="seo-facts"><tbody>${facts.join('')}</tbody></table></section>` : ''}

${book ? `<p class="seo-cta"><a class="btn" href="${escapeHtml(book.url)}" target="_blank" rel="${book.affiliate ? 'noopener sponsored' : 'noopener'}">Book this</a></p>` : ''}
<p class="seo-plan"><a href="/questionnaire?ref=seo-${escapeHtml(slug)}">Build a full Aruba itinerary around this</a></p>

${related.length ? `<section><h2>Nearby and similar</h2><ul>${
  related.map((r) => `<li><a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a></li>`).join('')
}</ul></section>` : ''}

<p class="seo-freshness">Updated ${buildDate}</p>
</main>
<script>${BEACON}</script>
</body>
</html>
`;
}
```

Note there is no JSON-LD here: `jsonLd()` takes a `SeoCatalogItem`, and casting
an `Activity` into that shape to reuse it is exactly the kind of shortcut that
later leaks an editorial rating into structured data. If curated pages want
`TouristAttraction` markup, give them their own builder in a later change.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run src/seo/render.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 10: Mutation-check the editorial-rating guard**

Temporarily add `<p>${a.rating} from ${a.reviewCount} reviews</p>` to the
curated template. Confirm "never publishes the editorial rating or review
count" FAILS. Revert.

This is the most important test in the plan: it is the difference between
publishing data and publishing a fabrication.

- [ ] **Step 11: Commit**

```bash
git add src/seo/render.ts src/seo/render.test.ts
git commit -m "feat(seo): static renderers for Viator products and curated picks

Headline rating is the combined figure, matching the app and the Viator page a
visitor lands on; the per-platform split appears only as provenance, and only
when the platforms disagree by 0.3 or more.

Curated picks get a SEPARATE renderer that structurally cannot print their
editorial rating or review count — numbers no platform backs."
```


---

### Task 12: Sitemap and llms.txt

**Files:**
- Create: `src/seo/sitemap.ts`
- Create: `src/seo/sitemap.test.ts`

**Interfaces:**
- Consumes: `ORIGIN` from `src/lib/head`; `PAGE_TO_PATH`, `PRIVATE_PAGES` from `src/lib/pages`.
- Produces: `function renderSitemap(urls: SitemapEntry[]): string` where `type SitemapEntry = { loc: string; lastmod: string }`, `function publicRouteEntries(lastmod: string): SitemapEntry[]`, `function renderLlmsTxt(sections: { heading: string; links: { title: string; url: string }[] }[]): string`.

- [ ] **Step 1: Write the failing test**

Create `src/seo/sitemap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderSitemap, publicRouteEntries, renderLlmsTxt } from './sitemap';
import { PAGE_TO_PATH, PRIVATE_PAGES } from '../lib/pages';

describe('renderSitemap', () => {
  it('emits a valid urlset with absolute locs', () => {
    const xml = renderSitemap([{ loc: 'https://10daysonaruba.com/', lastmod: '2026-09-10' }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://10daysonaruba.com/</loc>');
    expect(xml).toContain('<lastmod>2026-09-10</lastmod>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('escapes ampersands so the XML stays well formed', () => {
    const xml = renderSitemap([{ loc: 'https://10daysonaruba.com/a?x=1&y=2', lastmod: '2026-09-10' }]);
    expect(xml).toContain('&amp;');
    expect(xml).not.toMatch(/&(?!amp;)/);
  });

  it('refuses a relative loc rather than emitting an invalid sitemap', () => {
    expect(() => renderSitemap([{ loc: '/relative', lastmod: '2026-09-10' }])).toThrow(/absolute/i);
  });
});

describe('publicRouteEntries', () => {
  it('includes the landing page', () => {
    expect(publicRouteEntries('2026-09-10').map((e) => e.loc))
      .toContain('https://10daysonaruba.com/');
  });

  // A noindex page in a sitemap is a direct contradiction: the sitemap asks for
  // indexing, the tag forbids it. Search Console reports it as an error.
  it('excludes every private route', () => {
    const locs = publicRouteEntries('2026-09-10').map((e) => e.loc);
    for (const p of PRIVATE_PAGES) {
      expect(locs).not.toContain('https://10daysonaruba.com' + PAGE_TO_PATH[p]);
    }
  });
});

describe('renderLlmsTxt', () => {
  it('lists each section and its links as markdown', () => {
    const txt = renderLlmsTxt([
      { heading: 'Guides', links: [{ title: 'Boat tours', url: '/guides/boat-tours/' }] },
    ]);
    expect(txt).toContain('# 10 days on Aruba');
    expect(txt).toContain('## Guides');
    expect(txt).toContain('- [Boat tours](https://10daysonaruba.com/guides/boat-tours/)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/seo/sitemap.test.ts`
Expected: FAIL — `Failed to resolve import "./sitemap"`.

- [ ] **Step 3: Write the module**

Create `src/seo/sitemap.ts`:

```ts
// sitemap.xml and llms.txt.
//
// Until this existed, /sitemap.xml fell through the SPA rewrite and returned
// index.html as text/html — an invalid sitemap rather than an absent one.

import { ORIGIN } from '../lib/head';
import { PAGE_TO_PATH, PRIVATE_PAGES, type PageId } from '../lib/pages';

export type SitemapEntry = { loc: string; lastmod: string };

export function renderSitemap(urls: SitemapEntry[]): string {
  const body = urls
    .map(({ loc, lastmod }) => {
      if (!loc.startsWith('http')) {
        throw new Error(`seo: sitemap loc must be absolute, got "${loc}"`);
      }
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The SPA routes worth submitting. Private routes are excluded: they carry
 * noindex, and a noindex URL inside a sitemap is a contradiction Search Console
 * reports as an error.
 */
export function publicRouteEntries(lastmod: string): SitemapEntry[] {
  const priv = new Set<PageId>(PRIVATE_PAGES);
  return (Object.keys(PAGE_TO_PATH) as PageId[])
    .filter((p) => !priv.has(p))
    .map((p) => ({ loc: ORIGIN + PAGE_TO_PATH[p], lastmod }));
}

/**
 * llms.txt — an emerging convention for telling answer engines what a site
 * holds. Adoption is uncertain and the cost is one file, which is the whole
 * argument for shipping it.
 */
export function renderLlmsTxt(
  sections: { heading: string; links: { title: string; url: string }[] }[],
): string {
  const head = `# 10 days on Aruba\n\n> A free Aruba trip planner, plus review data and practical detail for the island's activities. Ratings shown are combined across Viator and Tripadvisor.\n`;
  const body = sections
    .map((s) => `\n## ${s.heading}\n\n${s.links.map((l) => `- [${l.title}](${ORIGIN}${l.url})`).join('\n')}\n`)
    .join('');
  return head + body;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/seo/sitemap.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/seo/sitemap.ts src/seo/sitemap.test.ts
git commit -m "feat(seo): sitemap.xml and llms.txt renderers

Private routes are excluded from the sitemap: they carry noindex, and listing a
noindex URL is a contradiction Search Console flags as an error."
```

---

### Task 13: The build CLI, and wiring it into `npm run build`

**Files:**
- Create: `tools/build-seo.ts`
- Modify: `src/seo/render.ts` (append `renderIndexPage`)
- Modify: `src/components/Footer.tsx` (one link into the generated surface)
- Modify: `package.json` (`build` script)
- Modify: `content/slugs.json` (written by the run)
- Create: `src/seo/integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 7–12.
- Produces: `dist/things-to-do/<slug>/index.html`, `dist/sitemap.xml`, `dist/llms.txt`, and an updated `content/slugs.json`.

- [ ] **Step 1: Write the failing integration test**

Create `src/seo/integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

// These assert on the OUTPUT of `npm run build`. They skip when dist/ has not
// been built, so `npm test` stays fast and offline for everyone else.
const BUILT = existsSync('dist/sitemap.xml');
const d = BUILT ? describe : describe.skip;

d('generated output in dist/', () => {
  const sitemap = () => readFileSync('dist/sitemap.xml', 'utf8');
  const pages = () =>
    readdirSync('dist/things-to-do', { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ slug: e.name, html: readFileSync(`dist/things-to-do/${e.name}/index.html`, 'utf8') }));

  it('served robots.txt is a real file, not the SPA fallback', () => {
    expect(readFileSync('dist/robots.txt', 'utf8')).toContain('User-agent:');
  });

  it('generated both kinds of page — products and curated picks', () => {
    // 58 at the 2026-09-10 measurement; the range absorbs catalog churn without
    // absorbing a renderer silently dropping a whole category.
    expect(pages().length).toBeGreaterThanOrEqual(50);
    expect(pages().length).toBeLessThanOrEqual(70);
  });

  it('published the curated picks, not only the Viator products', () => {
    const all = pages().map((p) => p.html).join('');
    // localsSay text appears on no Viator page and cannot come from anywhere else.
    expect(all).toContain('Skip the hotel beach');
  });

  it('emits an index page that links every data page', () => {
    const idx = readFileSync('dist/things-to-do/index.html', 'utf8');
    for (const p of pages()) expect(idx).toContain(`/things-to-do/${p.slug}/`);
  });

  it('links the generated surface from the app footer', () => {
    expect(readFileSync('src/components/Footer.tsx', 'utf8')).toContain('href="/things-to-do/"');
  });

  it('lists every generated page in the sitemap', () => {
    const xml = sitemap();
    for (const p of pages()) expect(xml).toContain(`/things-to-do/${p.slug}/`);
  });

  // No orphans: a sitemap is a promise, internal links are the proof. The
  // index page above is the entry point; this checks the pages cross-link too.
  it('links every generated page from at least one other page', () => {
    const all = pages();
    const linked = new Set<string>();
    for (const p of all) {
      for (const other of all) {
        if (other.slug !== p.slug && p.html.includes(`/things-to-do/${other.slug}/`)) {
          linked.add(other.slug);
        }
      }
    }
    const orphans = all.filter((p) => !linked.has(p.slug)).map((p) => p.slug);
    expect(orphans, `orphaned pages: ${orphans.join(', ')}`).toHaveLength(0);
  });

  it('carries the affiliate parameters on every booking link', () => {
    for (const p of pages()) {
      expect(p.html, `${p.slug} lost pid`).toContain('pid=P00302487');
      expect(p.html, `${p.slug} lost mcid`).toContain('mcid=42383');
    }
  });

  it('never publishes an editorial rating as a platform rating', () => {
    // 2847 is eagle-beach-morning's editorial reviewCount — a number no
    // platform backs. Its appearance in output means the guard broke.
    for (const p of pages()) expect(p.html).not.toContain('2847 reviews');
  });

  it('has a real collect URL substituted into the beacon', () => {
    for (const p of pages()) expect(p.html).not.toContain('__COLLECT_URL__');
  });
});
```

- [ ] **Step 2: Run test to verify it skips**

Run: `npx vitest run src/seo/integration.test.ts`
Expected: SKIPPED (dist/sitemap.xml does not exist yet). That is the correct starting state.

- [ ] **Step 3: Add the index page renderer**

Without this, the 39 pages are reachable only from the sitemap — no internal
link points at any of them, so none of the equity the rest of the site has
reaches them.

Append to `src/seo/render.ts`:

```ts
/**
 * The hub-shaped index at /things-to-do/.
 *
 * This is the entry point into the generated surface: the footer links here,
 * and this links to every data page. Phase 2's five editorial guides will sit
 * between the two, but the crawl path must not wait for them.
 */
export function renderIndexPage(input: {
  entries: { title: string; url: string }[];
  cssHref: string;
  buildDate: string;
}): string {
  const { entries, cssHref, buildDate } = input;
  const canonical = ORIGIN + '/things-to-do/';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Things to do in Aruba — reviews and practical detail</title>
<meta name="description" content="Aruba activities with combined Viator and Tripadvisor review data, start times and what each trip actually involves.">
<link rel="canonical" href="${canonical}">
<link rel="stylesheet" href="${cssHref}">
</head>
<body>
<main class="seo-page">
<nav class="seo-crumbs"><a href="/">10 days on Aruba</a> › <span>Things to do</span></nav>
<h1>Things to do in Aruba</h1>
<p>${entries.length} activities, each with its combined review distribution, real start times, and what the trip involves. Ratings are summed across Viator and Tripadvisor — the same figure the booking page shows.</p>
<ul class="seo-index">${
  entries.map((e) => `<li><a href="${escapeHtml(e.url)}">${escapeHtml(e.title)}</a></li>`).join('')
}</ul>
<p class="seo-plan"><a href="/questionnaire?ref=seo-index">Build a full Aruba itinerary</a></p>
<p class="seo-freshness">Data updated ${buildDate}</p>
</main>
</body>
</html>
`;
}
```

- [ ] **Step 4: Link the generated surface from the footer**

In `src/components/Footer.tsx`, add a plain anchor beside the two `SpaLink`s
from Task 6:

```tsx
          <a href="/things-to-do/"
            style={{ fontSize: 11, color: '#666', textDecoration: 'underline' }}>
            Things to do in Aruba
          </a>
```

A plain `<a>`, not a `SpaLink`: `/things-to-do/` is a static page outside the
SPA, so a full navigation is correct rather than something to prevent.

- [ ] **Step 5: Write the CLI**

Create `tools/build-seo.ts`:

```ts
/**
 * Generate the static content surface into dist/, after `vite build`.
 *
 * Offline and deterministic by construction: every input is a committed file.
 * Refresh the catalog input with `npm run seo:refresh` — deliberately a
 * separate, hand-run step, because this one runs on every push to main.
 *
 * Fails loudly rather than skipping: silently emitting nothing would 404 every
 * content URL on the next deploy.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { cssHrefFromManifest } from '../src/seo/assets';
import { selectPages } from '../src/seo/floor';
import type { SeoCatalogItem, SeoCatalogSnapshot } from '../src/seo/catalog';
import { proposeRegistry, slugFor, urlFor } from '../src/seo/slugs';
import { renderDataPage, renderCuratedPage, renderIndexPage } from '../src/seo/render';
import { renderSitemap, publicRouteEntries, renderLlmsTxt } from '../src/seo/sitemap';
import { ORIGIN } from '../src/lib/head';

const DIST = 'dist';
const REGISTRY = 'content/slugs.json';
const MANIFEST_CANDIDATES = [`${DIST}/.vite/manifest.json`, `${DIST}/manifest.json`];

function main(): void {
  const buildDate = new Date().toISOString().slice(0, 10);

  const manifestPath = MANIFEST_CANDIDATES.find(existsSync);
  if (!manifestPath) {
    throw new Error(`seo: no Vite manifest at ${MANIFEST_CANDIDATES.join(' or ')} — run vite build first.`);
  }
  const cssHref = cssHrefFromManifest(readFileSync(manifestPath, 'utf8'));

  const snapshot = JSON.parse(readFileSync('src/data/seoCatalog.json', 'utf8')) as SeoCatalogSnapshot;
  const { products, curated } = selectPages(snapshot.items);

  // Refuse a product whose URL lost its affiliate parameters. A page that sends
  // traffic to Viator without pid/mcid is a page that earns nothing, and the
  // whole point of the surface is bookings.
  const publishable = products.filter((p) => {
    const ok = p.viator_item_url.includes('pid=') && p.viator_item_url.includes('mcid=');
    if (!ok) console.error(`seo: skipping ${p.id} — booking URL has no pid/mcid`);
    return ok;
  });
  if (!publishable.length) {
    throw new Error('seo: the quality floor selected no publishable products — refusing to emit an empty surface.');
  }

  const existing = existsSync(REGISTRY)
    ? (JSON.parse(readFileSync(REGISTRY, 'utf8')) as Record<string, string>)
    : {};
  // One registry for both kinds: they share the /things-to-do/ namespace, so a
  // curated pick and a Viator product must never collide on a slug.
  const registry = proposeRegistry(
    [
      ...publishable.map((p) => ({ id: p.id, title: p.title })),
      ...curated.map((a) => ({ id: a.id, title: a.title })),
    ],
    existing,
  );
  writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n');

  const collectUrl = readEnv('VITE_COLLECT_FN_URL');
  if (!collectUrl) {
    console.error('seo: WARNING — no VITE_COLLECT_FN_URL in .env.production; generated pages will not be counted in /stats.');
  }

  // Related links, from the cluster data the engine already computes: items
  // sharing an experience_cluster_id are the same real-world experience. Falls
  // back to catalog neighbours so no page is ever orphaned.
  const slugOf = (p: SeoCatalogItem) => slugFor(p.id, registry)!;
  const emitted: { title: string; url: string }[] = [];

  for (let i = 0; i < publishable.length; i++) {
    const item = publishable[i];
    const slug = slugOf(item);
    const related = pickRelated(item, publishable, registry, i);
    let html = renderDataPage({ item, slug, cssHref, buildDate, related });
    html = html.replace('__COLLECT_URL__', collectUrl ?? '');

    const dir = `${DIST}/things-to-do/${slug}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/index.html`, html);
    emitted.push({ title: item.title, url: urlFor(slug, 'things-to-do') });
  }

  // The 19 curated picks — the pages carrying hand-written localsSay, which is
  // the only text on this site that exists nowhere else.
  for (const activity of curated) {
    const slug = slugFor(activity.id, registry)!;
    const related = emitted
      .filter((e) => !e.gone)
      .slice(0, 3)
      .map((e) => ({ title: e.title, url: e.url }));
    let html = renderCuratedPage({ activity, slug, cssHref, buildDate, related });
    html = html.replace('__COLLECT_URL__', collectUrl ?? '');

    const dir = `${DIST}/things-to-do/${slug}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/index.html`, html);
    emitted.push({ title: activity.title, url: urlFor(slug, 'things-to-do'), gone: false });
  }

  mkdirSync(`${DIST}/things-to-do`, { recursive: true });
  writeFileSync(
    `${DIST}/things-to-do/index.html`,
    renderIndexPage({ entries: emitted, cssHref, buildDate }),
  );

  const entries = [
    ...publicRouteEntries(buildDate),
    { loc: `${ORIGIN}/things-to-do/`, lastmod: buildDate },
    ...emitted.map((e) => ({ loc: ORIGIN + e.url, lastmod: buildDate })),
  ];
  writeFileSync(`${DIST}/sitemap.xml`, renderSitemap(entries));
  writeFileSync(`${DIST}/llms.txt`, renderLlmsTxt([{ heading: 'Things to do in Aruba', links: emitted }]));

  console.log(`seo: ${publishable.length} product + ${curated.length} curated pages + index, ${entries.length} sitemap urls, css ${cssHref}`);
}

/**
 * Two related links per page, from the same experience cluster where one
 * exists. The index fallback guarantees every page links two others, which is
 * what keeps the surface free of orphans.
 */
function pickRelated(
  item: SeoCatalogItem,
  all: SeoCatalogItem[],
  registry: Record<string, string>,
  index: number,
): { title: string; url: string }[] {
  const sameCluster = item.experience_cluster_id
    ? all.filter((o) => o.id !== item.id && o.experience_cluster_id === item.experience_cluster_id)
    : [];
  const neighbours = [all[(index + 1) % all.length], all[(index + 2) % all.length]]
    .filter((o) => o && o.id !== item.id);
  const picked = [...sameCluster, ...neighbours]
    .filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i)
    .slice(0, 3);
  return picked.map((o) => ({ title: o.title, url: urlFor(slugFor(o.id, registry)!, 'things-to-do') }));
}

function readEnv(key: string): string | null {
  try {
    const raw = readFileSync('.env.production', 'utf8');
    return (raw.match(new RegExp(`^${key}=(.+)$`, 'm')) || [])[1]?.trim() || null;
  } catch {
    return null;
  }
}

main();
```

- [ ] **Step 6: Wire it into the build**

In `package.json`, change the `build` script and add a bundling step:

```json
    "build": "tsc --noEmit -p tsconfig.app.json && vite build && npm run seo:generate",
    "seo:generate": "node_modules/.bin/esbuild tools/build-seo.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/build-seo.mjs --log-level=warning && node node_modules/.cache/build-seo.mjs",
```

- [ ] **Step 7: Run the build**

Run: `npm run build`
Expected: the Vite output, then
`seo: 39 product + 19 curated pages + index, 65 sitemap urls, css /assets/index-….css`
— the 58 pages the spec commits to, plus the index. A non-zero exit means it
failed loudly, which is the intent: read the message rather than working around it.

- [ ] **Step 8: Run the integration test**

Run: `npx vitest run src/seo/integration.test.ts`
Expected: PASS (7 tests, no longer skipped).

- [ ] **Step 9: Look at a page in a browser**

Run: `npm run preview`

Open `/things-to-do/<any-slug>/` and confirm by eye: it is styled (the app's CSS applied), the histogram bars render, the booking link goes to Viator with `pid` in the URL, and the page links to related activities. Then check `/sitemap.xml` returns XML and `/robots.txt` returns text.

- [ ] **Step 10: Confirm the build stays offline**

Run:

```bash
rm -rf dist && npm run build
```

with the network disconnected, or verify by inspection that no step fetches. The build must succeed. If it does not, something reads the network and must be moved into `seo:refresh`.

- [ ] **Step 11: Run the whole suite**

Run: `npm run typecheck && npx vitest run`
Expected: clean typecheck; all tests pass including the newly-unskipped integration tests.

- [ ] **Step 12: Commit**

```bash
git add tools/build-seo.ts src/seo/render.ts src/components/Footer.tsx package.json content/slugs.json src/seo/integration.test.ts
git commit -m "feat(seo): generate the static content surface into dist/

Runs after vite build, offline and deterministic — every input is committed.
Refuses to emit a page whose booking URL lost pid/mcid, and fails loudly rather
than silently 404ing every content URL on the next deploy."
```

---

### Task 14: A vanished product keeps its URL

**Do this before the SECOND `npm run seo:refresh`, not before the first deploy.**
Nothing can vanish until the catalog is re-snapshotted, so this is not on the
critical path — but it must land before that happens, because the failure mode
is a 404 on a URL Google has already indexed.

**Why it is needed:** `dist/` is gitignored and CI rebuilds it from scratch on
every deploy. If a product drops out of the catalog, `seo:refresh` removes it
from the snapshot, the generator stops emitting its page, and the next deploy
turns an indexed URL into a 404 — discarding every link and every ranking
signal that URL had accumulated. The spec's invariant says the opposite: *"A
vanished product keeps its URL. It drops out of the sitemap and its CTA swaps
to the nearest live alternative. Deleting URLs discards equity for tidiness."*

**Files:**
- Modify: `src/seo/catalog.ts` (add the `gone` flag)
- Modify: `tools/build-seo-catalog.ts` (merge instead of overwrite)
- Modify: `src/seo/render.ts` (`renderDataPage` handles a gone item)
- Modify: `tools/build-seo.ts` (keep generating; exclude from sitemap)
- Modify: `src/seo/render.test.ts` (add the cases below)

**Interfaces:**
- Consumes: everything from Tasks 8–13.
- Produces: `SeoCatalogItem.gone?: true`; `renderDataPage` renders a "no longer listed" state; `tools/build-seo.ts` excludes gone URLs from `sitemap.xml` while still writing their HTML.

- [ ] **Step 1: Write the failing tests**

Add to `src/seo/render.test.ts`:

```ts
describe('a product that has left the catalog', () => {
  it('still renders a page rather than disappearing', () => {
    const html = page({ item: { ...SAMPLE, gone: true } });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain(SAMPLE.title);
  });

  it('drops the booking CTA instead of linking a dead product', () => {
    const html = page({ item: { ...SAMPLE, gone: true } });
    expect(html).not.toContain('Check dates and prices on Viator');
    expect(html).toContain('no longer listed');
  });

  it('still offers the related activities as somewhere to go', () => {
    const html = page({ item: { ...SAMPLE, gone: true } });
    expect(html).toContain('/things-to-do/another-thing/');
  });

  it('tells crawlers not to index it, without removing it', () => {
    const html = page({ item: { ...SAMPLE, gone: true } });
    expect(html).toContain('name="robots" content="noindex, follow"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/seo/render.test.ts`
Expected: FAIL — the CTA is still rendered and no robots tag is emitted.

- [ ] **Step 3: Add the flag to `src/seo/catalog.ts`**

Add to `SeoCatalogItem`:

```ts
  /**
   * Set by `seo:refresh` when a previously-snapshotted product is absent from
   * the live catalog. The item is RETAINED rather than deleted: its page keeps
   * its URL, loses its booking link, and leaves the sitemap. Deleting the row
   * would 404 an indexed page and discard every signal pointing at it.
   */
  gone?: true;
```

- [ ] **Step 4: Make the snapshot script merge rather than overwrite**

In `tools/build-seo-catalog.ts`, replace the `writeFileSync` call and the lines
building `items` with:

```ts
  const live: SeoCatalogItem[] = catalog.items.map((i) => ({
    id: i.id,
    title: i.title,
    image_url: i.image_url,
    viator_item_url: i.viator_item_url,
    duration: i.duration,
    price_usd: i.price_usd,
    review_count: i.review_count,
    experience_cluster_id: i.experience_cluster_id,
    tags: i.tags,
    sections: i.sections,
  }));

  // Retain anything we snapshotted before that the catalog no longer returns.
  // Its last-known title and image are exactly what its page needs to keep
  // existing at the URL Google already knows.
  const previous: SeoCatalogItem[] = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, 'utf8')) as SeoCatalogSnapshot).items
    : [];
  const liveIds = new Set(live.map((i) => i.id));
  const retained = previous
    .filter((i) => !liveIds.has(i.id))
    .map((i) => ({ ...i, gone: true as const }));

  if (retained.length) {
    console.log(`retaining ${retained.length} product(s) no longer in the catalog:`);
    for (const i of retained) console.log(`  ${i.id}  ${i.title}`);
  }

  const items = [...live, ...retained].sort((a, b) => a.id.localeCompare(b.id));
```

and extend its imports:

```ts
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import type { SeoCatalogItem, SeoCatalogSnapshot } from '../src/seo/catalog';
```

- [ ] **Step 5: Handle the gone state in `renderDataPage`**

In `src/seo/render.ts`, inside `renderDataPage`, replace the two CTA lines with:

```ts
${item.gone
  ? `<p class="seo-gone">This trip is <strong>no longer listed</strong> by its operator. The reviews below are kept for reference; the activities underneath are live alternatives.</p>`
  : `<p class="seo-cta"><a class="btn" href="${escapeHtml(book)}" target="_blank" rel="noopener sponsored">Check dates and prices on Viator</a></p>`}
<p class="seo-plan"><a href="/questionnaire?ref=seo-${escapeHtml(slug)}">Build a full Aruba itinerary around this</a></p>
```

and add to the `<head>` block, after the canonical:

```ts
${item.gone ? '<meta name="robots" content="noindex, follow">' : ''}
```

`noindex, follow` rather than a removal: the page stays reachable and keeps
passing equity through its links to the live alternatives, but stops competing
in the index itself.

- [ ] **Step 6: Exclude gone pages from the sitemap in `tools/build-seo.ts`**

The affiliate filter must not reject gone items (they have no live URL to
check), and the sitemap must not list them. Replace the `publishable` filter and
the sitemap assembly:

```ts
  const publishable = products.filter((p) => {
    if (p.gone) return true;   // keeps its URL; has no booking link to validate
    const ok = p.viator_item_url.includes('pid=') && p.viator_item_url.includes('mcid=');
    if (!ok) console.error(`seo: skipping ${p.id} — booking URL has no pid/mcid`);
    return ok;
  });
```

and, when building `emitted`, track which are live:

```ts
    emitted.push({ title: item.title, url: urlFor(slug, 'things-to-do'), gone: !!item.gone });
```

then filter the sitemap entries:

```ts
    ...emitted.filter((e) => !e.gone).map((e) => ({ loc: ORIGIN + e.url, lastmod: buildDate })),
```

Widen the local declaration to match:

```ts
  const emitted: { title: string; url: string; gone: boolean }[] = [];
```

`renderIndexPage` and `pickRelated` both take `{ title, url }`, so the extra
field is accepted by structural typing and needs no change there — but a gone
item should not be offered as a "live alternative", so filter it in
`pickRelated`:

```ts
  const sameCluster = item.experience_cluster_id
    ? all.filter((o) => o.id !== item.id && !o.gone && o.experience_cluster_id === item.experience_cluster_id)
    : [];
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/seo/render.test.ts src/seo/floor.test.ts`
Expected: PASS, including the four new cases.

- [ ] **Step 8: Prove the retention works end to end**

```bash
# snapshot, then hand-delete one item to simulate it vanishing
npm run seo:refresh
node -e "
const f='src/data/seoCatalog.json';const d=JSON.parse(require('fs').readFileSync(f,'utf8'));
const victim=d.items[0].id;d.items=d.items.slice(1);
require('fs').writeFileSync(f,JSON.stringify(d,null,1)+'\n');
console.log('removed',victim);"
npm run seo:refresh   # must report it as retained, not drop it
node -e "
const d=require('./src/data/seoCatalog.json');
const g=d.items.filter(i=>i.gone);console.log('gone:',g.length,g.map(i=>i.id));"
```

Expected: the second refresh prints `retaining 1 product(s)…` and the final
command lists it with `gone: true`. Then `npm run build` and confirm its page
still exists in `dist/things-to-do/` and its URL is absent from
`dist/sitemap.xml`.

- [ ] **Step 9: Restore a clean snapshot**

Run: `npm run seo:refresh` once more after manually removing the `gone` flag you
induced, or `git checkout src/data/seoCatalog.json && npm run seo:refresh`.
Confirm `git diff src/data/seoCatalog.json` shows no spurious `gone` entries
before committing.

- [ ] **Step 10: Commit**

```bash
git add src/seo/catalog.ts src/seo/render.ts src/seo/render.test.ts tools/build-seo-catalog.ts tools/build-seo.ts
git commit -m "feat(seo): a product leaving the catalog keeps its URL

dist/ is rebuilt from scratch on every deploy, so a vanished product used to
turn an indexed URL into a 404 and discard every signal pointing at it. The
snapshot now retains it, the page loses its booking link and gains noindex, and
its links keep pointing at live alternatives."
```

---

## Before the first deploy

Phase 1 changes what `npm run build` produces, and pushing to `main` deploys. Do these in order:

1. `npx vitest run` — the whole suite green.
2. `npm run build && npm run preview` — look at three generated pages by eye.
3. **`/code-review`** — mandatory before any push to main (`.claude/CLAUDE.md`).
4. Push. Then confirm against production: `curl -sI https://10daysonaruba.com/robots.txt` returns `content-type: text/plain`, and `curl -s https://10daysonaruba.com/sitemap.xml | head -2` returns XML.
5. Jan: add the property to **Google Search Console** and **Bing Webmaster Tools**, and submit `https://10daysonaruba.com/sitemap.xml`.
6. Record the `/stats` baseline the same day, so Phase 3 has a before.

## What this plan does NOT cover

Phase 2 (the five hub pages) and Phase 3 (measurement and the expand-or-cut decision) are deliberately out of scope. Phase 2 depends on Jan's editing time and on the `content/guides/*.md` pipeline, which is a separate plan once the data pages are live and the shape is proven.
