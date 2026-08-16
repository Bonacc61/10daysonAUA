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
import { fitItem, budgetCap, activityKind, adventureCapForFlags, isEveningItem, isWaterBased, isCrowdPleaser, isAutoFillExcluded, isKidsOriented, isCouplesOriented, isFullDayProduct, titleTimeOfDay, isNaturalPool, offroadAdrenalineBonus, contentCreatorBonus, itemSlotOkForFill, itemAdventure } from './itemFit';
import { primarySection } from './exploreItems';
import { answersToTags } from './answerTags';
import { effectiveFlags } from './notesFlags';
import { LUNCHSPOTS, isLunchspot } from './lunchspots';
import { coordForEntry, type Coord } from './coords';
import { pinFor } from './itemCoords';
import { pickEnRouteStop, foodPlaceKey, distanceKm } from './enRoute';
import { budgetTag, adventureBandTag } from './classify';
import { resolveStaples } from './staples';
import { isBalancedTraveller, resolveBalancedTemplate, pickAlternative, type Alternative } from './balancedTemplate';

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

// What `durationMinutes` returns for the words "full day" — reused as the floor
// for products that ARE the day whatever duration the feed prints on them.
const FULL_DAY_MIN = 420;

function entryDurationMin(e: CardEntry): number {
  if (e.kind !== 'group') return durationMinutes(e.activity.duration);
  const mins = durationMinutes(e.bestSeller.duration);
  // A day pass reports 6 hrs and leaves 120 minutes of afternoon on paper. In
  // practice the 8h day cap already absorbs most of that, so this changes
  // nothing on today's live catalog — it makes the behaviour a rule rather than
  // an accident, so a short product entering the catalog (there are 30-minute
  // ones) cannot be booked on the back of an island day.
  return isFullDayProduct(e.bestSeller) ? Math.max(mins, FULL_DAY_MIN) : mins;
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
    score += contentCreatorBonus(e.bestSeller, tags);
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

// The shared "route family" of an entry: tours that are the same real-world
// experience and so shouldn't both be recommended, retired trip-wide after one
// placement. Four families today, each defined below where it is matched:
// 'natural-pool', 'offroad', 'kayak' and 'sail'.
// undefined = no family (dedup by cluster/tag only).
// A free, unbookable local beach. These are the only things a traveller
// genuinely returns to — you go back to Eagle Beach on Thursday, you do not do
// the submarine tour twice — so they are the one exception to the trip-wide
// no-repeat rule. Everything else (any Viator product, anything with a price,
// any tour) stays once-only.
// Exported so the balanced template can be tested against the real number
// rather than a copy of it — the template places by construction and never
// passes the ladder below that enforces this, so its guard lives in its own test.
export const REVISITABLE_MIN_DAY_GAP = 2;   // at least one clear day before returning
// A revisitable beach may appear at most this many times in one trip. With 13
// curated beaches, a 14-day plan should be working through them, not looping.
const MAX_REVISITABLE_PLACEMENTS = 2;
function isRevisitableBeach(e: CardEntry): boolean {
  return e.kind === 'activity'
    && e.activity.category === 'Beaches'
    && parseActivityCost(e.activity.cost) === 0;
}

const LOCAL_OFFROAD = /jeep|safari|4x4|4wd|off.?road|utv|atv|natural pool|conchi/i;
// Kayaking is one experience on this island, not a category: every kayak
// product paddles the same sheltered south-coast water — Mangel Halto, Spanish
// Lagoon, Sea Glass Island — so a trip gets one at most, like off-road.
//
// Matched on the TITLE as well as the tag-kind, and both are needed. "Aruba
// Kayak Explorers" also carries a snorkelling tag, which wins in KIND_BY_TAG
// and makes its kind 'snorkel', so a kind-only test misses it; "Sea Glass
// Island Aruba Tour" is tagged as kayaking with no kayak in its name, so a
// title-only test misses that one.
//
// Nothing weaker caught this. The reported pair — "Aruba Glass Bottom Kayak
// Tour" (day 3) and "Kayak Tour at Mangel Halto and Spanish Lagoon" (day 5) —
// sits in different clusters, at tag Jaccard 0.31 against a 0.35 trip-wide
// threshold, and kayak is not one of BOAT_KINDS so the boat day-gap never saw
// it either. Lowering the Jaccard threshold to 0.31 to catch this one pair
// would have thinned every other slot in the plan.
const KAYAK_RE = /\bkayak/i;
// A curated local that is an actual boat trip. Needs a VESSEL word: 'snorkel'
// alone is a shore snorkel, which is not a sail.
const LOCAL_SAIL_RE = /\b(catamaran|sail(?:s|ing)?|cruise)\b/i;
// ...but a cruise PORT is a place, not a boat you board. These titles come from
// the live feed and change without a deploy, and Viator routinely names walking
// tours "…from the Cruise Port" — `oranjestad-walking` is one reface away from
// silently joining the sail family.
const CRUISE_PLACE_RE = /\bcruise (?:port|terminal|pier|dock)\b/i;
// Sailing, catamarans and Jolly Pirates are one experience sold by a dozen
// operators — the same boat, the same coastal run, the same snorkel stops — so
// a trip gets ONE, regardless of length. Snorkel-kind boats are in the same
// family: "Aruba Sail and Snorkel with Turtles" and "Premium Catamaran
// Afternoon Sail" differ only in which tag Viator happened to file first.
//
// Day and evening are ONE family since 2026-08-12 — the same boat on the same
// route, differing only in the light. This used to be split, on the reasoning
// that the plan deliberately carried one of each (the catamaran-sail and
// beach-dinner staples). See routeFamilyOf for what replaced that, and for why
// the beach-dinner staple now leans on shore dinners.
//
// Neither existing net could do this. Measured on the live catalog, the trio
// that shared a 14-day plan — Premium Catamaran Afternoon Sail, Sail and Snorkel
// with Turtles, Morning Champagne and Lobster Sail — scores pairwise tag Jaccard
// of 0.17-0.33 against a 0.35 threshold, and all three sit in DIFFERENT
// embedding clusters. Clustering does group six other sails under 444239P2, and
// championsByExperience already thins those to one; cross-cluster duplicates are
// precisely what an embedding cannot see, so this has to be a family rule.
//
// Curated entries are NO LONGER exempt (2026-08-12). They were, and this comment
// used to say so — which is the misreading that shipped the duplicate: two
// curated slots are boat trips, and on the live catalog they are refaced into
// real Viator products with Book now buttons. They join the family via
// LOCAL_SAIL_RE in routeFamilyOf's non-group branch. The exemption still holds
// for `gapFamilyOf`, which is a different rule: a beach snorkel the day after a
// catamaran was explicitly called fine.
//
// Note the kind test below covers Viator products only — a Viator shore-snorkel
// ("Small Group Snorkeling at Mangel Halto", "Private Turtle Snorkel Tour") has
// kind 'snorkel' and IS in the family, so it competes with the catamaran for
// the trip's one slot. 36 live items land in this family; a south-coast shore
// snorkel and a west-coast catamaran arguably are not the same outing, which is
// the known rough edge of scoping the family by kind.
const SAIL_KINDS = new Set(['sail', 'snorkel']);

// Anything that takes the traveller into Arikok National Park — the guided
// Natural Pool / Conchi runs, the park hike, the jeep safaris. Title-matched
// because that is the only signal shared by all of them: the 21 live Natural
// Pool products classify three different ways, and the curated locals
// ('arikok-hiking', 'natural-pool-jeep') are activities, not Viator items.
const ARIKOK_RE = /\barikok\b|\bnatural pool\b|\bconchi\b/i;
function isArikok(e: CardEntry): boolean {
  const title = e.kind === 'group' ? e.bestSeller.title : e.activity.title;
  if (ARIKOK_RE.test(title)) return true;
  return e.kind === 'activity' && ARIKOK_RE.test(e.activity.location ?? '');
}

// How many real activities a day may carry, excluding food. Two outings is a
// full day on an island this size, and a plan that leaves room is worth more
// than one that fills every slot: the traveller still has favourites to drop in
// and a day of their own to shape. Meals do not count — a lunch stop or a
// dinner is the "on the side" card, and there is at most one of those per day.
const MAX_ACTIVITIES_PER_DAY = 2;
// ...and a hard ceiling on CARDS, so the free-beach exemption below cannot
// stack back up into the crowded day this exists to prevent.
//
// The meal counts (2026-08-12). It used to be exempt, on the reasoning that a
// lunch stop is "on the side" — which let a day show two outings, a free beach
// AND a lunch. Four cards, measured at 20 of 300 days on the live catalog and
// 29 of 180 on the stub, always the same shape: an outing, the en-route lunch
// stop, a free beach and a sunset.
//
// The exemption was not arbitrary and its cost is now paid back: it existed
// because a 3-card south-coast day could not pick up its food stop, and
// Zeerover and O'Neil's are close to the only decent options down there. Those
// days now lose their third card instead of gaining a fourth.
const MAX_CARDS_PER_DAY = 3;
// A food card: the curated restaurants ('Dinner at Gasparito', 'Zeerovers Fish
// Fry') and every lunchspot, all of which carry category 'Food'. A Viator
// dinner cruise or sunset sail is deliberately NOT a meal — it is an outing you
// booked, so it counts as one of the two.
// A day pass IS the day — you ferry to an island and it is gone. The engine
// already inflates one to FULL_DAY_MIN so it crowds out the rest of the
// DAYTIME budget, but the evening is a separate EVENING_CAP_MIN bucket that
// never consults dayMin, so nothing stopped an evening card joining it.
// Reported from production 2026-08-12; measured at 6 of 6 day-pass days on the
// live catalog before the fix.
function isFullDayEntry(e: CardEntry): boolean {
  return e.kind === 'group' && isFullDayProduct(e.bestSeller);
}

function isMealEntry(e: CardEntry): boolean {
  return e.kind === 'activity' && e.activity.category === 'Food';
}

// How many PAID outings a day may carry — the traveller's "one Viator activity
// a day", asked for on 2026-08-15. Strictly tighter than MAX_ACTIVITIES_PER_DAY,
// which still governs everything else: a day may still read "jeep safari + a
// free beach + a sunset", because only the first of those costs money.
// Exported so `tools/plan-diff.ts` asserts the rule against the SAME number the
// engine decides with. That file has been burned three times by mirroring a
// rule and watching the copy go stale.
export const MAX_PAID_OUTINGS_PER_DAY = 1;

// A card that spends the day's one paid slot: it costs money, and is not a
// restaurant. Exported for its own unit tests and for `tools/plan-diff.ts`,
// which imports it alongside `isBoatOuting` and `isSailOuting` rather than
// keeping a copy that can drift.
//
// The test is PRICE, not the affiliate link, and that was a deliberate call.
// "Has a Book now button" (`viator_item_url` && paid) is what the card renders
// (ItineraryCard.tsx:47-49) and on the live catalog it agrees with price on all
// 328 Viator products — measured, zero divergence. The two differ on exactly
// three curated locals, which the owner ruled IN: the $11 Arikok gate, the $99
// Flamingo day pass and the $120 kitesurfing lesson are strenuous 2.5-3h
// outings whoever takes the payment, so a day should carry one of them and
// nothing else.
//
// Price also happens to be the only testable half. Every ViatorItem fixture in
// the suite — and all 20 items in the offline stub — carries
// `viator_item_url: ''`, so a link-based rule would be inert under `npm test`
// and every test written for it would pass against a rule that never fired.
//
// Both call sites guard the CANDIDATE only after their own meal and free-beach
// early-returns, so the meal exemption here
// is load-bearing on the COUNTING side alone — `today.filter(isPaidOuting)`,
// where a $35-60 Gasparito dinner already sitting on the day would otherwise
// spend its outing slot. Instrumented 2026-08-15: no live ordering reaches that
// today, which is why it is asserted on the predicate directly rather than
// through a generated plan. It is one staple-ordering change away from mattering.
//
// There is NO beach clause, and that is deliberate rather than an omission. An
// `isRevisitableBeach` test here would be strictly dead: it requires cost 0, and
// the price test below already rejects anything free. Every curated beach is
// free today (13 of 13 — the "Free + $16 gear" ones parse to 0), and no Viator
// product carries the `beaches` section at all (0 of 328, measured), so "beaches
// don't count" holds by construction. The one case that would separate them is a
// PAID beach, which does not exist in either catalog; if one is ever added it
// counts as the day's outing, and that is the line to revisit.
export function isPaidOuting(e: CardEntry): boolean {
  if (isMealEntry(e)) return false;
  return e.kind === 'group'
    ? e.bestSeller.price_usd > 0
    : parseActivityCost(e.activity.cost) > 0;
}
// Same trap the kayak family hit: `activityKind` falls back to the Explore
// section when the feed gives an item no defining tag, so a dozen real snorkel
// sails land in the generic 'sec:cruises-water' bucket — including the
// 527-review "Antilla Shipwreck and Catalina Bay Snorkel Sail". A splurge plan
// was carrying a catamaran sail plus two of these. Applied ONLY to that generic
// bucket, so a dive, jet ski, parasail or kayak keeps its own kind and its own
// rules; on the live catalog it pulls in 12 boat trips and leaves the dives,
// submarines, seabobs and bus tours where they were.
const DAY_SAIL_TITLE_RE = /\b(catamaran|snorkel(?:ing)?|sail(?:s|ing)?)\b/i;
// The same net plus the two words an evening boat uses when it does not call
// itself a sail. Applied only to evening items, and only after SAIL_KINDS has
// had its turn, so it never widens the daytime rule.
const EVENING_SAIL_TITLE_RE = /\b(catamaran|snorkel(?:ing)?|sail(?:s|ing)?|cruise|yacht)\b/i;
// The sail test, extracted so `tools/plan-diff.ts` can assert the trip-wide rule
// against the SAME predicate the engine decides with rather than a hand-copied
// mirror. That file's header records what mirroring costs: a previous copy used
// isWaterBased for the boat cap and reported violations that were not
// violations. Callers must still apply the natural-pool, full-day and kayak
// checks first — see routeFamilyOf, which is the only ordering that matters.
export function isSailOuting(item: ViatorItem): boolean {
  const kind = activityKind(item);
  if (SAIL_KINDS.has(kind)) return true;
  if (isEveningItem(item) && EVENING_SAIL_TITLE_RE.test(item.title)) return true;
  return kind === 'sec:cruises-water' && DAY_SAIL_TITLE_RE.test(item.title);
}
// Exported since 2026-08-12 because the rule has to hold on BOTH sides of the
// generator. `generatePlan` retires a family after one placement, but every path
// that edits a plan afterwards — swap, add-from-shortlist, drag between days —
// runs in the UI and had no way to ask this question. Measured: the engine
// produced two Viator sails in 0 of 1,728 plans and the card renderer in 0 of
// 1,728, yet travellers saw two, because "Swap this" could return a sail from a
// different GROUP and the swap pool excludes by group id. The family spans
// groups on purpose — that is the bug it was written for.
export function routeFamilyOf(e: CardEntry): string | undefined {
  const title = e.kind === 'group' ? e.bestSeller.title : e.activity.title;
  // Conchi gets its OWN family, retired after one visit however it is reached.
  // The generic off-road family only catches items whose tags classify them as
  // off-road, and on the live catalog the 21 Natural Pool products split three
  // ways — 17 off-road, 3 hike, 1 cruise — so a Natural Pool hike and a Natural
  // Pool jeep safari were free to appear in the same trip. It is one place.
  if (isNaturalPool({ title })) return 'natural-pool';
  if (e.kind === 'group') {
    const kind = activityKind(e.bestSeller);
    // An island day pass is a destination, not a boat trip, even though Viator
    // files it under snorkelling (De Palm carries tag 11912 among 19 others, so
    // activityKind calls it 'snorkel'). Without this it joins the sail
    // family and the catamaran staple retires it from every trip — including
    // the family trips it is meant for. Checked FIRST so the claim holds
    // whatever else the title says: a "Kayak Day Pass" is still a destination.
    if (isFullDayProduct(e.bestSeller)) return undefined;
    if (kind === 'kayak' || KAYAK_RE.test(title)) return 'kayak';
    // ONE sail per trip, daytime or evening. These used to be two families —
    // 'day-sail' and 'evening-cruise' — on the reasoning that a sunset dinner
    // cruise is a different kind of evening from a daytime snorkel sail, and
    // that the two were the curated staple pairing. They are not: every
    // operator on the island runs the same north-west route (Malmok, Boca
    // Catalina, the Antilla wreck), so the second outing sells the traveller
    // the same water at a different hour. Measured before the merge: 6 of 30
    // live plans carried a daytime catamaran AND a sunset cruise.
    //
    // The evening arm tests the TITLE, not isWaterBased. isWaterBased is the
    // seasick filter and is deliberately over-broad — WATER_KINDS covers
    // dive/jetski/sup/parasail/surf, and a title net adds "submarine" and
    // "ferry" on top. That breadth is correct for "never show this to someone
    // who gets seasick" and wrong for "which outings are the same route": it
    // swept in "Night Shore Diving Mangel Halto", a beach entry on the opposite
    // coast, and since the catamaran claims the family first, the dive was the
    // one deleted from every plan.
    //
    // Measured over the 30 evening water-based products in the live catalog:
    // 22 are kind sail/snorkel, 3 are kayaks (already returned above), and of
    // the remaining 5 the title net keeps the four real boats — including
    // "Luxury Four-Course Caribbean Dinner Cruise", filed under
    // tours-sightseeing with no sailing tag — and drops only the shore dive.
    // Hence 'cruise|yacht' on top of the daytime pattern: a dinner cruise
    // rarely says catamaran or sail.
    //
    // Falls THROUGH for an evening item that is not a boat rather than
    // returning: an evening off-road product ("Sunset Island Tour in Aruba on
    // Electric Scooter", 48 reviews — above the champion floor) has to reach
    // the offroad check below, or this silently weakens one-off-road-per-trip.
    if (isSailOuting(e.bestSeller)) return isEveningItem(e.bestSeller) ? 'evening-cruise' : 'day-sail';
    return kind === 'offroad' ? 'offroad' : undefined;
  }
  if (LOCAL_OFFROAD.test(title)) return 'offroad';
  if (KAYAK_RE.test(title)) return 'kayak';
  // Curated LOCALS can be sails too, and until 2026-08-12 they claimed nothing —
  // so the one-sail rule quietly meant "one VIATOR sail". Two of the curated
  // locals are boat trips: 'boca-catalina-snorkel' ("Catamaran Sail & Snorkel at
  // Boca Catalina") and 'antilla-wreck-dive' ("Antilla Shipwreck Snorkel
  // Cruise"). The first is also the catamaran-sail staple's own localIds
  // fallback, so the staple could place a local catamaran that retired nothing
  // and let a Viator sunset sail follow it. Reproduced in a browser on the stub
  // catalog: three sails in one plan.
  //
  // Title-based, and it has to be: a local carries no Viator kind, and
  // `loadCatalog` REFACES these to live product titles, so the id is not a
  // reliable key either. Requires a vessel word — the shore snorkels
  // ("Malmok Beach Snorkel", "Boca Catalina Shore Snorkel") share the snorkel
  // tag but are a walk into the sea, and must stay outside the family. Checked
  // against all 26 locals in both the live and stub catalogs: exactly the two
  // boat trips match, before and after refacing.
  if (CRUISE_PLACE_RE.test(title)) return undefined;
  if (!LOCAL_SAIL_RE.test(title)) return undefined;
  return isEveningItem({ title } as ViatorItem) ? 'evening-cruise' : 'day-sail';
}

// Boat outings, treated as ONE family for the minimum-gap rule below. Two
// catamaran trips read as different `activityKind`s — the reported pair was
// 'sail' and 'snorkel' — so a kind-level rule could never have separated them.
const BOAT_KINDS = new Set(['sail', 'snorkel', 'dive']);
// ...and the generic bucket, which needs positive evidence before it counts.
//
// `activityKind` returns two different sorts of answer in one string: a real
// activity kind when the item's Viator tags name one, or `sec:<browse section>`
// when they do not. 144 of 328 live items get the fallback. Treating
// 'sec:cruises-water' as a boat kind therefore swept in whatever Viator's
// section tree happened to file under water — and it files a lot: tag 20255
// maps to `cruises-water`, 73 live items carry it, and `primarySection` breaks
// ties by tab order, where water sorts first. That is how "Best of Aruba by
// Bus" (642 reviews), "Full-Day Aruba History and Must-See Landmarks Tour"
// (1591) and "Horseback Ride Tour to Natural Pool" (1252) all became boats,
// each one blocking a sail from its day and pushing the next sail two days out.
//
// Checked against all 32 items in the live bucket: this keeps the 28 real boat
// outings — including the ones the tags miss entirely, like "Aruba Seabob
// Scooter Reef Tour" and "Aruba PADI Scuba Diving Program" — and drops exactly
// the four that are not boats (the three above plus "Kids Parasailing
// Experience", which is 1 review and is towed behind a boat, so it is the one
// judgement call here rather than an obvious exclusion).
//
// Every alternative names a VESSEL or a thing you do off one. Deliberately no
// place names: "reef" and "shipwreck" both split the bucket 28/4 identically
// and were dropped for that reason — a dive SITE is the kind of word that
// starts matching beach walks as the catalog churns.
//
// This is a stopgap for a catalog problem. The real fix is for enrichment to
// give these items a true kind, but its vocabulary is derived from KIND_BY_TAG
// and so covers only physical activity kinds — there is no kind for a bus tour
// or a sightseeing tour, and no `enriched_kind` will ever arrive for them.
const BOAT_TITLE_RE = /\b(boat|catamaran|sail(?:s|ing)?|cruise|cruising|yacht|charter|snorkel(?:ing)?|dive|diving|seabob|fishing|submarine)\b/i;
export function isBoatOuting(item: ViatorItem): boolean {
  const kind = activityKind(item);
  if (BOAT_KINDS.has(kind)) return true;
  return kind === 'sec:cruises-water' && BOAT_TITLE_RE.test(item.title);
}
// Whole days that must sit between two outings of the same family. 2 means
// "at least one clear day in between": a sail on day 3 puts the next at day 5.
const FAMILY_MIN_DAY_GAP = 2;
// Same-day cap family. Unlike gapFamilyOf this DOES include evening boats: two
// sails in one day is excessive however different they are, so a daytime
// catamaran and an evening dinner cruise cannot share a day either. Similarity
// is irrelevant here — it is a count, not a comparison.
function dayCapFamilyOf(e: CardEntry): string | undefined {
  if (e.kind !== 'group') return undefined;
  return isBoatOuting(e.bestSeller) ? 'boat' : undefined;
}

function gapFamilyOf(e: CardEntry): string | undefined {
  // Local shore picks are deliberately excluded — a beach snorkel the day after
  // a catamaran was explicitly called fine. This is about repeat BOAT trips.
  if (e.kind !== 'group') return undefined;
  // Evening boat trips are excluded. This used to be justified by the daytime
  // sail and the sunset cruise being a deliberate pairing; that premise was
  // retracted on 2026-08-12. The exclusion stands anyway, and is now mostly
  // moot: an evening SAIL is retired trip-wide by the 'sail' route family long
  // before a day-gap rule could see it, so what this still exempts is the
  // evening water outing that is not a sail — a night shore dive. Which is
  // correct: the gap rule is about repeat BOAT trips, and that is not one.
  if (isEveningItem(e.bestSeller)) return undefined;
  return isBoatOuting(e.bestSeller) ? 'boat' : undefined;
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
    if (!itemSlotOkForFill(item, slot)) continue;
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
    const fam = tripRouteFamily(e, ctx.nDays);
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

  // Caps and their precedence live in FLAG_ADVENTURE_CAP (itemFit.ts) so this
  // pass and constrainByEdit — the swap path — cannot drift apart.
  const adventureCap = adventureCapForFlags(flags);
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
export function getPinSlotPrefs(
  entry: CardEntry,
  opts: { strictTimeOfDay?: boolean } = {},
): { preferred: Slot[]; fallback: Slot[] } {
  // Arikok's gates shut at 16:00, so Conchi is a morning even when the traveller
  // pinned it themselves. A pin overrides our TASTE, not the opening hours — an
  // afternoon departure physically cannot get in and back out.
  const title = entry.kind === 'group' ? entry.bestSeller.title : entry.activity.title;
  if (isNaturalPool({ title })) return { preferred: ['morning'], fallback: [] };
  if (entry.kind === 'group') {
    if (isEveningItem(entry.bestSeller)) {
      return { preferred: ['evening'], fallback: ['morning', 'afternoon'] };
    }
    // A product that names its own time of day gets that slot. Staples and
    // splurges are placed through here without ever consulting itemSlotOk,
    // which is how the "Jolly Pirate Afternoon Sail" and the "Premium Catamaran
    // Afternoon Sail" were landing as morning cards — the card contradicted the
    // product name printed on it.
    //
    // For a PIN the other daytime slot stays as a fallback, never empty.
    // `findPinSlot` only consults it once the stated slot has failed on every
    // day of the trip, so the title still wins in every ordinary case — but an
    // explicit shortlist choice can never silently vanish. It could: on a 2-day
    // trip both afternoons are held open for arrival/departure, so an
    // "Afternoon" pin had nowhere to go and was dropped with no card and no
    // badge. Same for a "Morning" pin under the no-early-mornings flag.
    //
    // `strictTimeOfDay` is for the auto-placed paths, which have alternatives a
    // pin does not: the premium pass simply moves to its next-best candidate.
    // Better a different splurge than a card that says Afternoon Sail sitting in
    // the morning — that contradiction is what this whole rule exists to stop.
    const tod = titleTimeOfDay(entry.bestSeller);
    if (tod) return { preferred: [tod], fallback: opts.strictTimeOfDay ? [] : ['morning', 'afternoon'] };
    return { preferred: ['morning', 'afternoon'], fallback: [] };
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
  //
  // Kids-oriented products (water-park day passes, kids' parasails) are dropped
  // on the same pass, for anyone who did not tell us they have children with
  // them. Q2 group type is the only signal we have for this — and note it is
  // the FIRST thing in the plan that group type actually affects: MatchTags
  // like 'couple' and 'family-young-kids' never appear in classifyTags output,
  // so fitItem's interest loop can never match one against a live Viator item.
  //
  // The Q8 `influencer` flag lifts the photo/video half of the retail/service
  // rule for this trip only — see isAutoFillExcluded. It runs here, BEFORE
  // championsByExperience, which is the point: on the live catalog eight
  // photoshoots share one experience cluster, so the flag buys one champion out
  // of that cluster rather than eight near-identical listings. The 25-review
  // floor below still applies to them, and deliberately — the same cluster holds
  // 0-review, 0-rating listings that nobody should be handed unasked.
  const withChildren = tags.has('family-young-kids') || tags.has('family-teens');
  const influencer = tags.has('influencer');
  // Group-fit exclusions, both the same shape: a product whose title names its
  // audience is not handed to a traveller who is not that audience. Auto-fill
  // only — it stays in Explore and a pinned one still lands.
  //
  // `couple` covers the honeymoon pill too (answerTags maps it), so a couple who
  // ticked honeymoon keeps exactly the products the flag is for.
  const asCouple = tags.has('couple');
  const autoFillOk = (i: ViatorItem) =>
    !isAutoFillExcluded(i, influencer) && (withChildren || !isKidsOriented(i))
    && (asCouple || !isCouplesOriented(i));
  const eligible = filteredCatalog.items.filter(autoFillOk);
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
    { const rf = tripRouteFamily(resolved, nDays); if (rf) ctx.usedRouteFamilies.add(rf); }
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
  // GATE STILL IN PLACE, deliberately. The yield curve below is built and
  // measured but NOT enabled: removing this gate makes the template the baseline
  // for everyone, and measurement showed that costs the Regenerate button —
  // reseed overlap goes to 100%%, 1 distinct plan in 5. See the log entry.
  // Flipping this to `{` is the whole switch, once the density is chosen.
  if (isBalancedTraveller(tags)) {
    // The template may claim the arrival/departure afternoon that slotAvail keeps
    // open. That rule exists to keep those days light — and the template's answer
    // there is a free beach, which is exactly that. A curated choice outranks a
    // heuristic about pacing. Everything else slotAvail enforces still applies.
    const templateAvail = (day: number, slot: Slot): boolean => {
      if (slot === 'morning' && flags.has('no-early-mornings')) return false;
      return !pinClaimed.get(day)?.has(slot);
    };
    // A day the pin pre-pass gave a full-day product is spoken for ENTIRELY —
    // the pass is the day. `fitsDayShape` states this rule for the premium and
    // staple passes, but it is declared below and the template runs before it,
    // so it has to be restated here rather than reused.
    //
    // It cannot live inside templateAvail either: that answers "is this SLOT
    // free", and the whole point is that the rest of the DAY is not. A pinned
    // pass takes day 1 morning, templateAvail says day 1 afternoon is free, and
    // eagle-beach lands beside it — measured at 64 of 100 runs.
    //
    // Only this direction is needed here. NOTE this stopped being true of the
    // template in general on 2026-08-12: a `kids` alternative can put De Palm
    // Island (a full-day GROUP card) into a template slot. That case is covered
    // elsewhere — `fitsDayShape` and the fill ladder both read `templateSlots`,
    // and a measured day 5 comes back morning-only — but do not read this as
    // "the template is always a local activity", because it is not.
    const pinnedFullDayOn = (day: number): boolean => SECTIONS.some((s) => {
      const p = pinnedSlots.get(day)?.get(s);
      return !!p && isFullDayEntry(p.cardEntry);
    });
    // A full-day morning consumes its afternoon, whether the pass arrived as a
    // pin or as the template's own morning card. The pin case is checked above;
    // this covers the template placing, say, a refaced 7-hour Natural Pool tour
    // and then adding a beach after it.
    const fullDayTemplateMorningOn = (day: number): boolean => {
      const m = templateSlots.get(day)?.get('morning');
      return !!m && entryDurationMin(m.cardEntry) >= FULL_DAY_MIN;
    };
    // Resolve one typed alternative into a placeable card, or undefined to keep
    // the default. Never by name: `activity` on an Alternative is a label for
    // readers, and the lookup goes through an explicit id or an explicit rule.
    const resolveAlternative = (alt: Alternative, fallback: CardEntry): CardEntry | undefined => {
      if (alt.localId) {
        const a = filteredCatalog.activities.find((x) => x.id === alt.localId);
        return a ? { kind: 'activity', activity: a } : undefined;
      }
      if (alt.itemId) {
        const item = filteredCatalog.items.find((x) => x.id === alt.itemId);
        if (!item || fitItem(item, tags).rejected) return undefined;
        const group = filteredCatalog.groups.find((g) => g.id === item.group_id);
        return group ? { kind: 'group', group, bestSeller: item, others: otherItemsInGroup(group.id, item.id, filteredCatalog) } : undefined;
      }
      if (!alt.privateUpgrade) return undefined;
      // The rule: the private/luxury version of whatever the default is. Same
      // route family, so a snorkel-sail slot cannot upgrade into a jeep tour;
      // must clear the champion floor, because the priciest private sails on
      // the live catalog have 4, 0 and 2 reviews; then the dearest that
      // `fitItem` will still accept, which is what makes the traveller's cap
      // decide how far the upgrade goes.
      const want = routeFamilyOf(fallback);
      if (!want) return undefined;
      const best = filteredCatalog.items
        .filter((i) => /private|luxury|yacht|charter/i.test(i.title)
          && (i.review_count ?? 0) >= MIN_CHAMPION_REVIEWS
          && !fitItem(i, tags).rejected
          && routeFamilyOf({ kind: 'group', group: { id: i.group_id } as ViatorGroup, bestSeller: i, others: [] }) === want)
        .sort((a, b) => b.price_usd - a.price_usd)[0];
      if (!best) return undefined;
      const group = filteredCatalog.groups.find((g) => g.id === best.group_id);
      return group ? { kind: 'group', group, bestSeller: best, others: otherItemsInGroup(group.id, best.id, filteredCatalog) } : undefined;
    };

    for (const { day, slot, activity, alternatives } of resolveBalancedTemplate(filteredCatalog, nDays, tags)) {
      if (!templateAvail(day, slot)) continue;
      if (pinnedFullDayOn(day)) continue;
      if (slot !== 'morning' && fullDayTemplateMorningOn(day)) continue;
      // Already the traveller's own pick — placing it again ourselves would put
      // the same card in the plan twice. Same principle as the revisit rule: a
      // pin is one explicit choice, not licence to repeat it.
      if (ctx.pinnedIds.has(activity.id)) continue;
      // The default, then the swap the answers ask for. An alternative that
      // cannot be resolved (missing product, over the traveller's cap, filtered
      // out by a Q8 flag) falls back to the default rather than emptying the
      // slot — a template slot is a promise about the SHAPE of the day.
      const fallback: CardEntry = { kind: 'activity', activity };
      const alt = alternatives ? pickAlternative({ day, slot, id: activity.id, alternatives }, tags) : undefined;
      const entry: CardEntry = (alt && resolveAlternative(alt, fallback)) ?? fallback;
      if (!pinClaimed.has(day)) pinClaimed.set(day, new Set());
      pinClaimed.get(day)!.add(slot);
      // Retired trip-wide up front, exactly as pins and staples are, so normal
      // fill on an EARLIER day cannot place the same card before the loop
      // reaches the template's day. `lastUsedDay` holds the LATEST day a card is
      // used, which is what the revisit gap is measured against.
      ctx.lastUsedDay.set(entryId(entry), day);
      { const rf = tripRouteFamily(entry, nDays); if (rf) ctx.usedRouteFamilies.add(rf); }
      if (!templateSlots.has(day)) templateSlots.set(day, new Map());
      templateSlots.get(day)!.set(slot, {
        cardEntry: entry, slotEntry: { ...toSlotEntry(entry), staple: true },
      });
    }
  }
  // ---------------------------------------------------------------------------

  // Both slot maps are declared ahead of BOTH pre-passes, because the
  // day-shape and Arikok helpers below close over them. Populated by the
  // premium and staple passes respectively, in that order.
  const premiumSlots = new Map<number, Map<Slot, PinPlacement>>();
  const stapleSlots = new Map<number, Map<Slot, PinPlacement>>();

  // Everything already promised to a day by any pre-pass — read by the day-shape
  // and Arikok helpers, and by the passes themselves. Order is pins → premium →
  // staples, so each pass sees every earlier one, and the premium pass's second
  // splurge (a fortnight gets two) sees its first.
  const claimedOn = (day: number): CardEntry[] => SECTIONS
    .map((s) => pinnedSlots.get(day)?.get(s) ?? premiumSlots.get(day)?.get(s)
      ?? templateSlots.get(day)?.get(s) ?? stapleSlots.get(day)?.get(s))
    .filter((p): p is PinPlacement => !!p)
    .map((p) => p.cardEntry);

  const arikokMorningOn = (day: number): boolean => {
    const m = pinnedSlots.get(day)?.get('morning') ?? premiumSlots.get(day)?.get('morning')
      ?? templateSlots.get(day)?.get('morning') ?? stapleSlots.get(day)?.get('morning');
    return m ? isArikok(m.cardEntry) : false;
  };
  const afternoonClaimedOn = (day: number): boolean => !!(pinnedSlots.get(day)?.get('afternoon')
    ?? premiumSlots.get(day)?.get('afternoon') ?? templateSlots.get(day)?.get('afternoon')
    ?? stapleSlots.get(day)?.get('afternoon'));

  // The Arikok afternoon rule, in BOTH directions: nothing else in the
  // afternoon of an Arikok morning, and no Arikok morning on a day whose
  // afternoon is already taken (there is always another day for it).
  const freeArikokAfternoon = (entry: CardEntry, day: number, slot: Slot): boolean => {
    if (slot === 'afternoon') return !arikokMorningOn(day);
    if (slot === 'morning' && isArikok(entry)) return !afternoonClaimedOn(day);
    return true;
  };

  // The day shape, for the pre-passes. They place unconditionally and never
  // reach `withinDayShape`, so without this a staple lands on a day the template
  // has already filled — measured as three outings and no meal on the balanced
  // persona's day 2 (snorkel cruise + Alto Vista + sunset sail).
  const fitsDayShape = (entry: CardEntry, day: number): boolean => {
    const claimed = claimedOn(day);
    // Same rule as the ladder's withinDayShape, repeated for the pre-passes so
    // a staple cannot land beside a pass the pin pre-pass already placed.
    //
    // DEFENSIVE, not load-bearing: nothing passes `opts.pinned` in production
    // (Itinerary.tsx:57-59 — the shortlist was unwired from it on 2026-08-05),
    // so `claimed` is empty here on every live plan and neither line below can
    // fire on live data. The FIRST line is covered as of 2026-08-12 — deleting
    // it fails the balanced-template test, which drives the pin path directly.
    // The second is still uncovered; deleting it leaves the suite green. Keep
    // both — the shortlist is expected to be rewired and this is the rule it
    // needs — but read only the first as verified.
    if (claimed.some(isFullDayEntry)) return false;
    if (isFullDayEntry(entry) && claimed.length > 0) return false;
    // Also unreachable, same as withinDayShape's: every caller ANDs this with
    // `slotAvail(day, slot)`, so at least one of the three slots is free and
    // `claimed.length` is at most 2. Kept as a rail for the day a pre-pass
    // learns to claim two slots at once.
    if (claimed.length >= MAX_CARDS_PER_DAY) return false;
    if (isMealEntry(entry)) return claimed.filter(isMealEntry).length < 1;
    if (isRevisitableBeach(entry)) return true;
    // One paid outing a day. `claimed` reads templateSlots (see claimedOn), so a
    // template booking OCCUPIES the day's slot here and blocks the staple and
    // splurge pre-passes — but is never itself blocked, because the template
    // pre-pass places unconditionally and never reaches this function. That
    // asymmetry is the "template wins" decision, and it needs no special case.
    if (isPaidOuting(entry) && claimed.filter(isPaidOuting).length >= MAX_PAID_OUTINGS_PER_DAY) return false;
    const outings = claimed.filter((e) => !isMealEntry(e) && !isRevisitableBeach(e)).length;
    return outings < MAX_ACTIVITIES_PER_DAY;
  };

  // --- Premium splurge pre-pass ---------------------------------------------
  // A money-no-object traveller on a week-plus trip should get an aspirational
  // premium experience (a private charter) IN ADDITION to the universal crowd-
  // pleasers, not instead of them. Item-level fill alone won't guarantee it: a $65
  // crowd-pleaser often out-scores a $1,450 charter on within-tier popularity, so the
  // cheap pick wins every slot. We place the top premium pick(s) here and badge them.
  // Because dedup is by cluster (not group), the group's crowd-pleaser still lands on
  // another day — a charter and a party cruise are different clusters. Shorter trips
  // skip this (one cruise is plenty); non-splurge budgets never trigger it.
  //
  // Runs BEFORE the staples, which is the whole point for a splurge traveller.
  // With one daytime sail per trip, whichever pass goes first owns that slot —
  // and when someone has put the budget slider on "money no object", the yacht
  // charter is the thing they came for, not the group catamaran. Staples run
  // after and skip any family this pass has taken, so the sail slot is spent
  // once, on the better card. (Ordering the other way round is what made every
  // splurge trip come back with the same fallback island tour.)
  if (tags.has('money-no-object') && nDays >= PREMIUM_MIN_DAYS) {
    const maxPremium = Math.floor(nDays / DAYS_PER_PREMIUM); // 1 for a week, 2 for a fortnight
    // Everything the pin and template pre-passes have already claimed — both
    // register in `lastUsedDay`, and both run before this. Registering our own
    // ids there in turn is what lets the staple pass (below) see these picks;
    // the day loop would be far too late.
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
      // (see above), but must NOT skip the retail/service or kids-product rules
      // — this is an auto-suggestion path like any other. Latent today (no
      // retail or kids product is >= $500) and closed before it isn't.
      if (!autoFillOk(item)) continue;
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
    // NOT truncated to maxPremium here — the loop below counts what it actually
    // places. Slicing first meant a candidate rejected inside the loop (its
    // route family already claimed, no slot free, a duplicate cluster) took the
    // whole splurge with it instead of falling through to the next-best premium
    // experience. On the live catalog that killed the feature outright: there
    // are only 6 Viator groups, so a 7-day trip considered exactly one
    // candidate — the "Luxury Private Yacht Charter", whose sail family the
    // catamaran staple has always already claimed. Splurges went 90/90 trips to
    // 0/90 before this was caught.
    const ranked = [...bestPerGroup.values()]
      .sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : 1));

    let premCursor = nDays > 1 ? 2 : 1; // bias away from the arrival (day 1) chill day
    let premPlaced = 0;
    const usedPremiumClusters = new Set<string>(); // no two identical splurges
    for (const { item, group } of ranked) {
      if (premPlaced >= maxPremium) break;
      const cid = item.experience_cluster_id;
      if (cid && usedPremiumClusters.has(cid)) continue; // same experience as an earlier splurge
      // A splurge is placed unconditionally — it never passes through
      // `similarReason` — so the trip-wide route families have to be honoured
      // here explicitly, or a money-no-object traveller gets two sailing trips.
      // Only pins have run before this pass, so the set is normally empty —
      // this now mostly stops a fortnight's SECOND splurge repeating the
      // first's family.
      const prf = tripRouteFamily({ kind: 'group', group, bestSeller: item, others: [] }, nDays);
      if (prf && ctx.usedRouteFamilies.has(prf)) continue;
      // `others` from the full FILTERED catalog (not the popularity-floored fill
      // pool) so the card's swap alternatives match a pinned card's, and sorted
      // by display_order via the shared helper.
      const others = otherItemsInGroup(group.id, item.id, filteredCatalog);
      const cardEntry: CardEntry = { kind: 'group', group, bestSeller: item, others };
      const { preferred, fallback } = getPinSlotPrefs(cardEntry, { strictTimeOfDay: true });
      const premAvail = (day: number, slot: Slot): boolean =>
        slotAvail(day, slot) && avoidsBoatClash(cardEntry)(day)
        && freeArikokAfternoon(cardEntry, day, slot) && fitsDayShape(cardEntry, day);
      const placement = findPinSlot(preferred, fallback, nDays, premCursor, premAvail);
      if (!placement) continue;
      const { day, slot } = placement;
      if (!pinClaimed.has(day)) pinClaimed.set(day, new Set());
      pinClaimed.get(day)!.add(slot);
      if (cid) usedPremiumClusters.add(cid);
      premPlaced += 1;
      // Claim the family so a second splurge (a fortnight gets two) can't be
      // another boat, and so the staple pass and normal fill both see it.
      if (prf) ctx.usedRouteFamilies.add(prf);
      // Register the id and cluster NOW, not when the day loop reaches this day
      // — the staple pass runs next and reads `lastUsedDay` to know what is
      // already spoken for. Without this the catamaran staple would happily
      // re-place the very yacht this pass just chose.
      ctx.lastUsedDay.set(entryId(cardEntry), day);
      if (cid) ctx.usedClusterIds.add(cid);
      if (dayCapFamilyOf(cardEntry) === 'boat') boatDays.add(day);
      // `splurge: true` (not `pinned`) — auto-suggested aspirational pick, shown
      // with a "Signature splurge" badge rather than the "★ Your pick" pin badge.
      if (!premiumSlots.has(day)) premiumSlots.set(day, new Map());
      premiumSlots.get(day)!.set(slot, { cardEntry, slotEntry: { ...toSlotEntry(cardEntry), splurge: true } });
      premCursor = (day % nDays) + 1;
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
  // Runs AFTER pins (an explicit shortlist choice outranks a default) and AFTER
  // the premium splurge, which is deliberate: for a money-no-object traveller
  // the yacht charter is the trip's one sail, so the catamaran staple stands
  // down rather than making it two sailing days. A staple whose route family the
  // splurge has taken is skipped below.
  //
  // Placement uses the premium branch in the day loop, NOT the pin branch:
  // a staple must not retire its whole group. On live Viator data 64% of the
  // catalog is filed under `sailing-cruises` (their group ids are unreliable —
  // UTV tours land there too), so retiring it after placing the sail would
  // starve every remaining slot in the trip.
  let stapleCursor = 1;
  // Own PRNG stream (seed + 2) rather than ctx.rand, so varying the staples
  // doesn't shift the draw sequence normal fill sees.
  const stapleRand = rng(seed + 2);
  // Whatever the pin and premium pre-passes already claimed is off-limits to the
  // staples — lastUsedDay is the authoritative record, and both register there.
  const takenByPins = new Set(ctx.lastUsedDay.keys());
  for (const { entry: firstChoice, alternatives, preferred, fallback, free } of
       resolveStaples(filteredCatalog, tags, nDays, stapleRand, takenByPins)) {
    // Try the chosen product, then the runners-up from the same pool. A staple
    // whose product cannot be placed must NOT take its whole category with it:
    // a product that names its own time of day ("Premium Catamaran MORNING
    // Sail") has no valid day at all for a traveller who ticked "no early
    // mornings", and the trip was losing its only boat trip rather than falling
    // through to the afternoon sailing. Measured before this loop existed: the
    // family persona had a daytime sail in 1 of 6 seeds on a 4-day trip, against
    // 6 of 6 before any of these rules.
    let entry: CardEntry | null = null;
    let placement: { day: number; slot: Slot } | null = null;
    for (const candidate of [firstChoice, ...alternatives]) {
      // A staple never gets a route family the splurge has already taken. For a
      // money-no-object traveller the yacht charter IS the trip's sail, so the
      // catamaran staple stands down rather than making it two sailing days.
      // `continue`, not `break`. This used to break out entirely, on the
      // reasoning that a claimed family meant the whole category was spoken
      // for. That stopped being true when the daytime and evening sail families
      // merged (2026-08-12): `catamaran-sail` claims 'sail' one spec before
      // `beach-dinner`, whose matcher admits both sunset dinner CRUISES (family
      // 'sail') and land-side shore dinners (no family). Breaking discarded the
      // shore dinner along with the cruise, and beach-dinner has no `localIds`
      // fallback, so the staple silently stopped existing. Skipping the
      // individual candidate still lets the staple stand down when every
      // candidate is in a claimed family — `entry` simply stays null.
      const rf = tripRouteFamily(candidate, nDays);
      if (rf && ctx.usedRouteFamilies.has(rf)) continue;
      // Paid staples skip the arrival day — day 1 is the free/chill settle-in
      // day normal fill also honours (see `freeOnly` below).
      const avail = (day: number, slot: Slot): boolean =>
        slotAvail(day, slot) && (free || nDays === 1 || day !== 1)
        && avoidsBoatClash(candidate)(day) && freeArikokAfternoon(candidate, day, slot)
        && fitsDayShape(candidate, day);
      // A staple spec names broad slots ('morning' or 'afternoon' for the
      // catamaran), but the PRODUCT filling it may name its own time of day.
      // Honour the product — the "Premium Catamaran Afternoon Sail" was landing
      // as a morning card, contradicting the title printed on it. There is
      // deliberately no fallback into the slot the title denies; that is what
      // the candidate loop is for.
      const tod = candidate.kind === 'group' ? titleTimeOfDay(candidate.bestSeller) : undefined;
      const slots = tod && preferred.includes(tod) ? [tod] : preferred;
      const found = findPinSlot(slots, fallback, nDays, stapleCursor, avail);
      if (found) { entry = candidate; placement = found; break; }
    }
    if (!entry || !placement) continue;

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
    { const rf = tripRouteFamily(entry, nDays); if (rf) ctx.usedRouteFamilies.add(rf); }
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
      // An Arikok day is a whole undertaking: you drive across the island, the
      // park road is rough, and you come back tired. The afternoon stays free
      // whatever the product's stated duration claims — the 8h "Island Jeep
      // Safari" already blocked it by overrun, but the 4h Natural Pool tours
      // did not, and those were producing the four-card days. The en-route food
      // post-pass still runs (you drive past Zeerover on the way home), and the
      // evening is untouched.
      if (slot === 'morning' && isArikok(pick)) blocked.add('afternoon');
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

    // Activities this day has already promised to slots the ladder hasn't
    // reached yet — a pin, a staple, a splurge. They are placed unconditionally
    // when their slot comes round, so unless the ladder counts them UP FRONT it
    // spends the day's two activities on the morning and afternoon and the
    // evening dinner-cruise staple lands as a third. Counting them here is what
    // makes a staple day read as "one outing plus the sunset cruise".
    const reservedAhead = (from: Slot): CardEntry[] =>
      SECTIONS.slice(SECTIONS.indexOf(from))
        .map((s) => pinnedSlots.get(d)?.get(s) ?? premiumSlots.get(d)?.get(s)
          ?? templateSlots.get(d)?.get(s) ?? stapleSlots.get(d)?.get(s))
        .filter((p): p is PinPlacement => !!p)
        .map((p) => p.cardEntry);

    // The fill ladder for one slot. A closure rather than inline code so the
    // empty-day rescue below can run it a second time — see there for why a
    // day can otherwise come back with nothing at all on it.
    const fillSlot = (slot: Slot): void => {
    // Arrival day (day 1) is a free/chill settle-in day — no paid tours.
    // Single-day trips are exempted (the traveller has no other day).
    const freeOnly = nDays > 1 && d === 1;
    const maxP = freeOnly ? 0 : Math.max(0, budgetLeft);
    // Reject any candidate that would push the day past its 8h activity budget
    // (buffer counted only when something is already booked today).
    // The evening is capped on its own, but the crossover buffer IS charged:
    // getting from an afternoon tour to dinner costs the same hour as any
    // other hop, so after a busy day only a <=3h evening fits.
    // Two activities is a full day. Once the day has them — from the ladder,
    // a staple, a splurge or a pin alike — the only thing that may still be
    // added is food, so an evening dinner still lands on a two-outing day.
    // `reservedAhead(slot)` is what this day has already promised to THIS slot
    // and later ones (a pin, staple or splurge). Counted up front, because
    // those are placed unconditionally when their slot arrives — without it
    // the ladder spends the day's two outings on the morning and afternoon and
    // the evening dinner-cruise staple lands as a third.
    const ahead = reservedAhead(slot);
    const isOuting = (e: CardEntry) => !isMealEntry(e) && !isRevisitableBeach(e);
    const outingsToday = [...picks, ...ahead].filter(isOuting).length;
    const mealsToday = [...picks, ...ahead].filter(isMealEntry).length;
    const cardsToday = picks.length + ahead.length;
    // A free local beach is where to BE, not a thing you booked, and it does
    // not spend the day's outing budget — the traveller's read of "too much in
    // one day" is about tours, not about being told to go to Eagle Beach.
    // Without this exemption a one-day trip came back as two free beach
    // staples and nothing bookable at all, which is the opposite of useful.
    // An Arikok morning clears the afternoon via `commit`, but a pre-placed
    // afternoon card (staple, template, pin) is placed unconditionally and
    // would survive that block. So don't start an Arikok day here at all when
    // the afternoon is already spoken for — there is always another day to
    // put it on, and this way the "free afternoon" promise is not quietly
    // broken by whichever pre-pass got there first.
    const afternoonClaimed = slot === 'morning' && afternoonClaimedOn(d);
    const withinDayShape = (e: CardEntry) => {
      if (afternoonClaimed && isArikok(e)) return false;
      // A day pass owns its day outright, in both directions: nothing joins one,
      // and one never joins a day that already has something. Time accounting
      // cannot express this on its own — the evening budget is separate from
      // dayMin by design, so FULL_DAY_MIN can never reach it.
      const today = [...picks, ...ahead];
      if (today.some(isFullDayEntry)) return false;
      if (isFullDayEntry(e) && today.length > 0) return false;
      // UNREACHABLE, kept as a rail. The ordering matters in principle — below
      // the meal branch a meal returns early and never meets the ceiling — but
      // `cardsToday` is `picks.length + ahead.length` and `fillSlot` only runs
      // on a slot no pre-pass claimed, so `reservedAhead` never counts the
      // current one: the maximum is 2 at every slot (morning 0+2, afternoon
      // 1+1, evening 2+0). Instrumented over 10,080 days: zero hits. The
      // ceiling that actually bites is in the en-route food post-pass, which is
      // the only path that ever wrote a fourth card. Do not read this line as
      // the fix.
      if (cardsToday >= MAX_CARDS_PER_DAY) return false;
      if (isMealEntry(e)) return mealsToday < 1;
      if (isRevisitableBeach(e)) return true;
      // One paid outing a day. `today` is picks + reservedAhead, and both read
      // templateSlots, so whatever the template put on this day already counts
      // against the ladder — which is the whole point: the template's booking
      // wins the slot and the ladder may not add a second.
      if (isPaidOuting(e) && today.filter(isPaidOuting).length >= MAX_PAID_OUTINGS_PER_DAY) return false;
      return outingsToday < MAX_ACTIVITIES_PER_DAY;
    };
    const feasible = (e: CardEntry) => withinDayShape(e) && (slot === 'evening'
      ? (picks.length > 0 ? BUFFER_MIN : 0) + entryDurationMin(e) <= EVENING_CAP_MIN
      : dayMin + (picks.length > 0 ? BUFFER_MIN : 0) + entryDurationMin(e) <= DAY_CAP_MIN);
    // Theme-first: the day's anchor (first placed) slot is biased toward the
    // day theme; later slots fill freely (variety).
    const themeId = picks.length === 0 ? dayTheme?.id : undefined;
    const pick = pickForSlot(ctx, slot, anchor, anchorCoord, maxP, usedKinds, feasible, themeId);
    if (!pick) return;
    budgetLeft -= entryPrice(pick);
    ctx.lastUsedDay.set(entryId(pick), d);
    bumpPlacement(ctx, entryId(pick));
    { const et = entryTags(pick); if (et.length) ctx.dayTagSets.push(et); }
    { const gf = gapFamilyOf(pick); if (gf) ctx.lastFamilyDay.set(gf, d); }
    { const df = dayCapFamilyOf(pick); if (df) ctx.dayFamilies.add(df); }
    { const rf = tripRouteFamily(pick, nDays); if (rf) ctx.usedRouteFamilies.add(rf); }
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
    };

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
        { const rf = tripRouteFamily(pick, nDays); if (rf) ctx.usedRouteFamilies.add(rf); }
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
        { const rf = tripRouteFamily(pick, nDays); if (rf) ctx.usedRouteFamilies.add(rf); }
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

      fillSlot(slot);
    }

    // Empty-day rescue. A day is allowed to be thin — that is the whole point of
    // the two-outing shape — but it must never render as three empty drop zones
    // and nothing else. That combination is reachable: on a DEPARTURE day the
    // afternoon is deliberately held open, a `no-early-mornings` traveller has
    // no morning either, and if the evening pool is exhausted the day comes back
    // blank. Measured at 72 of 3,024 days once party buses left the catalog and
    // took the last evening candidates with them.
    //
    // The open afternoon exists for PACING, so it is the right thing to give up
    // here — better a departure-day beach than a page with nothing on it.
    if (picks.length === 0 && !blocked.has('afternoon') && !pinClaimed.get(d)?.has('afternoon')) {
      fillSlot('afternoon');
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

    days.forEach((day) => {
      // A day that already carries a roadside stop is done — one meal per day,
      // and this pass is the thing that places them.
      const existingStops = SECTIONS
        .flatMap((s) => day[s])
        .filter((e) => e.kind === 'activity' && isLunchspot(e.id));
      if (existingStops.length > 0) return;

      const coords = SECTIONS
        .flatMap((slot) => day[slot])
        .map(coordForEntry)
        .filter((c): c is Coord => !!c);
      // No-repeat stands: a place is offered once per trip. That caps south-coast
      // coverage at roughly 6 in 10 days, because the coast has essentially two
      // decent stops and a fortnight can hold four south-coast days. Lifting it
      // would mean letting a restaurant repeat — which the trip-wide no-repeat
      // guarantee currently forbids for everything except a free beach.
      const pick = pickEnRouteStop(coords, usedPlaceKeys);
      if (!pick) return;

      // The stop OUTRANKS a restaurant the ladder placed. On a day that drives
      // the south coast, Zeerover and O'Neil's are close to the only decent
      // options and you pass them anyway; the dinner it displaces is in Noord,
      // where the traveller has a plethora of choices and needs no suggestion
      // from us. Before this, the dinner won on nothing but placement order —
      // the evening ladder simply runs before this pass — and the stop was
      // offered on 17 days where 33 qualified.
      //
      // A displaced dinner leaves its slot empty rather than being replaced:
      // the day keeps its two outings and its one meal, and the empty evening
      // is the "Drop an activity here" zone, which is the honest thing to show
      // when our suggestion was the weaker of the two.
      // ONLY a curated restaurant card, never a Viator group card. `entryIsFood`
      // also matches anything filed under 'food-drink-experiences', which on the
      // live feed includes the Caribbean Cooking Class, the distillery tours and
      // a sunset dinner sail — paid, bookable OUTINGS that every other rule in
      // this engine counts as outings (see isMealEntry). Displacing one of those
      // for a $12 roadside lunch deletes an affiliate booking and quietly drops
      // the day's outing count; measured at 21 cooking classes over 1,920 trips
      // before this was narrowed.
      const dinners = SECTIONS.flatMap((s) => day[s].map((e) => ({ s, e })))
        .filter(({ e }) => e.kind === 'activity' && isFoodActivityId(e.id));

      // The stop counts against the day's three cards like anything else since
      // 2026-08-12; it used to be exempt as a meal, and this pass appending
      // unconditionally is where most four-card days came from.
      //
      // Computed BEFORE the removal below, and bailing before it, so a day with
      // no room does not lose its dinner for a stop that then cannot be added.
      const cardsAfterRemoval = SECTIONS.reduce((n, s) => n + day[s].length, 0) - dinners.length;
      if (cardsAfterRemoval >= MAX_CARDS_PER_DAY) return;

      for (const { s, e } of dinners) day[s] = day[s].filter((x) => x !== e);
      usedPlaceKeys.add(pick.placeKey);
      // FIRST in the afternoon, not appended. You eat before you spend the rest
      // of the afternoon somewhere — a card order of "Rodger's Beach, then
      // O'Neil's" reads as a late-afternoon meal at the end of the day, which is
      // not what a lunch stop is. The manual "Suggest lunch spot" button has
      // always inserted at the start (addCard's `atStart`); this pass was the
      // one place that did not, so the same stop appeared in a different
      // position depending on how it got there.
      day.afternoon.unshift({ kind: 'activity', id: pick.id });
    });
  }
  // ---------------------------------------------------------------------------

  return days;
}

// A week is not long enough to sell the same water twice. Beyond it, a daytime
// snorkel sail and an evening dinner-and-live-music sail are a genuinely
// different pair of outings and a fortnight has room for both.
//
// So the sail family is COLLAPSED on short trips and SPLIT on long ones. This
// is the one rule in here that depends on trip length, which is why it lives in
// a wrapper rather than in routeFamilyOf: that function answers "what is this?"
// and must stay pure; this one answers "what counts as a repeat THIS trip?".
export const SECOND_SAIL_MIN_DAYS = 8;

/** The family to retire trip-wide, given how long the trip is. */
export function tripRouteFamily(e: CardEntry, nDays: number): string | undefined {
  const fam = routeFamilyOf(e);
  if (fam !== 'day-sail' && fam !== 'evening-cruise') return fam;
  return nDays >= SECOND_SAIL_MIN_DAYS ? fam : 'sail';
}

// --- Route families, for the plan-editing paths in the UI -------------------
// `generatePlan` enforces one-per-trip while it builds. These two let the same
// rule be applied to a plan that already exists, which is what swap needs.

/**
 * The route families already spoken for by a plan, ignoring one card.
 *
 * `skipUid` is the card being replaced: a swap must not count the sail it is
 * about to remove, or swapping a sail for another sail becomes impossible.
 *
 * A card that fails to resolve contributes nothing — it is indistinguishable
 * here from a card with no family. That is acceptable rather than clever: an
 * unresolvable card does not render either, so it cannot produce a duplicate
 * anyone can see. It must not ABORT the loop, though, or one stale id would
 * unclaim every family after it; hence `continue`, and the test for it.
 *
 * `resolve` takes the whole card, not just its entry, so the caller can resolve
 * SLOT-AWARE. `resolveSlotEntry` re-faces a group entry differently per slot, so
 * resolving without the slot can face a different item than the card displays —
 * making this census disagree with what the traveller sees.
 */
export function claimedRouteFamilies(
  cards: ReadonlyArray<{ uid: string; entry: SlotEntry }>,
  resolve: (c: { uid: string; entry: SlotEntry }) => CardEntry | null,
  nDays: number,
  skipUid?: string,
): Set<string> {
  const out = new Set<string>();
  for (const c of cards) {
    if (c.uid === skipUid) continue;
    const resolved = resolve(c);
    if (!resolved) continue;
    const fam = tripRouteFamily(resolved, nDays);
    if (fam) out.add(fam);
  }
  return out;
}

/** Drop candidates whose route family the trip has already used. */
export function withoutClaimedFamilies(pool: CardEntry[], claimed: Set<string>, nDays: number): CardEntry[] {
  if (claimed.size === 0) return pool;
  return pool.filter((c) => {
    const fam = tripRouteFamily(c, nDays);
    return !fam || !claimed.has(fam);
  });
}
