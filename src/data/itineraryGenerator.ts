// Builds the *initial* itinerary from the questionnaire answers — the piece the
// app was missing (the page used to ship a static 5-day SAMPLE_ITINERARY sliced
// by day count, so answers never tailored it and >5 days was clamped to 5).
//
// Pure + deterministic given a seed, so it's unit-testable and a "regenerate"
// just passes a fresh seed. The caller wraps the returned Day[] with seedPlan()
// to attach per-card uids.
//
// Reuses the already-built+tested matcher (matchPool / blendPools / answersToTags)
// and adds the scoring that actually differentiates picks — needed because every
// local activity currently has matched_by: [] (a wildcard that matches everyone),
// so without scoring a foodie and an adventurer would get the same local picks.

import type { Answers } from '../App';
import type { Catalog } from './activitySource';
import { otherItemsInGroup } from './activitySource';
import type { Activity, Day } from './activities';
import type { CardEntry, MatchTag, Region, Section, Slot, SlotEntry, ViatorItem, ViatorGroup } from '../types';
import { SECTIONS } from './itineraryPlan';
import { matchPool, entryPrice, parseActivityCost } from './matcher';
import { fitItem, budgetCap, activityKind, isEveningItem, isWaterBased, isCrowdPleaser, isAutoFillExcluded, isNaturalPool, offroadAdrenalineBonus, itemSlotOk, itemAdventure } from './itemFit';
import { primarySection } from './exploreItems';
import { answersToTags } from './answerTags';
import { effectiveFlags } from './notesFlags';
import { LUNCHSPOTS } from './lunchspots';
import { coordForEntry, type Coord } from './coords';
import { pinFor } from './itemCoords';
import { pickEnRouteStop, foodPlaceKey, distanceKm } from './enRoute';
import { budgetTag, adventureBandTag } from './classify';
import { resolveStaples } from './staples';
import { isBalancedTraveller, resolveBalancedTemplate } from './balancedTemplate';

export const DAY_COLORS = ['#FF6B47', '#3B82F6', '#22C55E', '#EAB308', '#E63946', '#8B5CF6', '#0EA5E9'];

// Jaccard similarity between two Viator tag-ID arrays. Returns 0 when either
// array is empty (no tags = no signal). Broad parent tags (e.g. "Outdoor
// Activities") appear in many products and contribute proportionally less to
// the score because they also inflate the union; specific leaf tags (e.g.
// "4WD & Jeep Tours") dominate by concentrating the intersection.
function tagJaccard(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  let intersection = 0;
  for (const t of b) if (setA.has(t)) intersection++;
  const union = setA.size + b.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Two Viator items whose tag Jaccard meets this threshold are treated as the
// same real-world experience and not placed in the same plan. 0.35 catches
// e.g. two Natural Pool jeep-safari listings (many shared specific tags) while
// keeping a snorkel cruise (zero jeep tags) eligible on the same trip.
const TAG_SIMILARITY_THRESHOLD = 0.35;

// A SECOND, stricter threshold that applies only WITHIN one day. Two things can
// be different enough to sit on consecutive days and still be too alike to share
// a single day: a shore snorkel at Tres Trapi and a snorkel catamaran are a fine
// Tuesday and Wednesday, but a poor Tuesday. Reported from production, twice.
//
// Trip-wide dedup answers "have I already suggested this experience?"; this
// answers "does this day have a shape?". It is deliberately NOT relaxable —
// unlike the same-day `kindOk` gate, which the fill ladder drops on its second
// pass — because a repeated day is exactly what the report was about.
//
// Swept over 60 trips (4 personas x 7/10/14 days x 5 seeds). Days containing two
// sails / two snorkels:
//
//   no rule   26 / 40      evenings 73.3%   daytime 89.3%
//   0.18       9 / 20      evenings 66.5%   daytime 92.0%
//   0.12      11 / 20      evenings 67.2%   daytime 90.2%
//   0.08       3 /  3      evenings 66.5%   daytime 89.9%
//
// 0.08 is near-free relative to 0.18 — same fill, an order of magnitude fewer
// repeated days. The ~7pp of evening fill this costs overall is the rule working
// as specified: a snorkel sail in the afternoon now blocks a dinner cruise that
// night. Still far above the 45.3% evenings had before any of this work.
const SAME_DAY_SIMILARITY_THRESHOLD = 0.08;

// Viator tag ids for either kind of entry. Local picks carry hand-assigned tags
// (see Activity.tags) so they share one vocabulary with live Viator items —
// without that, no semantic signal could compare a local to a Viator product.
function entryTags(e: CardEntry): number[] {
  return (e.kind === 'group' ? e.bestSeller.tags : e.activity.tags) ?? [];
}

const SLOT_TOD: Record<Slot, Activity['timeOfDay']> = {
  morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening',
};

// interest tag → Explore sections it favours. This is what tailors the
// wildcard-tagged local picks (groups already differentiate via matched_by).
// Same section taxonomy Explore filters on (see exploreItems.ts SECTIONS).
const INTEREST_SECTIONS: Partial<Record<MatchTag, Section[]>> = {
  'beach-chill':     ['beaches'],
  'watersports':     ['cruises-water'],
  'food-drink':      ['food-drink'],
  'nature-hiking':   ['adventures-outdoor', 'tours-sightseeing'],
  'adventure':       ['adventures-outdoor', 'cruises-water', 'tours-sightseeing'],
  'culture-history': ['culture-history', 'tours-sightseeing'],
  'nightlife':       ['food-drink'],
  'wellness-spa':    ['beaches'],
};

// Auto-fill pool: ONE champion per experience cluster, gated on an absolute
// review count. Explore still lists everything, and pins resolve against the
// un-narrowed catalog — an explicit shortlist choice always beats this heuristic.
//
// This replaced a within-budget-tier popularity percentile (MIN_FILL_POPULARITY
// = 0.6). That floor ranked ITEMS and was blind to experience structure, so it
// kept many redundant variants of a popular experience while deleting whole
// experiences whose members were all modestly reviewed: measured on the live
// catalog, it wiped 96 of 161 distinct experiences entirely.
//
// Measured over 45 plans (5 personas x 7/10/14 days x 3 seeds):
//
//   rule                        open   experiences   mean rating   <25 reviews
//   percentile floor 0.6         343            44          4.69     10 of 59
//   champion + 25-review gate    327            57          4.63      8 of 61
//
// A clear win on variety (+13 experiences, -16 open slots) and on thin products
// (10 -> 8), with mean rating slipping 0.06. Both the slip and the 8 remaining
// thin products come from the two deliberate bypasses of this rule: curated
// crowd-pleasers, and the premium splurge pre-pass (which selects from
// filteredCatalog — see the comment there for why a review gate is wrong for
// $500+ products). Gating those too would measure ~324 open / 50 experiences /
// 4.78 mean / 0 thin, at the cost of silently overriding curation and gutting
// the splurge feature.
//
// See docs/matching-engine/development-log.md for the full sweep, including why
// the raw top rating is the wrong champion rule (it admits 44% thinly-reviewed
// products — 5.0-from-2-reviews beats 4.7-from-900).
const MIN_CHAMPION_REVIEWS = 25;
// Shrinkage prior for the champion score: a rating is pulled toward the catalog
// mean until the product has roughly this many reviews to speak for itself.
const CHAMPION_REVIEW_PRIOR = 50;
// Pool narrowing only applies to a catalog big enough to HAVE a long tail. Live
// is ~333 products after transport filtering; the offline stub is 20 hand-curated
// ones and the test fixtures are smaller still — none has a tail to cut, and
// narrowing them just starves the plan.
const MIN_CATALOG_TO_FLOOR = 60;

// Best item per experience cluster, then drop champions too thinly reviewed to
// recommend unasked. Items with no cluster id (embedding provider down) each
// form their own cluster, so this degrades safely to a plain review gate.
// Crowd-pleasers are curated as universally bookable: they win their cluster
// outright and bypass the review gate, so a lightly-reviewed catamaran or
// Natural Pool tour still reaches the plan.
function championsByExperience(items: ViatorItem[]): ViatorItem[] {
  const meanRating = items.reduce((a, i) => a + i.rating, 0) / Math.max(1, items.length);
  const score = (i: ViatorItem): number => {
    const v = i.review_count ?? 0;
    return (v / (v + CHAMPION_REVIEW_PRIOR)) * i.rating
      + (CHAMPION_REVIEW_PRIOR / (v + CHAMPION_REVIEW_PRIOR)) * meanRating;
  };
  const best = new Map<string, ViatorItem>();
  for (const item of items) {
    const key = item.experience_cluster_id ?? item.id;
    const cur = best.get(key);
    if (!cur) { best.set(key, item); continue; }
    const itemCP = isCrowdPleaser(item);
    if (itemCP !== isCrowdPleaser(cur)) {
      if (itemCP) best.set(key, item); // curated pick outranks a scored one
      continue;
    }
    const si = score(item), sc = score(cur);
    // Tiebreak on review count then id, so the pool is stable across catalog
    // orderings (the generator is deterministic given a seed).
    if (si > sc
      || (si === sc && (item.review_count ?? 0) > (cur.review_count ?? 0))
      || (si === sc && (item.review_count ?? 0) === (cur.review_count ?? 0) && item.id < cur.id)) {
      best.set(key, item);
    }
  }
  return [...best.values()].filter(
    (i) => isCrowdPleaser(i) || (i.review_count ?? 0) >= MIN_CHAMPION_REVIEWS,
  );
}

// Premium splurge rule: money-no-object travellers on a trip of at least
// PREMIUM_MIN_DAYS get one aspirational premium pick per DAYS_PER_PREMIUM days
// (a private charter IN ADDITION to the crowd-pleaser cruise). Shorter trips get
// just the one cruise. Both express "a week's worth of trip earns one splurge".
const PREMIUM_MIN_DAYS = 7;
const DAYS_PER_PREMIUM = 7;

// mulberry32 — tiny deterministic PRNG so a seed reproduces a plan exactly.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function entryId(e: CardEntry): string {
  return e.kind === 'activity' ? e.activity.id : e.bestSeller.id;
}
function entryRegion(e: CardEntry): Region | undefined {
  return e.kind === 'group' ? e.group.region : undefined;
}
function entryRating(e: CardEntry): number {
  return e.kind === 'activity' ? e.activity.rating : e.bestSeller.rating;
}
function toSlotEntry(e: CardEntry): SlotEntry {
  return e.kind === 'activity'
    ? { kind: 'activity', id: e.activity.id }
    : { kind: 'group', groupId: e.group.id, bestSellerId: e.bestSeller.id };
}

// ---------- Feasibility (day-scheduling) constraints -------------------------
// A day is a real calendar day, not an unbounded bucket. These bound it so the
// generator can't produce a physically impossible plan (the old loop filled every
// slot independently with no notion of time).
const DAY_CAP_MIN = 480;   // 8h of DAYTIME activity is the most we book in one day
// The evening is capped separately from the day. 4h fits a dinner cruise; with
// the crossover buffer charged, a day that already has picks fits at most 3h.
//
// This DOES make the day longer than the 8h DAY_CAP_MIN alone: 8h of touring
// + 1h to change and travel + a 3h dinner cruise = 12h. Deliberate — that is
// what a real holiday day looks like, 9am to 9pm with dinner at the end. What
// it is not is 12h of TOURING, which is what a single shared cap prevented.
//
// 12h is NOT a hard ceiling, and the gap is not this cap. The en-route food
// post-pass (see the bottom of generatePlan) appends a second afternoon card
// with no feasibility accounting at all, so days of 13-15h exist: measured on
// the live catalog, 52 of 558 days exceed 12h and the worst is 14.6h. That hole
// pre-dates the evening budget — but filling evenings makes it visible, taking
// >12h days from 6 to 52. Tracked in docs/ROADMAP.md.
const EVENING_CAP_MIN = 240;
const BUFFER_MIN  = 60;    // travel/rest gap counted between consecutive activities
// Wall-clock length of each slot. An activity longer than its slot "spreads"
// into the next slot (which is then left free) — see the day loop.
const SLOT_WINDOW_MIN: Record<Slot, number> = { morning: 240, afternoon: 240, evening: 180 };
// What has to be LEFT of the next slot for it to be worth filling. An overrun
// eats into the following window rather than deleting it: a 4.5h afternoon
// leaves 150 of the evening's 180 minutes, which is a dinner. Blocking the whole
// slot for any overrun at all cost real suggestions — 31 of the 80 catalog items
// longer than an afternoon window overrun by an hour or less.
const SLOT_MIN_USEFUL_MIN = 90;

// Parse a human duration string into minutes for the maths above. Ranges
// collapse to their midpoint; "Full day" is treated as 7h; an unparseable value
// falls back to 180 (a middling default, so an unknown never silently defeats
// the cap). Each number is read with its OWN trailing unit, so mixed-unit ranges
// the live feed emits ("45 min–1.5 hrs") parse correctly; a number with no unit
// (the low end of "2–3 hrs", whose unit is dropped) inherits the string's unit.
export function durationMinutes(raw: string | undefined): number {
  if (!raw) return 180;
  const s = raw.toLowerCase();
  if (/full[\s-]?day/.test(s)) return 420;
  // Whole-string default unit for unitless numbers: minutes only if the string
  // mentions "min" and no "hr" (e.g. "30–45 min"); otherwise hours.
  const defaultIsMinutes = /\bmin/.test(s) && !/h(?:ou)?r/.test(s);
  const parts = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|h(?:ou)?rs?)?/g)].map((m) => {
    const n = Number(m[1]);
    const unit = m[2] ?? '';
    const isMinutes = /min/.test(unit) || (!/h/.test(unit) && defaultIsMinutes);
    return isMinutes ? n : n * 60;
  });
  if (parts.length === 0) return 180;
  return Math.round(parts.length >= 2 ? (parts[0] + parts[1]) / 2 : parts[0]);
}

function entryDurationMin(e: CardEntry): number {
  return durationMinutes(e.kind === 'group' ? e.bestSeller.duration : e.activity.duration);
}

// The day's "anchor": its longest activity. The day theme (title) is named after
// it, so the label can never contradict the day's headline experience — the bug
// where a day of history/horseback/stargazing was titled "Sailing & Cruises"
// because a sailing pick merely happened to land in slot 0.
function anchorPick(picks: CardEntry[]): CardEntry | undefined {
  let best: CardEntry | undefined;
  for (const e of picks) if (!best || entryDurationMin(e) > entryDurationMin(best)) best = e;
  return best;
}

// The category/theme name an entry belongs to (Viator group name, or a local
// activity's category). This is what a day title must match.
function entryCategory(e: CardEntry): string {
  return e.kind === 'group' ? e.group.name : e.activity.category;
}

// Ordered theme candidates for the trip: Viator groups whose editorial audience
// (matched_by) overlaps the answers, most-relevant first, then the rest. The day
// loop rotates through these so each day gets a distinct headline theme and biases
// its anchor slot toward it.
function themeGroupsFor(catalog: Catalog, tags: Set<MatchTag>): ViatorGroup[] {
  const overlap = (g: ViatorGroup) => g.matched_by.reduce((n, t) => n + (tags.has(t) ? 1 : 0), 0);
  return [...catalog.groups].sort((a, b) => overlap(b) - overlap(a));
}

// Dev-only invariant guard: the day's anchor (longest activity) must belong to
// the day's theme. Logged loudly so a regression in titling/selection is caught
// in development. No-op in production builds.
function validateDayTheme(day: number, title: string, picks: CardEntry[]): void {
  if (!import.meta.env?.DEV) return;
  const a = anchorPick(picks);
  if (!a || entryCategory(a) === title) return;
  const name = a.kind === 'group' ? a.bestSeller.title : a.activity.title;
  console.warn(
    `[itinerary] Day ${day}: theme "${title}" does not match anchor activity "${name}" (${entryCategory(a)}). ` +
    `The anchor (longest) activity must define the theme.`,
  );
}

function scoreEntry(e: CardEntry, tags: Set<MatchTag>, prefSections: Set<Section>): number {
  if (e.kind === 'group') {
    // Per-item fit of the candidate item (interests + adventure + budget + popularity,
    // from classify.ts) plus the group's editorial signal (group type, lodging, theme),
    // read via the item's group. candidatesFor already dropped over-budget items
    // (fitItem(...).rejected), so this is never an over-budget reject here.
    let score = fitItem(e.bestSeller, tags).score;
    for (const t of e.group.matched_by) if (tags.has(t)) score += 2;
    score += offroadAdrenalineBonus(e.bestSeller, tags);
    return score;
  }
  // Local activity: wildcard matched_by, so the section affinity does the work.
  let score = 0;
  for (const t of e.activity.matched_by) if (tags.has(t)) score += 2;
  if ((e.activity.sections ?? []).some((s) => prefSections.has(s))) score += 3;
  // Intensity affinity, weighted like the interest hit above. Viator items get
  // this via itemTags/fitItem; locals carry the same signal in their curated
  // `adventure` number, but nothing read it during scoring — so the Q5 slider
  // moved only the ~20% of slots Viator fills.
  if (tags.has(adventureBandTag(e.activity.adventure ?? 20))) score += 3;
  const price = entryPrice(e);
  if (tags.has('budget')) score += price === 0 ? 2 : price < 50 ? 1 : price > 100 ? -1 : 0;
  if (tags.has('money-no-object') || tags.has('treat-yourself')) score += price > 100 ? 1 : 0;
  return score;
}

// --- Trace instrumentation (opt-in, off in the app) -------------------------
// The engine discards candidates for five reported reasons and, once a plan is
// returned, every one of those decisions is gone — leaving "why did two jeep
// safaris land on consecutive days?" to be answered by reading the source.
// Passing `onTrace` to generatePlan makes it narrate instead. Nothing is
// computed unless a callback is supplied; the diagnostic runs AFTER the pick is
// made, over the same ctx state, so it reports the real decision rather than a
// re-simulation of it.

export type TraceRejectReason =
  | 'already-placed'      // lastUsedDay — this exact id is elsewhere in the trip
  | 'similar-to-placed'   // notSimilar — route family, boat day-gap, one-boat-
                          // per-day, same-day Jaccard, cluster, trip-wide Jaccard
  | 'day-time-budget'     // would push the day past DAY_CAP_MIN
  | 'same-kind-today'     // variety pass only; relaxed on the second run
  | 'over-budget';        // price > maxPrice for this slot

export type TraceRejection = {
  id: string;
  title: string;
  reason: TraceRejectReason;
  detail?: string;
};

/** Which rung of the fill ladder produced the pick. */
export type TraceTier =
  | 'affordable+on-theme'
  | 'affordable+widened'
  | 'over-budget+on-theme'
  | 'over-budget+widened';

export type TraceEvent =
  | {
      type: 'slot';
      day: number;
      slot: Slot;
      maxPrice: number;
      /** Candidate pool sizes before any dedup/feasibility filtering. */
      matched: number;
      widened: number;
      tier: TraceTier | null;
      /** True when the variety gate (newKind) had to be dropped to fill the slot. */
      relaxedKind: boolean;
      picked: { id: string; title: string; price: number } | null;
      rejections: TraceRejection[];
      /**
       * Candidates that cleared every gate but were out-ranked by the pick. These
       * are NOT rejections — `ranked` put the pick first — so they are counted,
       * not listed. A slot with survivors > 0 and picked === null cannot happen.
       */
      survivors: number;
    }
  | {
      type: 'preplaced';
      day: number;
      slot: Slot;
      source: 'pin' | 'premium' | 'staple';
      id: string;
      title: string;
    }
  | {
      type: 'skipped';
      day: number;
      slot: Slot;
      reason: 'open-afternoon' | 'no-early-mornings' | 'blocked-by-overrun';
    };

/** Event as emitted from pickForSlot, before generatePlan stamps the day. */
type SlotTrace = Omit<Extract<TraceEvent, { type: 'slot' }>, 'day' | 'type'>;

function entryTitle(e: CardEntry): string {
  return e.kind === 'group' ? e.bestSeller.title : e.activity.title;
}
// ---------------------------------------------------------------------------

type Ctx = {
  catalog: Catalog;
  tags: Set<MatchTag>;
  prefSections: Set<Section>;
  rand: () => number;
  lastUsedDay: Map<string, number>;
  // How many times each id has been placed this trip. lastUsedDay answers "when
  // was it last used"; this answers "how often", which is what caps a
  // revisitable beach at MAX_REVISITABLE_PLACEMENTS.
  placements: Map<string, number>;
  // Set only when generatePlan was given an onTrace callback. Undefined in the
  // app, which is what keeps this whole mechanism zero-cost in production.
  trace?: (ev: SlotTrace) => void;
  // groupId → group, built once. Each per-item candidate resolves its group
  // through this (for scoring via group.matched_by and for the stored
  // {groupId, bestSellerId} SlotEntry) without a per-item linear scan. Booking-
  // option variants of one product are now handled by cluster/tag dedup in
  // notSimilar, not by whole-group retirement.
  groupById: Map<string, ViatorGroup>;
  // Last-resort dedup signal: consulted in notSimilar ONLY for an item that has
  // neither a cluster id nor tags (hand-written stub / thin offline catalog, which
  // give item-level dedup nothing to compare). Populated by the pin and normal-fill
  // placements below — NOT by the premium pre-pass, so a splurge and a crowd-pleaser
  // from one group still both land.
  usedGroupIds: Set<string>;
  // Cluster IDs (from embedding-based clustering at ingest) of placed Viator
  // items. When an item is placed its cluster is retired for the rest of the
  // trip, preventing semantically identical listings (e.g. two Natural Pool
  // jeep-safari products from different operators) from both appearing.
  // Falls back to tag Jaccard when cluster IDs are absent.
  usedClusterIds: Set<string>;
  // Tag-ID fingerprints used as fallback when no embedding cluster is available.
  usedTagSets: number[][];
  // Tag-ID fingerprints of everything placed on the CURRENT day, reset by the
  // day loop. Judged against the stricter SAME_DAY_SIMILARITY_THRESHOLD, and
  // populated for local picks as well as Viator items.
  dayTagSets: number[][];
  // Day number currently being filled, and the last day each gap-family was
  // used. Together they enforce FAMILY_MIN_DAY_GAP.
  day: number;
  nDays: number;
  lastFamilyDay: Map<string, number>;
  // Families already placed TODAY (reset per day). Hard cap: one per day.
  dayFamilies: Set<string>;
  // Ids the traveller pinned. A pin is one explicit choice — re-adding it later
  // by ourselves is presumptuous — so pinned beaches are exempt from revisiting.
  pinnedIds: Set<string>;
  // Route families placed this trip. Off-road tours (jeep/UTV/ATV) all run the
  // same Aruba circuit, so once one is placed the whole family is retired for the
  // rest of the trip — regardless of trip length (see routeFamilyOf).
  usedRouteFamilies: Set<string>;
};

// The shared "route family" of an entry: a set of tours that visit the same
// real-world circuit and so shouldn't both be recommended. Currently just Aruba's
// off-road tours (Jeep / UTV / ATV / buggy — all the north-coast + Arikok +
// Natural Pool run). undefined = no family (dedup by cluster/tag only).
// A free, unbookable local beach. These are the only things a traveller
// genuinely returns to — you go back to Eagle Beach on Thursday, you do not do
// the submarine tour twice — so they are the one exception to the trip-wide
// no-repeat rule. Everything else (any Viator product, anything with a price,
// any tour) stays once-only.
const REVISITABLE_MIN_DAY_GAP = 2;   // at least one clear day before returning
// A revisitable beach may appear at most this many times in one trip. With 13
// curated beaches, a 14-day plan should be working through them, not looping.
const MAX_REVISITABLE_PLACEMENTS = 2;
function isRevisitableBeach(e: CardEntry): boolean {
  return e.kind === 'activity'
    && e.activity.category === 'Beaches'
    && parseActivityCost(e.activity.cost) === 0;
}

const LOCAL_OFFROAD = /jeep|safari|4x4|4wd|off.?road|utv|atv|natural pool|conchi/i;
function routeFamilyOf(e: CardEntry): string | undefined {
  const title = e.kind === 'group' ? e.bestSeller.title : e.activity.title;
  // Conchi gets its OWN family, retired after one visit however it is reached.
  // The generic off-road family only catches items whose tags classify them as
  // off-road, and on the live catalog the 21 Natural Pool products split three
  // ways — 17 off-road, 3 hike, 1 cruise — so a Natural Pool hike and a Natural
  // Pool jeep safari were free to appear in the same trip. It is one place.
  if (isNaturalPool({ title })) return 'natural-pool';
  if (e.kind === 'group') return activityKind(e.bestSeller) === 'offroad' ? 'offroad' : undefined;
  return LOCAL_OFFROAD.test(title) ? 'offroad' : undefined;
}

// Boat outings, treated as ONE family for the minimum-gap rule below. Two
// catamaran trips read as different `activityKind`s — the reported pair was
// 'sail' and 'snorkel' — so a kind-level rule could never have separated them.
const BOAT_KINDS = new Set(['sail', 'snorkel', 'dive', 'sec:cruises-water']);
// Whole days that must sit between two outings of the same family. 2 means
// "at least one clear day in between": a sail on day 3 puts the next at day 5.
const FAMILY_MIN_DAY_GAP = 2;
// Same-day cap family. Unlike gapFamilyOf this DOES include evening boats: two
// sails in one day is excessive however different they are, so a daytime
// catamaran and an evening dinner cruise cannot share a day either. Similarity
// is irrelevant here — it is a count, not a comparison.
function dayCapFamilyOf(e: CardEntry): string | undefined {
  if (e.kind !== 'group') return undefined;
  return BOAT_KINDS.has(activityKind(e.bestSeller)) ? 'boat' : undefined;
}

function gapFamilyOf(e: CardEntry): string | undefined {
  // Local shore picks are deliberately excluded — a beach snorkel the day after
  // a catamaran was explicitly called fine. This is about repeat BOAT trips.
  if (e.kind !== 'group') return undefined;
  // Evening boat trips are excluded: a sunset dinner cruise is a different kind
  // of evening from a daytime snorkel sail, and the two are the curated staple
  // pairing. The report was about two DAYTIME catamaran sails.
  if (isEveningItem(e.bestSeller)) return undefined;
  return BOAT_KINDS.has(activityKind(e.bestSeller)) ? 'boat' : undefined;
}

// Candidates for a slot — ONE CardEntry per Viator item (no group face-collapse),
// plus local activities. useTags=null widens which items are eligible (drops the
// group-relevance narrowing), but the slot + budget guards ALWAYS use the real
// answers (ctx.tags): widening relevance must never resurface an item the traveller
// can't afford or that doesn't belong in this slot.
//
// Dedup is NOT done here — pickForSlot's `unused` (lastUsedDay, item-level) and
// `notSimilar` (cluster → tag-Jaccard → route-family) handle it, so the same
// experience never repeats while one group can still fill many days with its
// different items.
function candidatesFor(ctx: Ctx, slot: Slot, useTags: Set<MatchTag> | null): CardEntry[] {
  // Local activities: matched pool via matchPool (tag overlap + time-of-day);
  // widened pool is time-of-day only. (Empty groups arg — items handled below.)
  const npDayOk = (title: string) =>
    !isNaturalPool({ title }) || ctx.nDays <= 2 || (ctx.day !== 1 && ctx.day !== ctx.nDays);
  const activities = (useTags === null
    ? ctx.catalog.activities.filter((a) => a.timeOfDay === SLOT_TOD[slot])
    : matchPool(ctx.catalog.activities, [], useTags, slot).activities)
    // Local picks bypass itemSlotOk entirely (it takes a ViatorItem), so the
    // Conchi day rule has to be applied to them here too — `natural-pool-jeep`
    // is a local, and was landing on arrival and departure days.
    .filter((a) => npDayOk(a.title));

  // One candidate per item. Hard filters (both pools): slot-appropriate + fits the
  // real answers (the hard budget guard). Relevance narrowing (matched pool only)
  // uses the item's GROUP matched_by — the same signal matchPool applied at group
  // level, now per item. Empty matched_by = wildcard (matches everyone), as before.
  const itemEntries: CardEntry[] = [];
  for (const item of ctx.catalog.items) {
    if (!itemSlotOk(item, slot)) continue;
    // Conchi is a full morning that starts with a drive across the island, so it
    // belongs in the middle of a trip rather than on the day you land or the day
    // you fly out. itemSlotOk has already pinned it to a morning.
    if (isNaturalPool(item) && ctx.nDays > 2 && (ctx.day === 1 || ctx.day === ctx.nDays)) continue;
    if (fitItem(item, ctx.tags).rejected) continue;
    const group = ctx.groupById.get(item.group_id);
    if (!group) continue; // data-integrity guard (mirrors blendPools' best-seller guard)
    if (useTags !== null && group.matched_by.length > 0
        && !group.matched_by.some((t) => useTags.has(t))) continue;
    // others:[] — the generator never reads it; display rebuilds it in resolveSlotEntry.
    itemEntries.push({ kind: 'group', group, bestSeller: item, others: [] });
  }

  const activityEntries: CardEntry[] = activities.map((a) => ({ kind: 'activity', activity: a }));
  // Items first (mirrors blendPools' groups-first commercial tie-break on equal fit).
  return [...itemEntries, ...activityEntries];
}

// A coarse "kind" for an entry, used to keep a single day varied (no two near-
// duplicate activities, e.g. an ATV tour and a Jeep safari).
function entryKind(e: CardEntry): string {
  return e.kind === 'group'
    ? activityKind(e.bestSeller)
    : `sec:${primarySection(e.activity.sections ?? [])}`;
}

// Score-rank first; shuffle the top equal-score band (variety on regen); then
// cluster that band by the day's anchor region (soft tiebreak), rating last.
// Width of the "comparably good" band, in score points. Entries within BAND of
// the top score are treated as interchangeable so a reseed (regenerate) can pick
// a different one — variety without a meaningful quality drop. Exact-top-only
// (BAND 0) gives no variety when one item dominates the slot.
const BAND = 1;
// How far a revisit is pushed down the ranking. Must exceed BAND so a beach the
// traveller has already seen can never outrank one they have not — a revisit is
// a last resort for an otherwise-empty slot, not a competitor on merit.
const REVISIT_PENALTY = BAND * 4;

// Coordinate of a candidate: the activity's own point, the shown Viator item's
// point, or the item's group-area fallback. undefined when unmapped.
function entryCoord(e: CardEntry): Coord | undefined {
  return pinFor(e.kind === 'activity' ? e.activity.id : e.bestSeller.id)?.coord;
}

// Day-level geographic clustering. Once a day has an anchor point (its first
// coord-bearing pick — the morning outing, or a pin/premium), later picks are
// penalised by how far they sit from it, so a day stays in one part of the
// island instead of criss-crossing (a north-tip dive + a far-south beach). Soft
// by design: within NEAR_KM there's no penalty (local variety survives), and a
// far pick is only pushed down the ranking — still placed if nothing closer is
// left, rather than leaving a slot empty. Coord-less picks (islandwide cruises
// from the west-coast marina, downtown walks) are neutral.
const NEAR_KM = 6;
const GEO_PENALTY_PER_KM = 0.5;
function geoPenalty(e: CardEntry, anchorCoord: Coord | undefined): number {
  if (!anchorCoord) return 0;
  const c = entryCoord(e);
  if (!c) return 0;
  return Math.max(0, distanceKm(anchorCoord, c) - NEAR_KM) * GEO_PENALTY_PER_KM;
}

// A day's anchor slot nudges toward the day theme. Kept at BAND so an on-theme
// pick and a comparably-scored off-theme pick stay in the same shuffle band —
// coherence without killing regenerate variety.
const THEME_BONUS = BAND;
/** Record that an id has been placed. Paired with every lastUsedDay write. */
function bumpPlacement(ctx: Ctx, id: string): void {
  ctx.placements.set(id, (ctx.placements.get(id) ?? 0) + 1);
}

function ranked(ctx: Ctx, cands: CardEntry[], anchor: Region | undefined, anchorCoord: Coord | undefined, themeGroupId?: string): CardEntry[] {
  const themeBonus = (e: CardEntry) => themeGroupId && e.kind === 'group' && e.group.id === themeGroupId ? THEME_BONUS : 0;
  // A beach already placed this trip ranks below every unvisited candidate.
  // `unused` decides whether a revisit is ALLOWED; this decides whether it is
  // PREFERRED, and it never is while something unseen fits the slot.
  const revisitPenalty = (e: CardEntry) => (ctx.lastUsedDay.has(entryId(e)) ? REVISIT_PENALTY : 0);
  const scored = cands.map((e) => ({
    e, s: scoreEntry(e, ctx.tags, ctx.prefSections) - geoPenalty(e, anchorCoord)
      + themeBonus(e) - revisitPenalty(e),
  }));
  const maxS = scored.reduce((m, x) => Math.max(m, x.s), -Infinity);
  // Shuffle the within-BAND top band (variety on regen), then stably partition
  // by anchor-region so clustering only breaks ties — the shuffle order survives
  // among same-cluster entries. No rating sort inside the band: it would override
  // the shuffle and kill variety; band members are comparably-fit by score.
  const top = shuffle(scored.filter((x) => x.s >= maxS - BAND), ctx.rand);
  top.sort((a, b) => {
    const ar = anchor && entryRegion(a.e) === anchor ? 1 : 0;
    const br = anchor && entryRegion(b.e) === anchor ? 1 : 0;
    return br - ar;
  });
  const rest = scored
    .filter((x) => x.s < maxS - BAND)
    .sort((a, b) => b.s - a.s || entryRating(b.e) - entryRating(a.e));
  return [...top.map((x) => x.e), ...rest.map((x) => x.e)];
}

// `maxPrice` is the remaining trip budget — candidates costing more are skipped
// so the trip's average daily spend stays within the tier cap. `usedKinds` are
// the activity-kinds already placed today; picks that introduce a NEW kind win,
// so a day stays varied (never an ATV tour and a Jeep safari on the same day).
// Free/cheap local picks keep slots filled once the budget tightens.
function pickForSlot(
  ctx: Ctx, slot: Slot, anchor: Region | undefined, anchorCoord: Coord | undefined,
  maxPrice: number, usedKinds: Set<string>,
  // Feasibility gate: rejects a candidate that would overrun the day's time
  // budget (see the day loop). Default true keeps standalone callers unchanged.
  feasible: (e: CardEntry) => boolean = () => true,
  // Theme bias: when set, candidates from this Viator group get a small score
  // boost (used for a day's anchor slot) — a nudge, not a filter, so regenerate
  // variety survives and the slot never blanks for lack of an on-theme option.
  themeGroupId?: string,
): CardEntry | null {
  const affordable = (e: CardEntry) => entryPrice(e) <= maxPrice;
  // `unused` is trip-wide: lastUsedDay holds every id placed on any prior day,
  // so an unused pick has never appeared in the plan. We NEVER return a used id
  // — the same activity showing up twice (and, with the small evening pool,
  // twice in the evening) is exactly the bug this fixes. An exhausted pool
  // leaves the slot open ("Drop an activity here") rather than repeating.
  const unused = (e: CardEntry) => {
    const last = ctx.lastUsedDay.get(entryId(e));
    if (last === undefined) return true;
    // A free local beach may come back after a clear day; nothing else may.
    if (ctx.pinnedIds.has(entryId(e))) return false;   // an explicit choice, placed once
    if (!isRevisitableBeach(e) || ctx.day - last < REVISITABLE_MIN_DAY_GAP) return false;
    // ...and only so many times. Without a cap the gap rule alone let one beach
    // return every other day forever: a 14-day beach-leaning plan came back
    // manchebo x7, eagle x6, and days 9-14 were a literal two-day cycle. The
    // island has 13 curated beaches; a plan that shows four of them is not the
    // beach-heavy ethos, it is the same beach on repeat.
    return (ctx.placements.get(entryId(e)) ?? 0) < MAX_REVISITABLE_PLACEMENTS;
  };
  const newKind = (e: CardEntry) => !usedKinds.has(entryKind(e));
  // Semantic dedup: skip candidates that represent an already-placed experience.
  // Primary signal: embedding-derived cluster ID (set at ingest by viator-cards).
  // Fallback: Viator tag-ID Jaccard (used when no embedding provider was set).
  // Local activities (no Viator tags, no cluster ID) bypass both — they dedupe
  // by item ID via lastUsedDay only.
  // Returns WHY this candidate duplicates something already placed, or null if it
  // doesn't. `notSimilar` below is the boolean the ladder actually uses — the two
  // must never diverge, which is why the reason string is the primary form: the
  // trace and the decision read from the same code.
  const similarReason = (e: CardEntry): string | null => {
    // Route family: one off-road tour per trip (they share the same circuit),
    // applies to Viator groups and local picks alike.
    const fam = routeFamilyOf(e);
    if (fam && ctx.usedRouteFamilies.has(fam)) return `route family "${fam}" already placed this trip`;
    // Hard same-day cap: one boat outing per day, however different they are.
    const dcf = dayCapFamilyOf(e);
    if (dcf && ctx.dayFamilies.has(dcf)) return `already a ${dcf} outing today`;
    // Minimum whole days between two outings of the same family.
    const gf = gapFamilyOf(e);
    if (gf) {
      const last = ctx.lastFamilyDay.get(gf);
      if (last !== undefined && ctx.day - last < FAMILY_MIN_DAY_GAP) {
        return `another ${gf} outing on day ${last}; needs ${FAMILY_MIN_DAY_GAP} days between`;
      }
    }
    // Same-day shape, checked BEFORE the group-only rules so it covers local
    // picks too — the reported case was a local snorkel beach sharing a day with
    // a snorkel catamaran, which no Viator-only signal could ever see.
    const tags = entryTags(e);
    if (tags.length > 0) {
      const clash = ctx.dayTagSets.find((used) => tagJaccard(tags, used) >= SAME_DAY_SIMILARITY_THRESHOLD);
      if (clash) {
        return `too alike for one day — tag Jaccard ${tagJaccard(tags, clash).toFixed(2)} >= ${SAME_DAY_SIMILARITY_THRESHOLD} vs something already on this day`;
      }
    }
    if (e.kind !== 'group') return null;
    // LAYERED, not alternatives. A cluster hit is conclusive; a cluster MISS is
    // not, so we fall through to tag Jaccard rather than returning null.
    //
    // This was briefly changed to make the cluster authoritative either way, on
    // the reasoning that of the 9,674 pairs tag Jaccard blocks, embeddings agree
    // with only 18.2%. That inference was wrong: disagreement says nothing about
    // which signal is correct, and on the pairs that matter the embedding is the
    // one at fault. Different option codes of one base product get different
    // cluster ids — 2455SUB vs 2455SEMI (Atlantis Submarine vs Semi-Submarine),
    // 122173P3 vs 122173P1 (two party-bus pub crawls) — so cluster dedup waves
    // them through. Measured over 54 plans with the cluster treated as
    // authoritative, the submarine pair co-occurred in 9 trips and the party-bus
    // pair in 35; with Jaccard restored as the second net, both go to zero and
    // total fill drops only 1284 -> 1249 slots.
    //
    // Note championsByExperience already allows at most one item per cluster
    // into the fill pool, so usedClusterIds rarely fires there at all — Jaccard
    // is doing nearly all the real work on live data.
    const cid = e.bestSeller.experience_cluster_id;
    if (cid && ctx.usedClusterIds.has(cid)) return `experience cluster "${cid}" already placed`;
    // Second net, for everything the cluster missed — which is most things,
    // since the champion pool has already thinned each cluster to one item.
    if (tags.length === 0) {
      // Neither cluster id nor tags: the Viator group is the only "same
      // experience" signal left (hand-written stub / thin offline catalog).
      // Unreachable on live data — every live item carries both.
      if (cid || !ctx.usedGroupIds.has(e.group.id)) return null;
      return `group "${e.group.id}" already placed (item has neither tags nor a cluster id)`;
    }
    const hit = ctx.usedTagSets.find((used) => tagJaccard(tags, used) >= TAG_SIMILARITY_THRESHOLD);
    return hit
      ? `tag Jaccard ${tagJaccard(tags, hit).toFixed(2)} >= ${TAG_SIMILARITY_THRESHOLD} vs an already-placed item`
      : null;
  };
  const notSimilar = (e: CardEntry): boolean => similarReason(e) === null;

  const matchedAll = ranked(ctx, candidatesFor(ctx, slot, ctx.tags), anchor, anchorCoord, themeGroupId);
  const widenedAll = ranked(ctx, candidatesFor(ctx, slot, null), anchor, anchorCoord, themeGroupId);
  const matched = matchedAll.filter(affordable);
  const widened = widenedAll.filter(affordable);

  // Fill ladder, best → worst, every tier restricted to UNUSED + NOT-SIMILAR +
  // FEASIBLE picks: affordable on-theme → affordable widened → over-budget
  // on-theme → over-budget widened. `kindOk` gates every tier by same-day kind
  // variety. When nothing remains, we return null and the slot stays open.
  const runLadder = (kindOk: (e: CardEntry) => boolean): { pick: CardEntry; tier: TraceTier } | null => {
    const ok = (list: CardEntry[]) => list.filter(kindOk).filter(notSimilar).filter(feasible);
    const t1 = ok(matched).find(unused);
    if (t1) return { pick: t1, tier: 'affordable+on-theme' };
    const t2 = ok(widened).find(unused);
    if (t2) return { pick: t2, tier: 'affordable+widened' };
    // When maxPrice === 0 (arrival-day free-only rule), never fall through to the
    // over-budget tiers — leave the slot open rather than place a paid item.
    if (maxPrice === 0) return null;
    const t3 = ok(matchedAll).find(unused);
    if (t3) return { pick: t3, tier: 'over-budget+on-theme' };
    const t4 = ok(widenedAll).find(unused);
    if (t4) return { pick: t4, tier: 'over-budget+widened' };
    return null;
  };

  const strict = runLadder(newKind);
  const result = strict ?? runLadder(() => true);

  if (ctx.trace) {
    // Runs over the same ctx state the ladder just used, so what it reports is
    // the decision that was actually made. `kindOk` mirrors whichever pass won.
    const kindOk: (e: CardEntry) => boolean = strict ? newKind : () => true;
    const pickedId = result ? entryId(result.pick) : null;
    const seen = new Set<string>();
    const rejections: TraceRejection[] = [];
    let survivors = 0;
    for (const e of [...matchedAll, ...widenedAll]) {
      const id = entryId(e);
      if (seen.has(id)) continue;
      seen.add(id);
      if (id === pickedId) continue;
      const title = entryTitle(e);
      const sim = similarReason(e);
      // Most-decisive-first, which is deliberately NOT the ladder's filter order
      // (the ladder applies kindOk → notSimilar → feasible, then find(unused)).
      // A candidate can fail several gates; it is reported under the first that
      // applies here, because "already placed on day 3" explains more than
      // "same kind today" does.
      if (!unused(e)) {
        rejections.push({ id, title, reason: 'already-placed', detail: `placed on day ${ctx.lastUsedDay.get(id)}` });
      } else if (sim) {
        rejections.push({ id, title, reason: 'similar-to-placed', detail: sim });
      } else if (!feasible(e)) {
        rejections.push({ id, title, reason: 'day-time-budget' });
      } else if (!kindOk(e)) {
        rejections.push({ id, title, reason: 'same-kind-today', detail: `kind "${entryKind(e)}" already placed today` });
      } else if (maxPrice === 0 && !affordable(e)) {
        // Price is only ever DECISIVE on a free-only arrival day. Everywhere else
        // the over-budget tiers still run, so an unaffordable item that got this
        // far was out-ranked, not rejected — it counts as a survivor.
        rejections.push({ id, title, reason: 'over-budget', detail: `$${entryPrice(e)} on a free-only arrival day` });
      } else {
        survivors += 1;
      }
    }
    ctx.trace({
      slot,
      maxPrice,
      matched: matchedAll.length,
      widened: widenedAll.length,
      tier: result?.tier ?? null,
      relaxedKind: strict === null && result !== null,
      picked: result
        ? { id: entryId(result.pick), title: entryTitle(result.pick), price: entryPrice(result.pick) }
        : null,
      rejections,
      survivors,
    });
  }

  return result?.pick ?? null;
}

// FNV-1a hash of the tailoring-relevant answers, so the default seed (and thus
// the default plan) differs between personas while staying stable per persona.
function applyCatalogFlags(catalog: Catalog, flags: Set<string>): Catalog {
  if (flags.size === 0) return catalog;
  let { activities, groups, items } = catalog;

  if (flags.has('no-boats')) {
    // Remove every water/boat experience for a seasick traveller. Two levels:
    //  1. groups explicitly tagged 'watersports' are dropped wholesale;
    //  2. individual water items (cruises-water section or a water tag-kind) are
    //     dropped across ALL groups — this catches sailing-cruises sunset sails
    //     and dinner cruises the group-level filter alone missed, which the
    //     crowd-pleaser boost would otherwise push to the top of the plan.
    activities = activities.filter(a => !(a.sections ?? []).includes('cruises-water'));
    groups = groups.filter(g => !g.matched_by.includes('watersports' as MatchTag));
    items = items.filter(i => !isWaterBased(i));
  }

  if (flags.has('no-car')) {
    activities = activities.filter(a => !a.requires_car);
    // Viator tours include hotel pickup — no group filtering needed.
  }

  // mobility: cap at adventure ~30 (excludes arikok, natural pool, kitesurfing)
  // intense-hikes: cap at adventure ~52 (excludes arikok ~55, natural pool ~70, kitesurfing ~85)
  // with-baby: cap at adventure ~25 (keeps beaches, food, sunsets; drops snorkel, hikes, watersports)
  const adventureCap = flags.has('mobility') ? 30
    : flags.has('intense-hikes') ? 52
    : flags.has('with-baby') ? 25
    : null;
  if (adventureCap !== null) {
    activities = activities.filter(a => (a.adventure ?? 20) <= adventureCap);
    const excludeTags: MatchTag[] = adventureCap <= 30
      ? ['adventure', 'nature-hiking', 'watersports']
      : ['adventure'];
    groups = groups.filter(g => !g.matched_by.some(t => excludeTags.includes(t)));
    // Per-ITEM cap as well as the per-group one above. The group filter alone is
    // not safe on live data: the feed files 68 of Aruba's 85 off-road products
    // under "Sailing & Cruises", whose matched_by is beach-chill/couple/
    // cruise-day — so it survives every exclude list, and a traveller who told
    // us about mobility limits was being handed a 4x4 Natural Pool jeep tour.
    // itemAdventure reads the item's own Viator tags, which the feed gets right.
    items = items.filter(i => itemAdventure(i) <= adventureCap);
  }

  const groupIds = new Set(groups.map(g => g.id));
  items = items.filter(i => groupIds.has(i.group_id));
  return { activities, groups, items };
}

function hashAnswers(a: Answers): number {
  const s = JSON.stringify([
    a.days, a.groupType, a.budget, [...a.interests].sort(), a.adventureLevel, a.lodging,
    [...(a.flags ?? [])].sort(),
    // Include specialNotes so a contraindication note ("seasick" → no-boats) that
    // changes the filtered catalog also changes the seed — keeps the seed a
    // faithful identifier of the plan it produces.
    a.specialNotes ?? '',
  ]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// The day's theme is the category of its ANCHOR (longest) activity — never
// picks[0], which merely reflected fill order and let a stray slot-0 sailing
// pick title a day of history/horseback/stargazing "Sailing & Cruises".
function titleFor(picks: CardEntry[], day: number): string {
  const a = anchorPick(picks);
  return a ? entryCategory(a) : `Day ${day}`;
}

// ---------- Pin-placement helpers (exported for unit tests) ------------------

// Resolve an Explore shortlist id → CardEntry against the filtered catalog.
// id format: 'item:<viatorItemId>' for Viator items, '<activityId>' for local.
// Returns null if the id is stale (product no longer in catalog).
export function resolvePinId(rawId: string, catalog: Catalog): CardEntry | null {
  if (rawId.startsWith('item:')) {
    const itemId = rawId.slice(5);
    const item = catalog.items.find((i) => i.id === itemId);
    if (!item) return null;
    const group = catalog.groups.find((g) => g.id === item.group_id);
    if (!group) return null;
    const others = catalog.items.filter((i) => i.group_id === group.id && i.id !== item.id);
    return { kind: 'group', group, bestSeller: item, others };
  }
  const activity = catalog.activities.find((a) => a.id === rawId);
  if (!activity) return null;
  return { kind: 'activity', activity };
}

// Preferred and fallback slot lists for a resolved pin.
export function getPinSlotPrefs(entry: CardEntry): { preferred: Slot[]; fallback: Slot[] } {
  // Arikok's gates shut at 16:00, so Conchi is a morning even when the traveller
  // pinned it themselves. A pin overrides our TASTE, not the opening hours — an
  // afternoon departure physically cannot get in and back out.
  const title = entry.kind === 'group' ? entry.bestSeller.title : entry.activity.title;
  if (isNaturalPool({ title })) return { preferred: ['morning'], fallback: [] };
  if (entry.kind === 'group') {
    return isEveningItem(entry.bestSeller)
      ? { preferred: ['evening'], fallback: ['morning', 'afternoon'] }
      : { preferred: ['morning', 'afternoon'], fallback: [] };
  }
  const tod = entry.activity.timeOfDay;
  if (tod === 'Morning')   return { preferred: ['morning'],   fallback: [] };
  if (tod === 'Evening')   return { preferred: ['evening'],   fallback: [] };
  return { preferred: ['afternoon'], fallback: [] };
}

// Scan from cursor (1-based, wraps modulo nDays) for the earliest day+slot that
// satisfies the preferred list; if none found, try the fallback list.
export function findPinSlot(
  preferred: Slot[],
  fallback: Slot[],
  nDays: number,
  cursor: number,
  slotAvail: (day: number, slot: Slot) => boolean,
): { day: number; slot: Slot } | null {
  for (const slots of [preferred, fallback]) {
    if (slots.length === 0) continue;
    for (let i = 0; i < nDays; i++) {
      const d = ((cursor - 1 + i) % nDays) + 1;
      for (const slot of slots) {
        if (slotAvail(d, slot)) return { day: d, slot };
      }
    }
  }
  return null;
}

export function generatePlan(
  answers: Answers,
  catalog: Catalog,
  opts: { seed?: number; pinned?: string[]; onTrace?: (ev: TraceEvent) => void } = {},
): Day[] {
  const tags = answersToTags(answers);
  const prefSections = new Set<Section>();
  for (const t of tags) for (const s of INTEREST_SECTIONS[t] ?? []) prefSections.add(s);

  const nDays = Math.max(1, Math.min(answers.days || 1, 14));
  const seed = ((opts.seed ?? 0) ^ hashAnswers(answers)) >>> 0;
  // Ticked Q8 pills UNION free-text contraindications ("seasick" → no-boats).
  const flags = effectiveFlags(answers);
  const filteredCatalog = applyCatalogFlags(catalog, flags);
  // Narrow to one well-reviewed champion per experience — see
  // championsByExperience. We'd rather leave a slot open than suggest a niche
  // product few travellers actually book, but we would also rather show fifty
  // distinct experiences than forty-four with duplicates.
  // Drop retail/service products BEFORE choosing champions, not after: a
  // photoshoot that won its cluster would otherwise take the whole experience
  // out of the pool with it. Applies at every catalog size — this is a quality
  // rule, not a long-tail one.
  const eligible = filteredCatalog.items.filter((i) => !isAutoFillExcluded(i));
  const floorApplies = eligible.length >= MIN_CATALOG_TO_FLOOR;
  const champions = !floorApplies ? eligible : championsByExperience(eligible);
  // Absolute gate, unlike the percentile it replaced, CAN empty the pool — a
  // catalog where nothing clears 25 reviews would otherwise blank every slot.
  // Unreachable on today's live data (81 champions), but the cliff is one line
  // to remove and a blank itinerary is the worst output this app can produce.
  // Falls back to `eligible`, NOT filteredCatalog.items — the retail/service
  // rule is a quality floor that must survive the fallback, or an exhausted
  // pool would quietly start suggesting jewellery showrooms.
  const flooredItems = champions.length > 0 ? champions : eligible;
  // Prefer the bookable Viator experience over a hand-written local pick that
  // duplicates it: if the live catalog actually has a matching guided tour, drop
  // the self-guided local from the auto-fill pool so the slot goes to the
  // bookable one (the local stays in Explore). If no Viator equivalent is present
  // (edge fn down, thin stub), the local remains as the fallback.
  const dupedLocal = (a: Activity): boolean =>
    !!a.viatorDupe && filteredCatalog.items.some((it) => a.viatorDupe!.test(it.title));
  const fillCatalog: Catalog = {
    ...filteredCatalog,
    items: flooredItems,
    // Drop bookable-Viator-duplicated locals, and reserve en-route food twins
    // (e.g. the standalone Zeerover activity) for the route post-pass so they
    // surface on the day you actually drive past them — not scattered onto a
    // random food day on the opposite coast by normal fill.
    activities: filteredCatalog.activities.filter((a) => !dupedLocal(a) && !foodPlaceKey(a.id)),
  };
  const ctx: Ctx = { catalog: fillCatalog, tags, prefSections, rand: rng(seed + 1), lastUsedDay: new Map(), placements: new Map(), groupById: new Map(fillCatalog.groups.map((g) => [g.id, g])), usedGroupIds: new Set(), usedClusterIds: new Set(), usedTagSets: [], dayTagSets: [], day: 0, nDays, lastFamilyDay: new Map(), dayFamilies: new Set(), pinnedIds: new Set(), usedRouteFamilies: new Set() };

  // Trip-wide budget pool: keeps the AVERAGE daily activity spend within the
  // tier cap (budget-conscious ≈ $110/day on average), letting days vary while
  // the trip averages out. Infinity for tiers with no cap (money-no-object).
  const cap = budgetCap(tags);
  let budgetLeft = cap === Infinity ? Infinity : cap * nDays;

  // --- Pin pre-pass: claim slots for shortlisted picks before normal fill. ----
  // Pins are budget-exempt — the user chose these explicitly so they always
  // land regardless of cost. They still debit the budget pool so normal fill
  // respects what a pin consumed.
  const pinClaimed = new Map<number, Set<Slot>>();
  // Days that already hold a boat outing from an earlier pre-pass. The pre-passes
  // place via findPinSlot, which knows nothing about the dedup rules, so without
  // this the catamaran staple and the premium yacht charter both landed on day 2
  // — 19 of 75 trips. Pins are exempt: an explicit shortlist choice always lands.
  const boatDays = new Set<number>();
  const avoidsBoatClash = (entry: CardEntry) => (day: number) =>
    dayCapFamilyOf(entry) !== 'boat' || !boatDays.has(day);
  const openAft = (day: number) => nDays > 1 && (day === 1 || day === nDays);
  const slotAvail = (day: number, slot: Slot): boolean => {
    if (slot === 'morning' && flags.has('no-early-mornings')) return false;
    if (slot === 'afternoon' && openAft(day)) return false;
    return !pinClaimed.get(day)?.has(slot);
  };

  type PinPlacement = { cardEntry: CardEntry; slotEntry: SlotEntry };
  const pinnedSlots = new Map<number, Map<Slot, PinPlacement>>();
  let dayCursor = 1;

  for (const rawId of (opts.pinned ?? [])) {
    const resolved = resolvePinId(rawId, filteredCatalog);
    if (!resolved) continue;

    const { preferred, fallback } = getPinSlotPrefs(resolved);
    const placement = findPinSlot(preferred, fallback, nDays, dayCursor, slotAvail);
    if (!placement) continue;

    const { day, slot } = placement;
    if (!pinClaimed.has(day)) pinClaimed.set(day, new Set());
    pinClaimed.get(day)!.add(slot);

    // Retire the pin trip-wide NOW rather than when the day loop reaches its
    // day. The loop runs day 1 → N, so a pin sitting on day 5 was invisible to
    // `unused`/`notSimilar` while days 1–4 filled — normal fill could place the
    // very same shortlisted item earlier and the card then appeared twice.
    // (`usedGroupIds` stays out of this: the day-loop pin branch adds it when it
    // gets there, and doing it here would retire the group for the whole trip.)
    ctx.pinnedIds.add(entryId(resolved));
    ctx.lastUsedDay.set(entryId(resolved), day);
    bumpPlacement(ctx, entryId(resolved));
    { const rf = routeFamilyOf(resolved); if (rf) ctx.usedRouteFamilies.add(rf); }
    if (resolved.kind === 'group') {
      const cid = resolved.bestSeller.experience_cluster_id;
      if (cid) ctx.usedClusterIds.add(cid);
    }

    if (dayCapFamilyOf(resolved) === 'boat') boatDays.add(day);
    const slotEntry: SlotEntry = { ...toSlotEntry(resolved), pinned: true };
    if (!pinnedSlots.has(day)) pinnedSlots.set(day, new Map());
    pinnedSlots.get(day)!.set(slot, { cardEntry: resolved, slotEntry });

    // Advance cursor so pins spread across the trip.
    dayCursor = (day % nDays) + 1;
  }
  // ---------------------------------------------------------------------------

  // --- Curated "Balanced" template pre-pass ----------------------------------
  // For the middle of both sliders only. A hand-built shape claims its days and
  // slots BEFORE the staples and the fill ladder, so the curated distribution
  // survives; everything the template leaves alone is filled normally, which is
  // what keeps other trip lengths and every other persona unchanged.
  //
  // Placed like a staple rather than a pin: no group is retired, and the badge
  // is the same island-default one, because these are our choices and not the
  // traveller's. Runs AFTER pins so an explicit shortlist choice still wins the
  // slot, and BEFORE staples so it is not crowded out by them.
  const templateSlots = new Map<number, Map<Slot, PinPlacement>>();
  if (isBalancedTraveller(tags)) {
    // The template may claim the arrival/departure afternoon that slotAvail keeps
    // open. That rule exists to keep those days light — and the template's answer
    // there is a free beach, which is exactly that. A curated choice outranks a
    // heuristic about pacing. Everything else slotAvail enforces still applies.
    const templateAvail = (day: number, slot: Slot): boolean => {
      if (slot === 'morning' && flags.has('no-early-mornings')) return false;
      return !pinClaimed.get(day)?.has(slot);
    };
    for (const { day, slot, activity } of resolveBalancedTemplate(filteredCatalog, nDays)) {
      if (!templateAvail(day, slot)) continue;
      // Already the traveller's own pick — placing it again ourselves would put
      // the same card in the plan twice. Same principle as the revisit rule: a
      // pin is one explicit choice, not licence to repeat it.
      if (ctx.pinnedIds.has(activity.id)) continue;
      const entry: CardEntry = { kind: 'activity', activity };
      if (!pinClaimed.has(day)) pinClaimed.set(day, new Set());
      pinClaimed.get(day)!.add(slot);
      // Retired trip-wide up front, exactly as pins and staples are, so normal
      // fill on an EARLIER day cannot place the same card before the loop
      // reaches the template's day. `lastUsedDay` holds the LATEST day a card is
      // used, which is what the revisit gap is measured against.
      ctx.lastUsedDay.set(entryId(entry), day);
      { const rf = routeFamilyOf(entry); if (rf) ctx.usedRouteFamilies.add(rf); }
      if (!templateSlots.has(day)) templateSlots.set(day, new Map());
      templateSlots.get(day)!.set(slot, {
        cardEntry: entry, slotEntry: { ...toSlotEntry(entry), staple: true },
      });
    }
  }
  // ---------------------------------------------------------------------------

  // --- Beach-staple pre-pass -------------------------------------------------
  // Reserve a slot for each of Aruba's four universal experiences (sunrise
  // beach, catamaran sail, beach at sunset, dinner by the water) BEFORE persona fill, so
  // every plan leads with them regardless of the answers. See staples.ts for
  // the curation rules; resolveStaples reads the flag-filtered catalog, so a
  // no-boats traveller finds no sail to place and the staple silently drops.
  //
  // Runs AFTER pins (an explicit shortlist choice outranks a default) and
  // BEFORE the premium pass, so a splurge never squeezes out a staple.
  //
  // Placement uses the premium branch in the day loop, NOT the pin branch:
  // a staple must not retire its whole group. On live Viator data 64% of the
  // catalog is filed under `sailing-cruises` (their group ids are unreliable —
  // UTV tours land there too), so retiring it after placing the sail would
  // starve every remaining slot in the trip.
  const stapleSlots = new Map<number, Map<Slot, PinPlacement>>();
  let stapleCursor = 1;
  // Own PRNG stream (seed + 2) rather than ctx.rand, so varying the staples
  // doesn't shift the draw sequence normal fill sees.
  const stapleRand = rng(seed + 2);
  // Whatever the pin pre-pass already claimed is off-limits to the staples —
  // lastUsedDay is the authoritative record of that (pins register there above).
  const takenByPins = new Set(ctx.lastUsedDay.keys());
  for (const { entry, preferred, fallback, free } of
       resolveStaples(filteredCatalog, tags, nDays, stapleRand, takenByPins)) {
    // Paid staples skip the arrival day — day 1 is the free/chill settle-in day
    // normal fill also honours (see `freeOnly` below).
    const stapleAvail = (day: number, slot: Slot): boolean =>
      slotAvail(day, slot) && (free || nDays === 1 || day !== 1)
      && avoidsBoatClash(entry)(day);
    const placement = findPinSlot(preferred, fallback, nDays, stapleCursor, stapleAvail);
    if (!placement) continue;

    const { day, slot } = placement;
    if (!pinClaimed.has(day)) pinClaimed.set(day, new Set());
    pinClaimed.get(day)!.add(slot);

    // Retire the staple trip-wide NOW, not when the day loop reaches its day.
    // The loop runs day 1 → N, so a staple sitting on day 2 is still invisible
    // to `unused`/`notSimilar` while day 1 fills — which put the sunset beach in
    // day 1's evening AND kept it as day 2's staple. Registering the id, its
    // experience cluster and its route family up front closes that window (and
    // stops a day-1 catamaran preceding the day-2 catamaran staple).
    ctx.lastUsedDay.set(entryId(entry), day);
    bumpPlacement(ctx, entryId(entry));
    { const rf = routeFamilyOf(entry); if (rf) ctx.usedRouteFamilies.add(rf); }
    if (entry.kind === 'group') {
      const cid = entry.bestSeller.experience_cluster_id;
      if (cid) ctx.usedClusterIds.add(cid);
    }

    if (dayCapFamilyOf(entry) === 'boat') boatDays.add(day);
    if (!stapleSlots.has(day)) stapleSlots.set(day, new Map());
    // `staple: true` (not `pinned`) — an island default we chose, so it gets its
    // own badge rather than the "★ Your pick" pin badge. The flag also stops
    // resolveSlotEntry re-facing the card to another item in the group, which
    // on live data could quietly turn the sunset sail into a UTV tour.
    stapleSlots.get(day)!.set(slot, { cardEntry: entry, slotEntry: { ...toSlotEntry(entry), staple: true } });
    // Only PAID staples advance the cursor. The free pair (sunrise beach,
    // sunset) are two halves of one day and should share it — spreading them
    // the way pins spread would push the sunset onto day 2 and leave the
    // arrival evening empty. Paid staples still spread, so the sail and the
    // dinner cruise never stack two long boat trips onto the same day.
    if (!free) stapleCursor = (day % nDays) + 1;
  }
  // ---------------------------------------------------------------------------

  // --- Premium splurge pre-pass ---------------------------------------------
  // A money-no-object traveller on a week-plus trip should get an aspirational
  // premium experience (a private charter) IN ADDITION to the universal crowd-
  // pleasers, not instead of them. Item-level fill alone won't guarantee it: a $65
  // crowd-pleaser often out-scores a $1,450 charter on within-tier popularity, so the
  // cheap pick wins every slot. We place the top premium pick(s) here and badge them.
  // Because dedup is by cluster (not group), the group's crowd-pleaser still lands on
  // another day — a charter and a party cruise are different clusters. Shorter trips
  // skip this (one cruise is plenty); non-splurge budgets never trigger it.
  const premiumSlots = new Map<number, Map<Slot, PinPlacement>>();
  if (tags.has('money-no-object') && nDays >= PREMIUM_MIN_DAYS) {
    const maxPremium = Math.floor(nDays / DAYS_PER_PREMIUM); // 1 for a week, 2 for a fortnight
    // Everything already claimed by the pin OR staple pre-pass. Both register
    // their entry id in lastUsedDay up front (the day loop would be too late —
    // it runs after this), so it is the single authoritative set. Deriving this
    // from pinnedSlots alone missed staples, and a staple that was also the best
    // premium-tier pick for its group got placed twice: once badged "◑ Island
    // classic", once "✨ Signature splurge".
    const claimedItemIds = new Set<string>(ctx.lastUsedDay.keys());

    // Best premium-tier item per group (one splurge per group), highest fit first.
    // Sourced from filteredCatalog, NOT the champion-narrowed fill pool: premium
    // products are structurally thin on reviews (median 8 for items >= $500 on the
    // live catalog, and a $1,450 private charter can never out-review the $65 group
    // cruise it shares a cluster with), so the 25-review gate and the shrunk-rating
    // champion score both select against exactly what this pass exists to surface.
    // It has its own narrowing already: premium tier only, one per group, top N by
    // fit, capped by trip length.
    const bestPerGroup = new Map<string, { item: ViatorItem; group: ViatorGroup; score: number }>();
    for (const item of filteredCatalog.items) {
      // Sourcing from filteredCatalog deliberately skips the champion narrowing
      // (see above), but must NOT skip the retail/service rule — this is an
      // auto-suggestion path like any other. Latent today (no retail product is
      // >= $500) and closed before it isn't.
      if (isAutoFillExcluded(item)) continue;
      if (budgetTag(item.price_usd) !== 'money-no-object') continue; // premium tier only
      if (claimedItemIds.has(item.id)) continue;                     // already pinned or a staple
      // Off-road is a single-per-trip route family, not a "splurge in addition"
      // experience — a money-no-object traveller gets ONE off-road tour (chosen by
      // adrenaline × budget in normal fill), never a premium jeep plus a
      // crowd-pleaser UTV on the same circuit.
      if (activityKind(item) === 'offroad') continue;
      const fit = fitItem(item, tags);
      if (fit.rejected) continue;
      const group = fillCatalog.groups.find((g) => g.id === item.group_id);
      if (!group) continue;
      const cur = bestPerGroup.get(group.id);
      // Tiebreak on id so equal-score picks are stable across catalog orderings.
      if (!cur || fit.score > cur.score || (fit.score === cur.score && item.id < cur.item.id)) {
        bestPerGroup.set(group.id, { item, group, score: fit.score });
      }
    }
    const ranked = [...bestPerGroup.values()]
      .sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : 1))
      .slice(0, maxPremium);

    let premCursor = nDays > 1 ? 2 : 1; // bias away from the arrival (day 1) chill day
    const usedPremiumClusters = new Set<string>(); // no two identical splurges
    for (const { item, group } of ranked) {
      const cid = item.experience_cluster_id;
      if (cid && usedPremiumClusters.has(cid)) continue; // same experience as an earlier splurge
      // `others` from the full FILTERED catalog (not the popularity-floored fill
      // pool) so the card's swap alternatives match a pinned card's, and sorted
      // by display_order via the shared helper.
      const others = otherItemsInGroup(group.id, item.id, filteredCatalog);
      const cardEntry: CardEntry = { kind: 'group', group, bestSeller: item, others };
      const { preferred, fallback } = getPinSlotPrefs(cardEntry);
      const premAvail = (day: number, slot: Slot): boolean =>
        slotAvail(day, slot) && avoidsBoatClash(cardEntry)(day);
      const placement = findPinSlot(preferred, fallback, nDays, premCursor, premAvail);
      if (!placement) continue;
      const { day, slot } = placement;
      if (!pinClaimed.has(day)) pinClaimed.set(day, new Set());
      pinClaimed.get(day)!.add(slot);
      if (cid) usedPremiumClusters.add(cid);
      if (dayCapFamilyOf(cardEntry) === 'boat') boatDays.add(day);
      // `splurge: true` (not `pinned`) — auto-suggested aspirational pick, shown
      // with a "Signature splurge" badge rather than the "★ Your pick" pin badge.
      if (!premiumSlots.has(day)) premiumSlots.set(day, new Map());
      premiumSlots.get(day)!.set(slot, { cardEntry, slotEntry: { ...toSlotEntry(cardEntry), splurge: true } });
      premCursor = (day % nDays) + 1;
    }
  }
  // ---------------------------------------------------------------------------

  // Theme rotation: each day gets a distinct headline theme (most trip-relevant
  // groups first), and its anchor slot is biased toward that theme.
  const themeGroups = themeGroupsFor(fillCatalog, tags);

  // Trace wiring: pickForSlot doesn't know which day it's filling, so the day is
  // stamped on here. Left undefined (and therefore free) when no callback given.
  const emit = opts.onTrace;
  let traceDay = 0;
  if (emit) ctx.trace = (ev) => emit({ type: 'slot', day: traceDay, ...ev });

  const days: Day[] = [];
  for (let d = 1; d <= nDays; d += 1) {
    traceDay = d;
    const slots: Record<Slot, SlotEntry[]> = { morning: [], afternoon: [], evening: [] };
    const picks: CardEntry[] = [];
    const usedKinds = new Set<string>(); // activity-kinds placed today (variety)
    let anchor: Region | undefined;
    let anchorCoord: Coord | undefined; // day's geographic centre (first coord-bearing pick)

    // Feasibility bookkeeping for a real calendar day (issue: 11h days). dayMin
    // accumulates DAYTIME activity time + inter-activity buffers; blocked holds
    // slots a long "spread" activity has swallowed. dayTheme is this day's
    // headline group.
    //
    // The evening keeps its OWN budget. Sharing one 8h pool meant two daytime
    // activities (3-5h each, plus a 60min buffer) exhausted the cap before the
    // evening slot was ever considered, so dinner competed with a jeep safari
    // for the same hours and lost. Measured on the live catalog: the day cap
    // produced 97 evening rejections across a 10-day plan — more than four times
    // every dedup rule combined — and left evenings 46.5% filled against 91.8%
    // for daytime. A day out and a dinner are not the same budget.
    let dayMin = 0;
    // Same-day state is per-day. Pre-placed cards register as the slot loop
    // reaches them, NOT up front. Seeding the day from its pre-placed cards
    // first was tried on review recommendation and measured worse — days with
    // two catamarans went 0 -> 9 over 60 trips, because blocking more candidates
    // pushes fill into the relaxed ladder tiers where the kind-variety gate is
    // dropped altogether. The pre-passes coordinate among themselves via
    // `boatDays` instead, which is what actually took two-boat days to zero.
    ctx.dayTagSets = [];
    ctx.dayFamilies = new Set();
    // ...with ONE exception: a boat already reserved for this day by a pre-pass.
    // dayFamilies is otherwise filled lazily as the slot loop reaches each card,
    // and the evening is last — so a dinner cruise booked for this evening was
    // invisible while the morning filled, and normal fill happily added a
    // catamaran. Measured 30/30 seeds on a boat-heavy catalog before this line.
    //
    // This is deliberately narrower than the seeding described above, which was
    // tried and measured worse: that blocked EVERY family a pre-placed card
    // belonged to, pushing fill into relaxed tiers where the kind gate is
    // dropped. One boat per day is a hard cap, not a variety preference.
    if (boatDays.has(d)) ctx.dayFamilies.add('boat');
    ctx.day = d;
    const blocked = new Set<Slot>();
    const dayTheme = themeGroups.length ? themeGroups[(d - 1) % themeGroups.length] : undefined;
    // Book a pick's time and, if it overruns its slot window, spread it into the
    // next slot (left free). Call BEFORE picks.push so the buffer counts only
    // between consecutive activities (none before the day's first).
    const commit = (pick: CardEntry, slot: Slot) => {
      const dur = entryDurationMin(pick);
      // Only DAYTIME time accrues to dayMin; the evening is capped per-item
      // instead (see `feasible`), because a slot holds exactly one pick and a
      // pre-placed evening skips the ladder entirely — an evening accumulator
      // would never be read.
      if (slot !== 'evening') dayMin += (picks.length > 0 ? BUFFER_MIN : 0) + dur;
      // Spread still applies across the boundary: a 5h afternoon tour really
      // does eat the evening, and that is a physical fact rather than a budget.
      // But it eats it PROPORTIONALLY — block the next slot only when too little
      // of it survives to hold anything. A 6h afternoon leaves 60 minutes and is
      // correctly blocked; a 4.5h afternoon leaves 150 and should still get a
      // dinner.
      if (dur > SLOT_WINDOW_MIN[slot]) {
        const next = SECTIONS[SECTIONS.indexOf(slot) + 1];
        if (next) {
          const remaining = SLOT_WINDOW_MIN[next] - (dur - SLOT_WINDOW_MIN[slot]);
          if (remaining < SLOT_MIN_USEFUL_MIN) blocked.add(next);
        }
      }
    };

    // Arrival (first) and departure (last) days keep an open afternoon — a
    // lighter pace, and it surfaces the "Drop an activity here" zone between the
    // morning and evening cards. Single-day trips stay full (no arrival/departure
    // split). Mirrors the original hand-curated itinerary's pacing.
    const openAfternoon = nDays > 1 && (d === 1 || d === nDays);

    for (const slot of SECTIONS) {
      // Arrival/departure afternoons stay open — UNLESS something deliberate has
      // already claimed the slot. The skip used to run before the pre-placed
      // lookups below, so a template entry on day 1 afternoon was claimed and
      // then silently never placed.
      const claimedHere = pinnedSlots.get(d)?.has(slot) || templateSlots.get(d)?.has(slot);
      if (slot === 'afternoon' && openAfternoon && !claimedHere) {
        emit?.({ type: 'skipped', day: d, slot, reason: 'open-afternoon' });
        continue;
      }
      if (slot === 'morning' && flags.has('no-early-mornings')) {
        emit?.({ type: 'skipped', day: d, slot, reason: 'no-early-mornings' });
        continue;
      }

      const pin = pinnedSlots.get(d)?.get(slot);
      if (pin) {
        const { cardEntry: pick, slotEntry } = pin;
        emit?.({ type: 'preplaced', day: d, slot, source: 'pin', id: entryId(pick), title: entryTitle(pick) });
        budgetLeft -= entryPrice(pick);
        ctx.lastUsedDay.set(entryId(pick), d);
        bumpPlacement(ctx, entryId(pick));
        { const et = entryTags(pick); if (et.length) ctx.dayTagSets.push(et); }
      { const gf = gapFamilyOf(pick); if (gf) ctx.lastFamilyDay.set(gf, d); }
      { const df = dayCapFamilyOf(pick); if (df) ctx.dayFamilies.add(df); }
        { const rf = routeFamilyOf(pick); if (rf) ctx.usedRouteFamilies.add(rf); }
        if (pick.kind === 'group') {
          ctx.usedGroupIds.add(pick.group.id);
          const cid = pick.bestSeller.experience_cluster_id;
          if (cid) ctx.usedClusterIds.add(cid);
          const tags = pick.bestSeller.tags ?? [];
          if (tags.length > 0) ctx.usedTagSets.push(tags);
        }
        usedKinds.add(entryKind(pick));
        if (!anchor) anchor = entryRegion(pick);
        if (!anchorCoord) anchorCoord = entryCoord(pick);
        commit(pick, slot);
        picks.push(pick);
        slots[slot].push(slotEntry);
        continue;
      }

      // Auto-placed picks — a premium splurge (money-no-object, long trip) or a
      // beach staple. Both are placed like a pin but their group is NOT retired:
      // the group's crowd-pleaser should still surface elsewhere, and for a
      // staple, retiring `sailing-cruises` would take most of the live catalog
      // with it.
      //
      // Their TAGS are now recorded too. They used to be deliberately withheld,
      // on the reasoning that cluster id already means "the same experience" and
      // the coarser tag-Jaccard net would wrongly suppress a distinct-but-related
      // crowd-pleaser. In practice that left Jaccard — the net that does nearly
      // all the real work, since championsByExperience already thins each cluster
      // to one item — completely blind to whatever a staple placed. Reported from
      // production: the catamaran staple lands, then normal fill adds a second
      // catamaran the same day. Those two score Jaccard 0.500 against each other,
      // twice the 0.35 threshold; nothing was ever asked to compare them.
      const premium = premiumSlots.get(d)?.get(slot);
      const autoPlaced = premium ?? templateSlots.get(d)?.get(slot) ?? stapleSlots.get(d)?.get(slot);
      if (autoPlaced) {
        const { cardEntry: pick, slotEntry } = autoPlaced;
        emit?.({
          type: 'preplaced', day: d, slot,
          source: premium ? 'premium' : 'staple',
          id: entryId(pick), title: entryTitle(pick),
        });
        budgetLeft -= entryPrice(pick);
        ctx.lastUsedDay.set(entryId(pick), d);
        bumpPlacement(ctx, entryId(pick));
        { const et = entryTags(pick); if (et.length) ctx.dayTagSets.push(et); }
      { const gf = gapFamilyOf(pick); if (gf) ctx.lastFamilyDay.set(gf, d); }
      { const df = dayCapFamilyOf(pick); if (df) ctx.dayFamilies.add(df); }
        { const rf = routeFamilyOf(pick); if (rf) ctx.usedRouteFamilies.add(rf); }
        if (pick.kind === 'group') {
          const cid = pick.bestSeller.experience_cluster_id;
          if (cid) ctx.usedClusterIds.add(cid);
          const ptags = pick.bestSeller.tags ?? [];
          if (ptags.length > 0) ctx.usedTagSets.push(ptags);
        }
        usedKinds.add(entryKind(pick));
        if (!anchor) anchor = entryRegion(pick);
        if (!anchorCoord) anchorCoord = entryCoord(pick);
        commit(pick, slot);
        picks.push(pick);
        slots[slot].push(slotEntry);
        continue;
      }

      // A prior long activity spread into this slot — leave it free (issue:
      // don't overbook). Pins/premium/staples above are explicit and still place.
      if (blocked.has(slot)) {
        emit?.({ type: 'skipped', day: d, slot, reason: 'blocked-by-overrun' });
        continue;
      }

      // Arrival day (day 1) is a free/chill settle-in day — no paid tours.
      // Single-day trips are exempted (the traveller has no other day).
      const freeOnly = nDays > 1 && d === 1;
      const maxP = freeOnly ? 0 : Math.max(0, budgetLeft);
      // Reject any candidate that would push the day past its 8h activity budget
      // (buffer counted only when something is already booked today).
      // The evening is capped on its own, but the crossover buffer IS charged:
      // getting from an afternoon tour to dinner costs the same hour as any
      // other hop, so after a busy day only a <=3h evening fits.
      const feasible = (e: CardEntry) => (slot === 'evening'
        ? (picks.length > 0 ? BUFFER_MIN : 0) + entryDurationMin(e) <= EVENING_CAP_MIN
        : dayMin + (picks.length > 0 ? BUFFER_MIN : 0) + entryDurationMin(e) <= DAY_CAP_MIN);
      // Theme-first: the day's anchor (first placed) slot is biased toward the
      // day theme; later slots fill freely (variety).
      const themeId = picks.length === 0 ? dayTheme?.id : undefined;
      const pick = pickForSlot(ctx, slot, anchor, anchorCoord, maxP, usedKinds, feasible, themeId);
      if (!pick) continue;
      budgetLeft -= entryPrice(pick);
      ctx.lastUsedDay.set(entryId(pick), d);
      bumpPlacement(ctx, entryId(pick));
      { const et = entryTags(pick); if (et.length) ctx.dayTagSets.push(et); }
      { const gf = gapFamilyOf(pick); if (gf) ctx.lastFamilyDay.set(gf, d); }
      { const df = dayCapFamilyOf(pick); if (df) ctx.dayFamilies.add(df); }
      { const rf = routeFamilyOf(pick); if (rf) ctx.usedRouteFamilies.add(rf); }
      if (pick.kind === 'group') {
        ctx.usedGroupIds.add(pick.group.id);
        const cid = pick.bestSeller.experience_cluster_id;
        if (cid) ctx.usedClusterIds.add(cid);
        const tags = pick.bestSeller.tags ?? [];
        if (tags.length > 0) ctx.usedTagSets.push(tags);
      }
      usedKinds.add(entryKind(pick));
      if (!anchor) anchor = entryRegion(pick);
      if (!anchorCoord) anchorCoord = entryCoord(pick);
      commit(pick, slot);
      picks.push(pick);
      slots[slot].push(toSlotEntry(pick));
    }

    const title = titleFor(picks, d);
    validateDayTheme(d, title, picks); // dev-only: warns if the anchor conflicts
    days.push({
      day: d,
      title,
      color: DAY_COLORS[(d - 1) % DAY_COLORS.length],
      morning: slots.morning, afternoon: slots.afternoon, evening: slots.evening,
    });
  }

  // --- En-route food post-pass ------------------------------------------------
  // If a day's plan drives out to a far corner of the island, offer a curated
  // food stop that sits on that drive (e.g. Zeerover on an Arikok/Boca Grandi
  // day — you pass straight through Savaneta). Appended as an ordinary afternoon
  // food card: swappable/removable like the manual "Suggest lunch spot" pick.
  // Skipped for no-car travellers (they aren't driving there) and for days that
  // already include a food card. A place is never offered twice on a trip.
  if (!flags.has('no-car')) {
    const isFoodActivityId = (id: string): boolean =>
      (catalog.activities.find((x) => x.id === id) ?? LUNCHSPOTS.find((x) => x.id === id))?.category === 'Food';
    const entryIsFood = (e: SlotEntry): boolean =>
      e.kind === 'activity' ? isFoodActivityId(e.id) : e.groupId === 'food-drink-experiences';
    const entryFoodKey = (e: SlotEntry): string | undefined =>
      foodPlaceKey(e.kind === 'activity' ? e.id : e.bestSellerId);

    // Seed with food places already in the plan so we never double-book one.
    const usedPlaceKeys = new Set<string>();
    for (const day of days)
      for (const slot of SECTIONS)
        for (const e of day[slot]) { const k = entryFoodKey(e); if (k) usedPlaceKeys.add(k); }

    for (const day of days) {
      // An existing lunch/daytime food card blocks the stop; an evening dinner
      // doesn't — a roadside lunch and a night-out dinner happily coexist.
      if (day.morning.some(entryIsFood) || day.afternoon.some(entryIsFood)) continue;
      const coords = SECTIONS
        .flatMap((slot) => day[slot])
        .map(coordForEntry)
        .filter((c): c is Coord => !!c);
      const pick = pickEnRouteStop(coords, usedPlaceKeys);
      if (!pick) continue;
      usedPlaceKeys.add(pick.placeKey);
      day.afternoon.push({ kind: 'activity', id: pick.id });
    }
  }
  // ---------------------------------------------------------------------------

  return days;
}
