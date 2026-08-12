import type { Activity } from './activities';
import type { Catalog } from './activitySource';
import type { MatchTag, Slot } from '../types';

/* ------------------------------------------------------------------ *
 * The curated "Balanced" template.                                    *
 * ------------------------------------------------------------------ *
 * A hand-built 10-day shape for the middle of both sliders, used as the
 * STARTING POINT for those travellers rather than as the whole plan.
 * The generator places these first, then fills whatever is left with
 * its normal machinery — so trip lengths other than 10 days, the
 * evening slots the template does not address, and every other persona
 * all keep working exactly as before.
 *
 * Why a table of (day, slot, id) rather than pins: a pin lands in the
 * slot its CARD declares (`getPinSlotPrefs` reads `timeOfDay`), and the
 * template deliberately disagrees with several cards — Eagle Beach is a
 * morning card placed here in an afternoon, Palm Beach an afternoon card
 * placed in a morning. The curated distribution is the point, so the
 * template names the slot itself.
 *
 * Repeats are intentional and legal: Eagle Beach on 1/6/9, Palm Beach on
 * 5/10, Mangel Halto on 3/8. Free local beaches may be revisited after a
 * clear day (see REVISITABLE_MIN_DAY_GAP) — you do go back to a beach.
 *
 * Gaps are intentional too. Day 5 afternoon (a sunset sail) and day 8
 * morning are left to the engine: the sail has no curated card, and the
 * template itself marks day 8 morning and day 10 afternoon as free.
 */

// A typed swap for one template slot. The traveller's answers pick which (if
// any) applies; the default stays otherwise.
//
// Resolution is deliberately NOT by name. "Private snorkel sail" is a label, not
// an id, and the live catalog has dozens of loose matches with no field marking
// "this is the private version of that". So an alternative says either exactly
// WHICH product it means, or by what RULE to find one — and `activity` stays as
// the human label so the table reads like the canonical template it came from.
export type AltType = 'highBudget' | 'kids' | 'hike';
/** The engine's slots plus 'lunch', which only the canonical template models. */
export type TemplateSlot = Slot | 'lunch';
export type Alternative = {
  type: AltType;
  /** Human label from the canonical template. Never used for lookup. */
  activity: string;
  /** An exact Viator product. */
  itemId?: string;
  /** An exact curated entry. */
  localId?: string;
  /**
   * Resolve by rule: the private/luxury version of whatever the default is,
   * same route family, DEAREST-first among products that clear the champion
   * floor, capped by what `fitItem` accepts. The floor matters — the priciest private sails on the live catalog
   * have 4, 0 and 2 reviews, so "most expensive" alone picks junk.
   */
  privateUpgrade?: boolean;
  /**
   * Slots this swap consumes (De Palm Island takes the whole day).
   *
   * `TemplateSlot` includes 'lunch', which the ENGINE does not have — it fills
   * morning/afternoon/evening and appends food afterwards. The canonical
   * template models lunch as a first-class slot, so the type keeps it rather
   * than quietly dropping it; nothing reads it yet.
   */
  spansSlots?: TemplateSlot[];
};

export type TemplateEntry = { day: number; slot: Slot; id: string; alternatives?: Alternative[] };

/**
 * Which alternative types this traveller qualifies for, HIGHEST PRECEDENCE
 * FIRST. A family that is also high-budget gets the kids swap: a constraint
 * about who is travelling outranks a preference about spend.
 *
 * highBudget is "more than $200/day on average", which is exactly above the
 * mid-range cap — so `treat-yourself` ($400) and `money-no-object` (uncapped).
 */
export function altTypesFor(tags: Set<MatchTag>): AltType[] {
  const out: AltType[] = [];
  if (tags.has('family-young-kids') || tags.has('family-teens')) out.push('kids');
  if (tags.has('treat-yourself') || tags.has('money-no-object')) out.push('highBudget');
  if (tags.has('nature-hiking')) out.push('hike');
  return out;
}

/** The alternative to apply for these tags, or undefined to keep the default. */
export function pickAlternative(entry: TemplateEntry, tags: Set<MatchTag>): Alternative | undefined {
  if (!entry.alternatives?.length) return undefined;
  for (const type of altTypesFor(tags)) {
    const hit = entry.alternatives.find((a) => a.type === type);
    if (hit) return hit;
  }
  return undefined;
}

export const BALANCED_TEMPLATE: TemplateEntry[] = [
  { day: 1,  slot: 'morning',   id: 'tres-trapi' },
  { day: 1,  slot: 'afternoon', id: 'eagle-beach-morning' },
  { day: 2,  slot: 'morning',   id: 'antilla-wreck-dive',
    alternatives: [{ type: 'highBudget', activity: 'Private snorkel sail', privateUpgrade: true }] },
  { day: 2,  slot: 'afternoon', id: 'alto-vista-chapel',
    alternatives: [{ type: 'kids', activity: 'Half-Day Aruba Animal Sanctuary Guided Tour', itemId: '7389P10' }] },
  { day: 3,  slot: 'morning',   id: 'mangel-halto',
    alternatives: [{ type: 'highBudget', activity: 'Private snorkel sail', privateUpgrade: true }] },
  { day: 3,  slot: 'afternoon', id: 'baby-beach-snorkel' },
  { day: 4,  slot: 'morning',   id: 'natural-pool-jeep',
    alternatives: [{ type: 'highBudget', activity: 'Private hike tour', privateUpgrade: true }] },
  // Day 4 afternoon carries arashi-beach again as of 2026-08-12, reversing the
  // 2026-08-05 decision to empty it. That reasoning — an Arikok day is the whole
  // day, the park road is rough, you come back tired — was overruled in favour
  // of the canonical template, which fills this slot.
  //
  // The exception is DURATION, not geography: the slot is skipped when the day's
  // morning card is a full-day product (see fullDayTemplateMorningOn in the
  // generator). On today's catalog that never fires — natural-pool-jeep is
  // "3-5 hrs" and 0 of the 20 live Natural Pool products are full-day — so it is
  // a guard against a reface rather than a live branch.
  { day: 4,  slot: 'afternoon', id: 'arashi-beach',
    alternatives: [{ type: 'hike', activity: 'Bushiribana Loop from Calbas', localId: 'bushiribana-loop' }] },
  { day: 5,  slot: 'morning',   id: 'palm-beach-strip',
    alternatives: [{ type: 'kids', activity: 'De Palm Island', itemId: '2455P18',
      // Spans the whole day. No special handling needed: it is a full-day
      // product, so the day-pass rule already keeps the rest of the day clear.
      spansSlots: ['morning', 'lunch', 'afternoon'] }] },
  // day 5 afternoon — sunset sail, no curated card; engine fills
  { day: 6,  slot: 'morning',   id: 'eagle-beach-morning' },
  { day: 6,  slot: 'afternoon', id: 'california-dunes-sunset' },
  { day: 7,  slot: 'morning',   id: 'san-nicolas-murals',
    alternatives: [{ type: 'kids', activity: 'Atlantis Submarine', itemId: '2455SUB' }] },
  { day: 7,  slot: 'afternoon', id: 'rodgers-beach' },
  // day 8 morning — free in the template
  { day: 8,  slot: 'afternoon', id: 'mangel-halto' },
  { day: 9,  slot: 'morning',   id: 'boca-catalina-shore' },
  { day: 9,  slot: 'afternoon', id: 'eagle-beach-morning' },
  { day: 10, slot: 'morning',   id: 'palm-beach-strip' },
  // day 10 afternoon — free in the template
];

/**
 * Whether this traveller gets the template: the middle of BOTH sliders.
 * `med-adventure` is adventureLevel 34–66 and `mid-range` is the Mid-range
 * budget answer — the product's own definitions, not a second opinion.
 */
export function isBalancedTraveller(tags: Set<MatchTag>): boolean {
  return tags.has('med-adventure') && tags.has('mid-range');
}

export type ResolvedTemplateEntry = { day: number; slot: Slot; activity: Activity; alternatives?: Alternative[] };

/**
 * Template entries that can actually be placed on this trip: within the trip
 * length, and still present in the (already flag-filtered) catalog — so a
 * `no-car` traveller silently loses the entries that need one rather than
 * having them forced in.
 */
// How many template entries a HIGH-ADVENTURE traveller keeps. The template's own
// centre is around adventure 25 — it is mostly free beaches — so a traveller at
// 90 who receives all 18 entries has almost no room left for what they asked
// for. Measured on the naive "template for everyone" prototype: high-adventure
// outings per plan collapsed from 4.5 to 1.0 and the money-no-object ceiling
// fell from $1,800 to $420.
//
// Low and mid travellers keep everything: they ARE the template's audience.
export const HIGH_ADVENTURE_TEMPLATE_ENTRIES = 10;

/**
 * The template entries this traveller gets, most-suitable first.
 *
 * Everyone gets the curated shape (2026-08-12) — it used to be gated to the
 * middle of both sliders, which reached about 8% of answer combinations and left
 * everyone else on raw fill. Raw fill is where the niche products come from: the
 * ladder widens as it runs out of good matches, so the more slots it has to
 * cover the deeper it digs.
 *
 * A high-adventure traveller keeps a SPINE — the most adventurous entry of each
 * day, so the beach-heavy shape survives — and then the next most adventurous
 * entries up to the cap. The slots that fall away go to normal fill, which for
 * that traveller means adventure content.
 */
export function resolveBalancedTemplate(
  catalog: Catalog, nDays: number, tags?: Set<MatchTag>,
): ResolvedTemplateEntry[] {
  const byId = new Map(catalog.activities.map((a) => [a.id, a]));
  const out: ResolvedTemplateEntry[] = [];
  for (const e of BALANCED_TEMPLATE) {
    if (e.day > nDays) continue;
    const activity = byId.get(e.id);
    if (activity) out.push({ day: e.day, slot: e.slot, activity, alternatives: e.alternatives });
  }
  if (!tags?.has('high-adventure') || out.length <= HIGH_ADVENTURE_TEMPLATE_ENTRIES) return out;

  const adv = (r: ResolvedTemplateEntry) => (r.activity as { adventure?: number }).adventure ?? 0;
  const spine = new Set<ResolvedTemplateEntry>();
  for (const day of new Set(out.map((r) => r.day))) {
    const best = out.filter((r) => r.day === day).sort((a, b) => adv(b) - adv(a))[0];
    if (best) spine.add(best);
  }
  const rest = out.filter((r) => !spine.has(r)).sort((a, b) => adv(b) - adv(a));
  const keep = new Set([...spine, ...rest.slice(0, Math.max(0, HIGH_ADVENTURE_TEMPLATE_ENTRIES - spine.size))]);
  // Preserve template order, not ranking order — the day loop reads it in order.
  return out.filter((r) => keep.has(r));
}
