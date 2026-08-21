import type { Answers } from '../App';
import type { MatchTag } from '../types';
import type { Activity } from './activities';
import { effectiveFlags } from './notesFlags';

const INTEREST_MAP: Record<string, MatchTag> = {
  'Beach & chill':           'beach-chill',
  'Nature & hiking':         'nature-hiking',
  'Watersports':             'watersports',
  'Food & drink':            'food-drink',
  'Adventure & adrenaline':  'adventure',
  'Culture & history':       'culture-history',
  'Nightlife':               'nightlife',
  'Wellness & spa':          'wellness-spa',
};

const GROUP_TYPE_MAP: Record<string, MatchTag> = {
  'Solo':                    'solo',
  'Couple':                  'couple',
  'Friends':                 'friends',
  'Family with young kids':  'family-young-kids',
  'Family with teens':       'family-teens',
  'Multi-gen':               'multi-gen',
};

const BUDGET_MAP: Record<string, MatchTag> = {
  'Budget-conscious':  'budget',
  'Mid-range':         'mid-range',
  'Treat yourself':    'treat-yourself',
  'Money no object':   'money-no-object',
};

const LODGING_MAP: Record<string, MatchTag> = {
  'Palm Beach':       'palm-beach',
  'Eagle Beach':      'eagle-beach',
  'Downtown':         'downtown',
  'Noord (Airbnb)':   'noord',
  'Cruise':           'cruise-day',
  // 'Not booked yet' and 'Other' → no tag
};

// Every local pick ships `matched_by: []`, which the matcher reads as a wildcard
// — deliberately, so a pick is always eligible to fill a slot the Viator catalog
// cannot. That is right for the generator and wrong for a browse surface: it
// made "Personalized for you" hand back all 26 picks to every traveller, whatever
// they answered.
//
// So derive the tags a pick would carry, from the two fields it already has:
// its Explore section and its 0-100 `adventure` score. Nothing is invented and
// `matched_by` is untouched, so the generator's wildcard survives intact.
const SECTION_TAGS: Record<string, MatchTag[]> = {
  'beaches':            ['beach-chill'],
  'cruises-water':      ['watersports'],
  // These are the Arikok hike, the 4x4 to the natural pool, the dunes and the
  // ruins loop — genuinely both, so they answer to either interest.
  'adventures-outdoor': ['adventure', 'nature-hiking'],
  'culture-history':    ['culture-history'],
  'food-drink':         ['food-drink'],
};

export function activityTags(a: Activity): MatchTag[] {
  const tags = new Set<MatchTag>();
  for (const s of a.sections ?? []) {
    for (const t of SECTION_TAGS[s] ?? []) tags.add(t);
  }
  // Same bands answersToTags uses, so the two sides compare like with like.
  // A pick with no score gets no band rather than a guessed one; the test that
  // every pick yields at least one tag is what catches it if that ever leaves a
  // pick unreachable.
  if (typeof a.adventure === 'number') {
    if (a.adventure <= 33)      tags.add('low-adventure');
    else if (a.adventure <= 66) tags.add('med-adventure');
    else                        tags.add('high-adventure');
  }
  return [...tags];
}

/**
 * The trip length above which the extended-itinerary curation switches on.
 *
 * 10 and not 11 reads oddly until you say it out loud: the rule is "longer than
 * 10 days", so the comparison is `> LONG_TRIP_MIN_DAYS` and an 11-day trip is
 * the first that qualifies. Named for the boundary the owner stated rather than
 * for the first qualifying value, so the constant and the sentence agree.
 */
export const LONG_TRIP_MIN_DAYS = 10;

export function answersToTags(a: Answers): Set<MatchTag> {
  const tags = new Set<MatchTag>();

  for (const i of a.interests) {
    const t = INTEREST_MAP[i];
    if (t) tags.add(t);
  }
  const g = GROUP_TYPE_MAP[a.groupType]; if (g) tags.add(g);
  const b = BUDGET_MAP[a.budget];        if (b) tags.add(b);
  const l = LODGING_MAP[a.lodging];      if (l) tags.add(l);

  // "More than 10 days", as a tag rather than an argument — see the note on
  // `long-trip` in types.ts. Strictly greater than: a 10-day trip is the
  // standard shape the curation was tuned against and must not change.
  if (a.days > LONG_TRIP_MIN_DAYS) tags.add('long-trip');

  // Adventure level bands
  if (a.adventureLevel <= 33)       tags.add('low-adventure');
  else if (a.adventureLevel <= 66)  tags.add('med-adventure');
  else                              tags.add('high-adventure');

  // Q8 flags: ticked pills UNION contraindications parsed from the free-text box
  // (so "I get seasick" forces low-adventure via the same path a pill would).
  const flags = effectiveFlags(a);
  if (flags.has('honeymoon')) tags.add('couple');
  // Carried as a tag rather than read from the flags directly because the two
  // places that act on it — the auto-fill gate and contentCreatorBonus — see
  // only the tag set. Explore, Map and the Dashboard all derive their tags from
  // here too, so the flag surfaces photo/video products on every surface, not
  // just in the generated plan.
  if (flags.has('influencer')) tags.add('influencer');
  // Carried as a tag for the same reason as `influencer`: the scorer sees only
  // the tag set, and this has to reach fitItem on every surface — Explore and
  // the Map derive their tags here too, not just the generated plan.
  if (flags.has('avoid-crowds')) tags.add('avoid-crowds');
  if (flags.has('mobility')) {
    // Override adventure level — mobility-limited travellers only get easy picks
    tags.delete('med-adventure');
    tags.delete('high-adventure');
    tags.add('low-adventure');
  }

  return tags;
}
