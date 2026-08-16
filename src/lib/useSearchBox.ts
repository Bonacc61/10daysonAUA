import { useMemo, useState } from 'react';
import { searchByMeaning, semanticSearchEnabled, type QueryConstraint } from './semanticSearch';
import type { SemanticState } from './entrySearch';

/**
 * The state behind a search box, shared by Explore and My Aruba > Personalized.
 *
 * The space bar ARMS search-by-meaning rather than switching to it. One word is
 * nearly always a name or a noun — "Zeerover", "snorkel" — and substring
 * matching answers those instantly, locally and for free. Two or more words is
 * where people start describing intent, and that is the only case worth a
 * network round trip to a US sub-processor. Substring results stay live
 * throughout: arming never blanks or delays what is already on screen, so a
 * two-word KEYWORD search ("baby beach") keeps working and Enter merely adds
 * to it.
 */
export type SearchBox = {
  query: string;
  setQuery: (v: string) => void;
  clear: () => void;
  /** Search-by-meaning is available AND the query is long enough to be intent. */
  armed: boolean;
  pending: boolean;
  /** The call was made and did not come back — distinct from "found nothing". */
  failed: boolean;
  /** The ids on screen already answer exactly what is in the box. */
  answered: boolean;
  semantic: SemanticState;
  run: () => Promise<void>;
};

export function useSearchBox(): SearchBox {
  const [query, setQueryRaw] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [constraint, setConstraint] = useState<QueryConstraint | null>(null);
  const [answers, setAnswers] = useState('');   // the query those ids answer
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Editing the query clears the FAILURE, not the results: the ids stay until a
  // new search replaces them, and searchEntries stops blending them the moment
  // the text no longer matches what they answer.
  const setQuery = (v: string) => { setQueryRaw(v); setFailed(false); };

  const armed = semanticSearchEnabled() && query.trim().includes(' ');
  const answered = query.trim() === answers && answers !== '';

  const run = async () => {
    const q = query.trim();
    if (!armed || pending || !q) return;
    if (q === answers) return;          // already answered; don't spend a quota row on it
    setPending(true);
    setFailed(false);
    const out = await searchByMeaning(q);
    setPending(false);
    if (!out.ok) { setFailed(true); return; }
    setIds(out.ids);
    setConstraint(out.constraint);
    setAnswers(q);
  };

  // Memoised because callers put it in a useMemo dependency list. A fresh object
  // literal every render is a NEW identity to React's comparison, which silently
  // defeats their memo — measured at 0.25 ms of needless work per render of the
  // Personalized panel on the live catalog. Small, but the memo is a lie without
  // this and the cost grows with the catalog.
  const semantic = useMemo(() => ({ ids, answers, constraint }), [ids, answers, constraint]);

  return {
    query, setQuery, clear: () => setQuery(''),
    armed, pending, failed, answered,
    semantic,
    run,
  };
}
