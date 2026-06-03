import { useEffect, useState } from 'react';
import Nav from './components/Nav';
import Landing from './pages/Landing';
import Explore from './pages/Explore';
import Questionnaire from './pages/Questionnaire';
import Itinerary from './pages/Itinerary';
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

export default function App() {
  const [page, setPage] = useState<PageId>('landing');
  const [answers, setAnswers] = useState<Answers>(DEFAULT_ANSWERS);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [page]);

  return (
    <AuthProvider>
      <Nav page={page} setPage={setPage} />
      {page === 'landing'       && <Landing       setPage={setPage} answers={answers} setAnswers={setAnswers} />}
      {page === 'questionnaire' && <Questionnaire setPage={setPage} answers={answers} setAnswers={setAnswers} />}
      {page === 'explore'       && <Explore       setPage={setPage} />}
      {page === 'itinerary'     && <Itinerary     setPage={setPage} answers={answers} setAnswers={setAnswers} />}
    </AuthProvider>
  );
}
