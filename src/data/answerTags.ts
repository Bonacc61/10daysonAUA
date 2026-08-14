import type { Answers } from '../App';
import type { MatchTag } from '../types';
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

export function answersToTags(a: Answers): Set<MatchTag> {
  const tags = new Set<MatchTag>();

  for (const i of a.interests) {
    const t = INTEREST_MAP[i];
    if (t) tags.add(t);
  }
  const g = GROUP_TYPE_MAP[a.groupType]; if (g) tags.add(g);
  const b = BUDGET_MAP[a.budget];        if (b) tags.add(b);
  const l = LODGING_MAP[a.lodging];      if (l) tags.add(l);

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
