import { useEffect, useState } from 'react';
import Nav from './components/Nav';
import Landing from './pages/Landing';
import Explore from './pages/Explore';
import Questionnaire from './pages/Questionnaire';
import Itinerary from './pages/Itinerary';
import Privacy from './pages/Privacy';
import SurpriseMe from './pages/SurpriseMe';
import Dashboard from './pages/Dashboard';
import SignedInToast from './components/SignedInToast';
import LoginModal from './components/LoginModal';
import { AuthProvider, useAuth } from './lib/auth';

export type PageId = 'landing' | 'questionnaire' | 'explore' | 'itinerary' | 'privacy' | 'surprise' | 'dashboard';

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
};

export const DEFAULT_ANSWERS: Answers = {
  days: 9,
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
  '/questionnaire': 'questionnaire',
  '/privacy': 'privacy',
  '/surprise': 'surprise',
  '/dashboard': 'dashboard',
};
const PAGE_TO_PATH: Record<PageId, string> = {
  landing: '/',
  questionnaire: '/questionnaire',
  explore: '/explore',
  itinerary: '/itinerary',
  privacy: '/privacy',
  surprise: '/surprise',
  dashboard: '/dashboard',
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
  const [answers, setAnswers] = useState<Answers>(DEFAULT_ANSWERS);
  const [loginOpen, setLoginOpen] = useState(false);
  const [shareId, setShareId] = useState<string | null>(shareIdFromUrl);
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

  function setPage(p: PageId) {
    const path = PAGE_TO_PATH[p];
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setShareId(null);
    setPageState(p);
  }

  useEffect(() => {
    const onPop = () => { setPageState(pageFromUrl()); setShareId(shareIdFromUrl()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [page]);

  // Gate the itinerary: a visitor who hasn't completed the questionnaire is sent
  // there first. Shared links are exempt; wait for auth so a signed-in user on a
  // fresh device isn't bounced before their session loads.
  useEffect(() => {
    if (authLoading) return;
    if (page === 'itinerary' && !shareId && !canSeeItinerary) setPage('questionnaire');
  }, [page, shareId, canSeeItinerary, authLoading]);

  return (
    <>
      <SignedInToast />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <Nav page={page} setPage={setPage} onLogin={() => setLoginOpen(true)} canSeeItinerary={canSeeItinerary} />
      {page === 'landing'       && <Landing       setPage={setPage} answers={answers} setAnswers={setAnswers} />}
      {page === 'questionnaire' && <Questionnaire setPage={setPage} answers={answers} setAnswers={setAnswers} onComplete={markQuestionnaireDone} />}
      {page === 'explore'       && <Explore       setPage={setPage} answers={answers} />}
      {page === 'itinerary'     && (canSeeItinerary || shareId) && <Itinerary setPage={setPage} answers={answers} setAnswers={setAnswers} onLogin={() => setLoginOpen(true)} shareId={shareId} />}
      {page === 'privacy'       && <Privacy       setPage={setPage} />}
      {page === 'surprise'      && <SurpriseMe    setPage={setPage} />}
      {page === 'dashboard'     && <Dashboard     setPage={setPage} onLogin={() => setLoginOpen(true)} />}
    </>
  );
}
