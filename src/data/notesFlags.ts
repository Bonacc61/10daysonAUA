import type { Answers } from '../App';

// === Free-text "Anything we should know?" → contraindication flags ===========
// The Q8 free-text box (specialNotes) lets travellers describe constraints in
// their own words. We scan it for a small set of HIGH-CONFIDENCE contraindication
// phrases and map each to an existing structured flag, so "I get seasick" excludes
// boats exactly as ticking the "Boats & water tours" pill would.
//
// Deliberately conservative: only unambiguous medical/physical constraints are
// matched (a false exclusion is worse than a miss — the pills remain the primary,
// explicit control). Patterns use word boundaries to avoid place-name collisions
// (e.g. "Baby Beach" must not trigger a with-baby flag), which is why bare nouns
// like "baby" are intentionally absent. Extend the table as real notes reveal
// phrasings worth catching.
const NOTE_FLAG_PATTERNS: Array<{ flag: string; re: RegExp }> = [
  { flag: 'no-boats', re: /\b(sea-?sick(ness)?|motion[\s-]?sick(ness)?)\b/i },
  { flag: 'mobility', re: /\b(wheelchair|limited mobility|mobility (issue|problem|need|concern)s?|can'?t walk (far|much)|difficulty walking|hard to walk)\b/i },
  { flag: 'no-car', re: /\b(no (rental )?car|without a car|not renting a car|don'?t (have|want) a car|no driving)\b/i },
];

// Structured flags implied by the free-text notes. Empty for empty/absent notes.
export function flagsFromNotes(notes?: string): string[] {
  if (!notes) return [];
  const out: string[] = [];
  for (const { flag, re } of NOTE_FLAG_PATTERNS) if (re.test(notes)) out.push(flag);
  return out;
}

// The effective flag set the engine acts on: the traveller's ticked Q8 pills
// UNION the contraindications parsed from their free-text notes. Single chokepoint
// so tag derivation (answersToTags) and catalog filtering (applyCatalogFlags) stay
// consistent — a notes-derived flag behaves identically to a ticked pill.
export function effectiveFlags(a: Answers): Set<string> {
  return new Set([...(a.flags ?? []), ...flagsFromNotes(a.specialNotes)]);
}
