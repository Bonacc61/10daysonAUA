import { useEffect, useState } from 'react';
import Nav from './components/Nav';
import Landing from './pages/Landing';
import Explore from './pages/Explore';
import Questionnaire from './pages/Questionnaire';
import Itinerary from './pages/Itinerary';
import SignedInToast from './components/SignedInToast';
import LoginModal from './components/LoginModal';
import { AuthProvider } from './lib/auth';

export type PageId = 'landing' | 'questionnaire' | 'explore' | 'itinerary';

export type Answers = {
  days: number;
  groupType: string;
  budget: string;
  interests: string[];
  adventureLevel: number;
  startOffset: number;
  lodging: string;
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
  specialNotes: '',
};

const PATH_TO_PAGE: Record<string, PageId> = {
  '/explore': 'explore',
  '/itinerary': 'itinerary',
  '/questionnaire': 'questionnaire',
};
const PAGE_TO_PATH: Record<PageId, string> = {
  landing: '/',
  questionnaire: '/questionnaire',
  explore: '/explore',
  itinerary: '/itinerary',
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
  const [page, setPageState] = useState<PageId>(pageFromUrl);
  const [answers, setAnswers] = useState<Answers>(DEFAULT_ANSWERS);
  const [loginOpen, setLoginOpen] = useState(false);
  const [shareId, setShareId] = useState<string | null>(shareIdFromUrl);

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

  return (
    <AuthProvider>
      <SignedInToast />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <Nav page={page} setPage={setPage} onLogin={() => setLoginOpen(true)} />
      {page === 'landing'       && <Landing       setPage={setPage} answers={answers} setAnswers={setAnswers} />}
      {page === 'questionnaire' && <Questionnaire setPage={setPage} answers={answers} setAnswers={setAnswers} />}
      {page === 'explore'       && <Explore       setPage={setPage} answers={answers} />}
      {page === 'itinerary'     && <Itinerary     setPage={setPage} answers={answers} setAnswers={setAnswers} onLogin={() => setLoginOpen(true)} shareId={shareId} />}
    </AuthProvider>
  );
}
