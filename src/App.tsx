import { lazy, Suspense, useEffect, useState } from 'react';
import { trackPageview, trackOutbound } from './lib/beacon';
import type { Section } from './types';
import Nav from './components/Nav';
import Landing from './pages/Landing';
// Every page except Landing is split out of the initial bundle. One chunk used
// to carry all of them, so opening /stats downloaded Explore, the questionnaire,
// the itinerary and the dashboard as well — 418 KB gzipped before the page could
// render. Landing stays eager because it IS the first paint for most visitors.
const Explore = lazy(() => import('./pages/Explore'));
const Questionnaire = lazy(() => import('./pages/Questionnaire'));
const Itinerary = lazy(() => import('./pages/Itinerary'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const SurpriseMe = lazy(() => import('./pages/SurpriseMe'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DashboardPreview = lazy(() => import('./pages/DashboardPreview'));
import SignedInToast from './components/SignedInToast';
import LoginModal from './components/LoginModal';
import CookieBanner from './components/CookieBanner';
const TripMap = lazy(() => import('./pages/Map'));
const Stats = lazy(() => import('./pages/Stats'));
// Not imported from the lazy chunk: this is read at boot, before /stats loads.
const AFTER_LOGIN_STATS = '10doa:after-login-stats';
import { AuthProvider, useAuth } from './lib/auth';

export type PageId = 'landing' | 'questionnaire' | 'explore' | 'itinerary' | 'map' | 'privacy' | 'terms' | 'surprise' | 'dashboard' | 'preview' | 'stats';

export type Answers = {
  days: number;
  groupType: string;
  budget: string;
  interests: string[];
  adventureLevel: number;
  startOffset: number;
  lodging: string;
  flags: string[];
  specialNotes: string;
  tripName?: string;
};

export const DEFAULT_ANSWERS: Answers = {
  days: 10,
  groupType: '',
  budget: '',
  interests: [],
  adventureLevel: 50,
  startOffset: 7,
  lodging: '',
  flags: [],
  specialNotes: '',
};

const PATH_TO_PAGE: Record<string, PageId> = {
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
const PAGE_TO_PATH: Record<PageId, string> = {
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

function pageFromUrl(): PageId {
  if (shareIdFromUrl()) return 'itinerary';
  return PATH_TO_PAGE[window.location.pathname] ?? 'landing';
}

// A shared itinerary lives at /i/<id>. Pure so it can be unit-tested; the
// window-reading wrapper below is what the app calls.
export function shareIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/i\/([A-Za-z0-9]{1,32})\/?$/);
  return m ? m[1] : null;
}
export function shareIdFromUrl(): string | null {
  return shareIdFromPath(window.location.pathname);
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

function AppShell() {
  const { user, loading: authLoading } = useAuth();
  const [page, setPageState] = useState<PageId>(pageFromUrl);
  const [answers, setAnswers] = useState<Answers>(() => {
    try {
      const raw = localStorage.getItem('10doa:answers');
      if (raw) return { ...DEFAULT_ANSWERS, ...JSON.parse(raw) as Partial<Answers> };
    } catch { /* ignore */ }
    return DEFAULT_ANSWERS;
  });
  const [loginOpen, setLoginOpen] = useState(false);
  const [qInitialStep, setQInitialStep] = useState(1);
  const [shareId, setShareId] = useState<string | null>(shareIdFromUrl);
  const [initialExploreSection, setInitialExploreSection] = useState<Section | null>(null);
  // The shortlist used to live here as session-only state. It is localStorage-backed
  // in `lib/shortlist.ts` since 2026-08-05, so each page reads it directly.
  // Set once the questionnaire is completed; persisted so a refresh doesn't re-lock.
  const [qDone, setQDone] = useState<boolean>(() => {
    try { return localStorage.getItem('qDone') === '1'; } catch { return false; }
  });

  // The itinerary unlocks once the questionnaire is done, for a signed-in user
  // (they've already engaged), or when viewing a shared /i/<id> link.
  const canSeeItinerary = qDone || !!user;

  const markQuestionnaireDone = () => {
    try { localStorage.setItem('qDone', '1'); } catch { /* ignore */ }
    setQDone(true);
  };

  const saveAndSetAnswers = (a: Answers | ((prev: Answers) => Answers)) => {
    setAnswers((prev) => {
      const next = typeof a === 'function' ? a(prev) : a;
      try { localStorage.setItem('10doa:answers', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  function setPage(p: PageId) {
    setInitialExploreSection(null);
    if (p !== 'questionnaire') setQInitialStep(1);
    const path = PAGE_TO_PATH[p];
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setShareId(null);
    setPageState(p);
  }

  const navigateToExplore = (section: Section) => {
    setPage('explore');
    setInitialExploreSection(section);
  };

  useEffect(() => {
    const onPop = () => { setPageState(pageFromUrl()); setShareId(shareIdFromUrl()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [page]);

  // --- Cookieless traffic beacon (src/lib/beacon.ts) ------------------------
  //
  // Deliberately NOT alongside the PostHog calls: this pipe writes nothing to
  // the device, so it runs on legitimate interest and counts everyone, while
  // PostHog is consent-gated and counts the consented share. The two must not
  // be merged — see the header of beacon.ts.
  //
  // Keyed on `page` rather than on pathname because this is a single-page app:
  // `setPage` pushes history without a navigation, so there is no load event to
  // hang a pageview on after the first one.
  useEffect(() => {
    // /stats is the operator's own dashboard, not traffic. Counting it would put
    // every visit to the numbers into the numbers — as an 'other' pageview,
    // since it is deliberately absent from the beacon's path allowlist.
    if (page === 'stats') return;
    trackPageview(window.location.pathname);
  }, [page]);

  // A magic link started from /stats should come back to /stats. It asks
  // Supabase to return there, but Supabase only redirects to allowlisted URLs
  // and otherwise drops the traveller on the site root — so the dashboard leaves
  // a one-shot marker before sending the mail and we honour it once the session
  // has resolved. sessionStorage, not localStorage: it belongs to this tab and
  // this trip through the mail client, and must not outlive either.
  useEffect(() => {
    if (authLoading || !user) return;
    try {
      if (sessionStorage.getItem(AFTER_LOGIN_STATS) !== '1') return;
      sessionStorage.removeItem(AFTER_LOGIN_STATS);
      setPage('stats');
    } catch { /* private mode: they land on the home page, which is survivable */ }
  }, [authLoading, user]);

  // ONE DELEGATED LISTENER rather than a handler on each link. There are six
  // render sites for a Book now link today (ItineraryCard, GroupCard, Explore,
  // Dashboard x3) and the seventh is the one that would silently not be
  // measured. Capture phase, so it still fires if something downstream stops
  // propagation, and `closest('a')` so a click on the label inside the anchor
  // counts.
  //
  // The product code is parsed from OUR OWN affiliate URL (`/d28-62666P1?...`),
  // never from anything a traveller typed.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (!/^https?:\/\//.test(href)) return;
      let host = '';
      try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { return; }
      if (!/(^|\.)viator\.com$/.test(host)) return;
      const product = href.match(/\/d\d+-([A-Za-z0-9]+)/)?.[1];
      trackOutbound(href, product);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Gate the itinerary: a visitor who hasn't completed the questionnaire is sent
  // there first. Shared links are exempt; wait for auth so a signed-in user on a
  // fresh device isn't bounced before their session loads.
  useEffect(() => {
    if (authLoading) return;
    if (page === 'itinerary' && !shareId && !canSeeItinerary) setPage('questionnaire');
  }, [page, shareId, canSeeItinerary, authLoading]);

  return (
    <>
      <CookieBanner onPrivacy={() => setPage('privacy')} />
      <SignedInToast />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <Nav page={page} setPage={setPage} onLogin={() => setLoginOpen(true)} canSeeItinerary={canSeeItinerary} />
      {/* One boundary around the lot. The fallback is deliberately a plain
          coloured block rather than a spinner: chunks are same-origin and
          fingerprinted, so on any normal connection it is gone within a frame,
          and a spinner that flashes for 40ms reads as jank. */}
      <Suspense fallback={<div style={{ background: 'var(--cream)', minHeight: '70vh' }} />}>
      {page === 'landing'       && <Landing       setPage={setPage} answers={answers} setAnswers={saveAndSetAnswers} onPlanClick={() => { setQInitialStep(2); setPage('questionnaire'); }} />}
      {page === 'questionnaire' && <Questionnaire setPage={setPage} answers={answers} setAnswers={saveAndSetAnswers} onComplete={markQuestionnaireDone} initialStep={qInitialStep} />}
      {page === 'explore'       && <Explore       setPage={setPage} answers={answers} canSeeItinerary={canSeeItinerary} initialSection={initialExploreSection ?? undefined} />}
      {page === 'itinerary'     && (canSeeItinerary || shareId) && <Itinerary setPage={setPage} answers={answers} setAnswers={saveAndSetAnswers} onLogin={() => setLoginOpen(true)} shareId={shareId} onNavigateToExplore={navigateToExplore} />}
      {page === 'map'           && <TripMap setPage={setPage} answers={answers} canSeeItinerary={canSeeItinerary} />}
      {page === 'privacy'       && <Privacy       setPage={setPage} />}
      {page === 'terms'         && <Terms         setPage={setPage} />}
      {page === 'surprise'      && <SurpriseMe    setPage={setPage} answers={answers} />}
      {page === 'dashboard'     && <Dashboard     setPage={setPage} onLogin={() => setLoginOpen(true)} answers={answers} />}
      {page === 'preview'       && <DashboardPreview setPage={setPage} />}
      {page === 'stats'         && <Stats           setPage={setPage} />}
      </Suspense>
    </>
  );
}
