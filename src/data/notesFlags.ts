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
  // "no car" but NOT "no car seat" (a false exclusion of car-required activities).
  { flag: 'no-car', re: /\b(no (rental )?car(?!\s*seat)|without a car|not renting a car|don'?t (have|want) a car|no driving)\b/i },
];

// Structured flags implied by the free-text notes. Empty for empty/absent notes.
export function flagsFromNotes(notes?: string): string[] {
  if (!notes) return [];
  const out: string[] = [];
  for (const { flag, re } of NOTE_FLAG_PATTERNS) if (re.test(notes)) out.push(flag);
  return out;
}

// === Group-type applicability ================================================
// Some Q8 flags only make sense for certain Q2 group types — a solo traveller
// isn't on a honeymoon. Flags absent from this table apply to every group.
// Questionnaire.tsx reads the same table to decide which pills to render, so
// what the traveller can see and what the engine acts on cannot drift apart.
// A Map, not an object literal: `flags` reaches here from localStorage and from the
// `answers` jsonb of a public shared itinerary, so the key is untrusted. A plain
// object would resolve `flags: ['toString']` to Object.prototype and throw on the
// lookup, blanking the page for anyone opening that share link.
const FLAG_APPLIES_TO = new Map<string, readonly string[]>([
  ['honeymoon',  ['Couple']],
  ['with-baby',  ['Couple', 'Family with young kids', 'Multi-gen']],
]);

// Is this flag meaningful for this group? Unrestricted flags are always true.
export function flagAppliesTo(flag: string, groupType: string): boolean {
  const groups = FLAG_APPLIES_TO.get(flag);
  return !groups || groups.includes(groupType);
}

// The effective flag set the engine acts on: the traveller's ticked Q8 pills
// (minus any that don't apply to their group) UNION the contraindications parsed
// from their free-text notes. Single chokepoint so tag derivation (answersToTags)
// and catalog filtering (applyCatalogFlags) stay consistent — a notes-derived flag
// behaves identically to a ticked pill.
//
// Filtering here rather than at the point of selection is what makes an
// inapplicable flag harmless: saved answers from before a flag was restricted
// (localStorage `10doa:answers` outlives any UI change) can hold combinations the
// questionnaire no longer offers, and a pill the traveller cannot see must not
// shape their plan. Caveat: hashAnswers() still seeds the RNG from the raw
// a.flags, so a dropped flag can still change *which* equally-valid plan comes
// back — it just no longer applies its constraint.
// Notes-derived flags are never filtered — those come from what the traveller
// actually wrote, so they stand regardless of group.
export function effectiveFlags(a: Answers): Set<string> {
  const ticked = (a.flags ?? []).filter((f) => flagAppliesTo(f, a.groupType));
  return new Set([...ticked, ...flagsFromNotes(a.specialNotes)]);
}
