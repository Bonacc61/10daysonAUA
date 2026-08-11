import type { CardEntry, MatchTag, Region, SwapReason } from '../types';
import { isWaterBased, itemAdventure, adventureCapForFlags } from './itemFit';
import { entryPrice } from './matcher';

// === Edit constraints — the one vocabulary for narrowing a swap pool =========
// Both the "Why swap?" chips and (behind VITE_NL_EDIT) a traveller's own words
// resolve to one of these before anything touches the catalog. That indirection
// is the whole safety property of the natural-language path: the model picks
// values from a closed menu — MatchTag, Region, the Q8 flag ids — and never
// writes a filter, ranks a candidate, or names an activity. Everything below
// this type is deterministic and unit-tested.
//
// Deliberately NOT here: a slot. A swap replaces a card in a slot the plan has
// already fixed, so "make it an evening thing" is a MOVE, not a swap, and
// belongs to whatever ships day-level editing.
export type EditConstraint = {
  cheaper?: true;             // strictly cheaper than the current card
  maxPriceUsd?: number;       // an explicit ceiling ("under $50")
  differentKind?: true;       // not the same category / Viator group
  differentRegion?: true;     // anywhere but where the current card is
  region?: Region;            // a named part of the island
  interests?: MatchTag[];     // questionnaire interest tags, unchanged
  flags?: string[];           // Q8 flag ids, unchanged
  adventure?: 'lower' | 'higher';
};

// The five chips, expressed in the same vocabulary. Itinerary.tsx looks each
// chip up here and calls constrainByEdit, so chips and free text run the
// identical code — there is no separate chip implementation.
export const CHIP_CONSTRAINTS: Record<SwapReason, EditConstraint> = {
  'too-pricey':        { cheaper: true },
  'too-far':           { differentRegion: true },
  'not-our-vibe':      { differentKind: true },
  'done-it':           {},
  'just-show-another': {},
};

// --- Entry-level readers ----------------------------------------------------
// A CardEntry is either a curated local activity or a Viator group showing one
// item. Every constraint reads the same dimension off both shapes here, so no
// rule below has to branch on entry kind.

function entryCategory(e: CardEntry): string {
  return e.kind === 'group' ? e.group.id : e.activity.category;
}

function entryRegion(e: CardEntry): Region | undefined {
  return e.kind === 'group' ? (e.bestSeller.region ?? e.group.region) : e.activity.region;
}

// Mirrors applyCatalogFlags: a curated activity with no curated value is
// treated as gentle (20), because local picks are beaches and viewpoints.
function entryAdventure(e: CardEntry): number {
  return e.kind === 'group' ? itemAdventure(e.bestSeller) : (e.activity.adventure ?? 20);
}

function entryIsWater(e: CardEntry): boolean {
  return e.kind === 'group'
    ? isWaterBased(e.bestSeller)
    : (e.activity.sections ?? []).includes('cruises-water');
}

function entryTags(e: CardEntry): MatchTag[] {
  return e.kind === 'group' ? e.group.matched_by : e.activity.matched_by;
}

// --- Rules ------------------------------------------------------------------
// Each rule is a predicate plus a `hard` bit. A soft rule that empties the pool
// gives way (a preference the traveller would trade for getting *something*); a
// hard one does not (a budget or a contraindication they meant literally).
type Rule = { hard: boolean; keep: (c: CardEntry) => boolean };

function rulesFor(c: EditConstraint, current: CardEntry): Rule[] {
  const rules: Rule[] = [];

  // Soft first, hard last: relaxation walks this list from the front, so the
  // ORDER HERE IS THE RELAXATION ORDER. Price and flags sit at the back on
  // purpose — "under $50" and "not on a boat" are not preferences to trade away.
  if (c.differentRegion) {
    const r = entryRegion(current);
    if (r) rules.push({ hard: false, keep: (e) => entryRegion(e) !== r });
  }
  if (c.region) {
    const want = c.region;
    rules.push({ hard: false, keep: (e) => entryRegion(e) === want });
  }
  if (c.interests?.length) {
    const want = new Set(c.interests);
    rules.push({ hard: false, keep: (e) => entryTags(e).some((t) => want.has(t)) });
  }
  if (c.adventure) {
    const cur = entryAdventure(current);
    rules.push(c.adventure === 'lower'
      ? { hard: false, keep: (e) => entryAdventure(e) < cur }
      : { hard: false, keep: (e) => entryAdventure(e) > cur });
  }
  if (c.differentKind) {
    const cat = entryCategory(current);
    rules.push({ hard: false, keep: (e) => entryCategory(e) !== cat });
  }

  // Hard from here down.
  if (c.flags?.length) {
    const flags = new Set(c.flags);
    if (flags.has('no-boats')) rules.push({ hard: true, keep: (e) => !entryIsWater(e) });
    // Mirrors applyCatalogFlags: Viator tours include hotel pickup, so only
    // curated local picks can require a car.
    if (flags.has('no-car')) {
      rules.push({ hard: true, keep: (e) => e.kind === 'group' || !e.activity.requires_car });
    }
    const cap = adventureCapForFlags(flags);
    if (cap !== null) rules.push({ hard: true, keep: (e) => entryAdventure(e) <= cap });
  }
  if (typeof c.maxPriceUsd === 'number') {
    const cap = c.maxPriceUsd;
    rules.push({ hard: true, keep: (e) => entryPrice(e) <= cap });
  }
  if (c.cheaper) {
    const cap = entryPrice(current);
    rules.push({ hard: true, keep: (e) => entryPrice(e) < cap });
  }

  return rules;
}

/**
 * Can this constraint be satisfied by rotating to another item in the SAME
 * Viator group? Only price can: every item in a group is the same sort of
 * experience, so a flag, region, interest or intensity ask needs a different
 * group entirely. Itinerary.tsx checks this before taking its within-group
 * rotation shortcut, which does not run the pool through constrainByEdit.
 *
 * `differentRegion` is deliberately NOT listed: the "too far" chip has always
 * gone through rotation, and items can carry their own region override, so
 * excluding it here would change long-shipped chip behaviour. That is a
 * separate question from this one.
 */
export function satisfiableByRotation(c: EditConstraint): boolean {
  return !c.flags?.length && !c.region && !c.interests?.length && !c.adventure;
}

/**
 * Narrow a candidate pool by a constraint.
 *
 * Applies every rule as an intersection. If that comes back empty, soft rules
 * are dropped one at a time from the front until something survives — so a
 * traveller who asked for two things and can only have one gets the one they
 * were least likely to be flexible about. Hard rules are never dropped: an
 * empty result means the caller must not swap, which is exactly the behaviour
 * "too pricey" has always had (surfacing a pricier pick for it is the bug).
 */
export function constrainByEdit(
  candidates: CardEntry[],
  constraint: EditConstraint,
  current: CardEntry,
): CardEntry[] {
  const rules = rulesFor(constraint, current);
  if (rules.length === 0) return candidates;

  const apply = (rs: Rule[]) => candidates.filter((e) => rs.every((r) => r.keep(e)));

  let active = rules;
  let kept = apply(active);
  while (kept.length === 0 && active.some((r) => !r.hard)) {
    // Drop the frontmost soft rule and retry.
    const i = active.findIndex((r) => !r.hard);
    active = [...active.slice(0, i), ...active.slice(i + 1)];
    kept = apply(active);
  }

  // Cheapest-first is meaningful whenever price was the ask; otherwise the
  // caller's own ranking (fit, then popularity) is the better order.
  if (constraint.cheaper || typeof constraint.maxPriceUsd === 'number') {
    kept = [...kept].sort((a, b) => entryPrice(a) - entryPrice(b));
  }
  return kept;
}

// Only flags that rulesFor() actually acts on appear here — the caption must
// never claim something the code did not do. Two Q8 flags are deliberately
// absent from the whole swap vocabulary (here AND in the edge function's enum):
//   no-early-mornings — gates the morning SLOT, and a swap cannot change the
//                       slot the plan already fixed. Same reason `slot` is not
//                       an EditConstraint field.
//   avoid-crowds      — no code anywhere acts on it, so accepting it would be
//                       inventing a capability.
const FLAG_COPY: Record<string, string> = {
  'no-boats':      'nothing on the water',
  'mobility':      'easy going',
  'with-baby':     'baby-friendly',
  'intense-hikes': 'no hard hikes',
  'no-car':        'no car needed',
};

const INTEREST_COPY: Partial<Record<MatchTag, string>> = {
  'food-drink':      'food & drink',
  'beach-chill':     'beach & chill',
  'watersports':     'watersports',
  'adventure':       'adventure',
  'nature-hiking':   'nature & hiking',
  'culture-history': 'culture & history',
  'nightlife':       'nightlife',
  'wellness-spa':    'wellness',
};

const REGION_COPY: Record<Region, string> = {
  'palm-beach': 'Palm Beach', 'eagle-beach': 'Eagle Beach', 'noord': 'Noord',
  'oranjestad': 'Oranjestad', 'san-nicolas': 'San Nicolas', 'arikok': 'Arikok',
  'savaneta': 'Savaneta', 'islandwide': 'anywhere on the island',
};

/**
 * Plain-language description of what a constraint DOES — rendered as the swap
 * caption. Built from the constraint, never from the model's prose, so the
 * traveller reads what the code actually applied rather than what a sentence
 * was understood to mean.
 */
export function describeConstraint(c: EditConstraint): string[] {
  const out: string[] = [];
  // Every branch is gated on copy we own. The constraint arrives over the wire,
  // and while the edge function validates it against the schema, this is the
  // last point before it reaches a traveller's screen — so an unrecognised
  // value renders nothing rather than itself. That keeps the closed-vocabulary
  // promise true end-to-end instead of true-by-server-cooperation.
  if (typeof c.maxPriceUsd === 'number' && c.maxPriceUsd > 0) out.push(`under $${c.maxPriceUsd}`);
  else if (c.cheaper) out.push('cheaper');
  if (c.differentKind) out.push('something different');
  if (c.differentRegion) out.push('somewhere else');
  if (c.region && REGION_COPY[c.region]) out.push(`near ${REGION_COPY[c.region]}`);
  if (c.adventure === 'lower') out.push('more relaxed');
  else if (c.adventure === 'higher') out.push('more of a thrill');
  for (const t of c.interests ?? []) { const copy = INTEREST_COPY[t]; if (copy) out.push(copy); }
  for (const f of c.flags ?? []) { const copy = FLAG_COPY[f]; if (copy) out.push(copy); }
  return out;
}
