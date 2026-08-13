import { describe, it, expect } from 'vitest';
import { fitItem, bestItemForAnswers, itemTags, refaceForAnswers, isEveningItem, itemSlotOk, activityKind, isCrowdPleaser, isWaterBased, itemAdventure, matchingSection, isKidsOriented, isFullDayProduct, itemSlotOkForFill, isContentProduct, isAutoFillExcluded, contentCreatorBonus, departurePointFor } from './itemFit';
import { ITEM_PINS, CHECKIN_QUOTES } from './itemCoords';
import type { CardEntry, MatchTag, Section, ViatorItem } from '../types';

function item(over: Partial<ViatorItem>): ViatorItem {
  return {
    id: 'x', group_id: 'sailing-cruises', title: '', image_url: '',
    price_usd: 100, duration: '', rating: 4.7, review_count: 100,
    viator_item_url: '', is_best_seller: false, display_order: 0,
    sections: ['cruises-water'] as Section[], ...over,
  };
}
const tags = (...t: MatchTag[]) => new Set<MatchTag>(t);

const YACHT = item({ id: 'yacht', price_usd: 2300, review_count: 202, sections: ['cruises-water'] });
const CATA  = item({ id: 'cata', price_usd: 69, review_count: 2646, sections: ['cruises-water'] });

describe('itemTags', () => {
  it('classifies budget band + interests from price + sections', () => {
    expect(itemTags(CATA)).toContain('mid-range');       // $69
    expect(itemTags(CATA)).toContain('watersports');     // cruises-water
    expect(itemTags(YACHT)).toContain('money-no-object'); // $2300
  });
});

describe('fitItem — over-budget guard', () => {
  it('rejects a money-no-object item for a budget traveller', () => {
    expect(fitItem(YACHT, tags('budget', 'couple', 'beach-chill')).rejected).toBe(true);
  });
  it('rejects it for a mid-range traveller too (>= 2 bands over)', () => {
    expect(fitItem(YACHT, tags('mid-range')).rejected).toBe(true);
  });
  it('allows it for a money-no-object traveller (no cap)', () => {
    expect(fitItem(YACHT, tags('money-no-object')).rejected).toBe(false);
  });
  it('rejects the $2300 yacht for a treat-yourself traveller too (cap $400)', () => {
    expect(fitItem(YACHT, tags('treat-yourself')).rejected).toBe(true);
  });
  it('allows a sub-cap splurge for a treat-yourself traveller', () => {
    expect(fitItem(item({ id: 'tour', price_usd: 250 }), tags('treat-yourself')).rejected).toBe(false);
  });
  it('caps each tier: budget $110 / mid-range $200 / treat $400', () => {
    expect(fitItem(item({ price_usd: 120 }), tags('budget')).rejected).toBe(true);
    expect(fitItem(item({ price_usd: 100 }), tags('budget')).rejected).toBe(false);
    expect(fitItem(item({ price_usd: 210 }), tags('mid-range')).rejected).toBe(true);
    expect(fitItem(item({ price_usd: 190 }), tags('mid-range')).rejected).toBe(false);
  });
});

describe('bestItemForAnswers', () => {
  it('a budget couple gets the affordable catamaran, never the yacht', () => {
    const pick = bestItemForAnswers([YACHT, CATA], tags('budget', 'couple', 'beach-chill'));
    expect(pick?.id).toBe('cata');
  });
  it('returns null when every item is over budget', () => {
    expect(bestItemForAnswers([YACHT], tags('budget'))).toBeNull();
  });
  it('a money-no-object traveller can still get the yacht if it fits best', () => {
    const pick = bestItemForAnswers([YACHT, item({ id: 'land', price_usd: 2300, sections: ['adventures-outdoor'] })],
      tags('money-no-object', 'watersports'));
    expect(pick?.id).toBe('yacht'); // interest (cruises-water) beats the off-theme land tour
  });
});

describe('slot suitability', () => {
  it('a daytime off-road tour is never evening-appropriate', () => {
    const atv = item({ title: 'Aruba North Coast ATV Desert Adventure', sections: ['adventures-outdoor'], tags: [21421] });
    expect(isEveningItem(atv)).toBe(false);
    expect(itemSlotOk(atv, 'evening')).toBe(false);
    expect(itemSlotOk(atv, 'afternoon')).toBe(true);
  });
  it('evening keywords in the title make an item evening-appropriate', () => {
    expect(isEveningItem(item({ title: 'Sunset Catamaran Sail' }))).toBe(true);
    expect(isEveningItem(item({ title: 'Beachside Dinner Experience' }))).toBe(true);
    expect(isEveningItem(item({ title: 'Aruba Nightlife Party Bus' }))).toBe(true);
  });
  it('an evening item is NOT ok for morning or afternoon slots', () => {
    const party = item({ title: 'Aruba Nightlife Party Bus' });
    expect(itemSlotOk(party, 'morning')).toBe(false);
    expect(itemSlotOk(party, 'afternoon')).toBe(false);
    expect(itemSlotOk(party, 'evening')).toBe(true);
  });
  it('the food-drink section alone does NOT make a daytime item evening', () => {
    // The live food-drink cluster holds day trips, morning sails and breakfast
    // cruises. Section is not a time-of-day signal — only the title's keywords are.
    expect(isEveningItem(item({ title: 'All-Inclusive Day Trip', sections: ['food-drink'] }))).toBe(false);
    expect(isEveningItem(item({ title: 'Morning Champagne Sail', sections: ['food-drink'] }))).toBe(false);
    expect(isEveningItem(item({ title: 'A Tour', sections: ['food-drink'] }))).toBe(false);
  });
});

describe('activityKind — same-day variety', () => {
  it('an ATV tour and a Jeep safari are the same kind (off-road)', () => {
    expect(activityKind(item({ tags: [21421] }))).toBe('offroad'); // ATV
    expect(activityKind(item({ tags: [12035] }))).toBe('offroad'); // 4WD/Jeep
  });
  it('a snorkel sail and a sunset sail are different kinds', () => {
    expect(activityKind(item({ tags: [11912] }))).toBe('snorkel');
    expect(activityKind(item({ tags: [11963] }))).toBe('sail');
  });
});

describe('isCrowdPleaser — curated high-bookability picks', () => {
  it('flags catamaran/sailing cruises (sail kind)', () => {
    expect(isCrowdPleaser(item({ title: 'Catamaran Day Sail', tags: [11963] }))).toBe(true);
  });
  it('flags snorkel trips incl. Jolly Pirates (snorkel kind)', () => {
    expect(isCrowdPleaser(item({ title: 'Jolly Pirates Snorkel Cruise', tags: [11912] }))).toBe(true);
  });
  it('flags sunset sails and dinner cruises by title', () => {
    expect(isCrowdPleaser(item({ title: 'Champagne Sunset Sail', tags: [] }))).toBe(true);
    expect(isCrowdPleaser(item({ title: 'Caribbean Dinner Cruise', tags: [] }))).toBe(true);
  });
  it('flags Natural Pool / Arikok jeep tours (offroad + destination)', () => {
    expect(isCrowdPleaser(item({ title: 'Arikok 4x4 Jeep Safari to Natural Pool', tags: [12035] }))).toBe(true);
    expect(isCrowdPleaser(item({ title: 'Conchi Natural Pool UTV Adventure', tags: [21421] }))).toBe(true);
  });
  it('does NOT flag a generic offroad tour with no crowd-pleaser destination', () => {
    expect(isCrowdPleaser(item({ title: 'North Coast ATV Desert Ride', tags: [21421] }))).toBe(false);
  });
  it('does NOT flag niche activities (kayak photo shoot, submarine)', () => {
    expect(isCrowdPleaser(item({ title: 'Sunrise Kayak Photo Shoot', tags: [12047] }))).toBe(false);
    expect(isCrowdPleaser(item({ title: 'Atlantis Submarine Expedition', tags: [] }))).toBe(false);
  });
});

describe('isKidsOriented — products only a group with children should be offered', () => {
  it('flags the water-park day pass by its Viator tag (De Palm Island)', () => {
    // 2455P18 on the live catalog: tag 12043 "Water Parks", 370 reviews.
    expect(isKidsOriented(item({ title: 'Aruba De Palm Island Day Pass', tags: [11912, 12043] }))).toBe(true);
  });
  it('flags a day pass / water park / kids product by title', () => {
    expect(isKidsOriented(item({ title: 'Island Day Pass with Lunch', tags: [] }))).toBe(true);
    expect(isKidsOriented(item({ title: 'Aruba Water Park Entry', tags: [] }))).toBe(true);
    expect(isKidsOriented(item({ title: 'Kids Parasailing Experience Aruba', tags: [13209] }))).toBe(true);
  });
  it('does NOT flag the mainstream experiences every group gets offered', () => {
    expect(isKidsOriented(item({ title: 'Jolly Pirates Snorkel Cruise', tags: [11912] }))).toBe(false);
    expect(isKidsOriented(item({ title: 'Champagne Sunset Sail', tags: [11963] }))).toBe(false);
    expect(isKidsOriented(item({ title: 'Arikok 4x4 Jeep Safari to Natural Pool', tags: [12035] }))).toBe(false);
  });
  it('does NOT flag a family-suitable tour that is not a kids product', () => {
    // 12431P3 carries Viator's "Kid-Friendly" tag (11919) but is a general
    // history tour with 1,584 reviews — gating it would be wrong. Which is why
    // 11919 is deliberately NOT the signal.
    expect(isKidsOriented(item({ title: 'Full-Day Aruba History and Must-See Landmarks Tour', tags: [11919] }))).toBe(false);
  });
});

describe('itemSlotOkForFill — a product that names its time of day', () => {
  it('keeps an "Afternoon" product out of the morning', () => {
    // Reported: the Jolly Pirate AFTERNOON sail suggested as a morning card.
    const pm = item({ title: 'Aruba Jolly Pirate Afternoon Sail with Snorkeling', tags: [11888] });
    expect(itemSlotOkForFill(pm, 'morning')).toBe(false);
    expect(itemSlotOkForFill(pm, 'afternoon')).toBe(true);
  });
  it('keeps a "Morning" product out of the afternoon', () => {
    const am = item({ title: 'Premium Catamaran Morning Sail: Snorkeling, Mimosas and Brunch', tags: [11888] });
    expect(itemSlotOkForFill(am, 'afternoon')).toBe(false);
    expect(itemSlotOkForFill(am, 'morning')).toBe(true);
  });
  it('does NOT pin a product that offers both ("morning or afternoon")', () => {
    // The one live title that says both words. Reading it as morning-only would
    // halve where a perfectly flexible product can go.
    const both = item({ title: '4-seater UTV Island 4hr Tour in Aruba, morning or afternoon', tags: [21421] });
    expect(itemSlotOkForFill(both, 'morning')).toBe(true);
    expect(itemSlotOkForFill(both, 'afternoon')).toBe(true);
  });
  it('leaves products that name no time of day free to take either slot', () => {
    const any = item({ title: 'Aruba Snorkel Sail', tags: [11888] });
    expect(itemSlotOkForFill(any, 'morning')).toBe(true);
    expect(itemSlotOkForFill(any, 'afternoon')).toBe(true);
  });
  it('does NOT leak into itemSlotOk, which the display chokepoint reads', () => {
    // resolveSlotEntry re-faces a stored card whose id is missing from the
    // slot-filtered pool. If the naming preference lived in itemSlotOk, every
    // saved and SHARED itinerary holding an "Afternoon Sail" in a morning slot
    // would quietly render as a different product.
    const pm = item({ title: 'Aruba Jolly Pirate Afternoon Sail with Snorkeling', tags: [11888] });
    expect(itemSlotOk(pm, 'morning')).toBe(true);
    expect(itemSlotOk(pm, 'afternoon')).toBe(true);
    expect(itemSlotOk(pm, 'evening')).toBe(false);
  });
});

describe('isFullDayProduct — products that consume the whole daytime', () => {
  it('flags an island day pass', () => {
    expect(isFullDayProduct(item({ title: 'Aruba De Palm Island Day Pass', duration: '6 hrs' }))).toBe(true);
  });
  it('does NOT flag half-day products that merely say "day"', () => {
    expect(isFullDayProduct(item({ title: 'Half-Day Snorkel Sail Tour with Caribbean Lunch' }))).toBe(false);
    expect(isFullDayProduct(item({ title: 'Aruba Half day Private Jeep Tour - Sightseeing and more' }))).toBe(false);
    expect(isFullDayProduct(item({ title: 'Full-Day Aruba History and Must-See Landmarks Tour' }))).toBe(false);
  });
});

describe('fitItem — crowd-pleaser boost', () => {
  const PIRATES = item({ id: 'pir', title: 'Jolly Pirates Snorkel Cruise', tags: [11912],
    price_usd: 65, review_count: 1822, popularity_score: 0.85 });
  const CHARTER = item({ id: 'chr', title: 'Private Catamaran Charter', tags: [11888],
    price_usd: 1450, review_count: 87, popularity_score: 0.5 });

  it('a money-no-object traveller: the $65 Jolly Pirates outscores the $1,450 charter', () => {
    const t = tags('money-no-object', 'watersports');
    // Both are sail/snorkel crowd-pleasers, but pirates wins on popularity +
    // the under-budget waiver (no penalty for being cheaper).
    expect(fitItem(PIRATES, t).score).toBeGreaterThan(fitItem(CHARTER, t).score);
  });

  it('boosts a crowd-pleaser above an equally-fitting niche item', () => {
    const niche = item({ id: 'sub', title: 'Submarine Tour', tags: [], sections: ['cruises-water'],
      price_usd: 65, review_count: 1822, popularity_score: 0.85 });
    const t = tags('mid-range', 'watersports');
    expect(fitItem(PIRATES, t).score).toBeGreaterThan(fitItem(niche, t).score);
  });

  it('never overrides the hard budget cap (crowd-pleaser still rejected if unaffordable)', () => {
    expect(fitItem(CHARTER, tags('budget')).rejected).toBe(true);
  });
});

// Titles taken verbatim from the live Viator catalog (2026-08-06).
describe('isContentProduct — the influencer net', () => {
  it('catches photoshoots, video-included tours and photo stops', () => {
    for (const title of [
      'Professional Sunset Photoshoot in Aruba',
      'Private Vacation Photoshoot with Photographer in Aruba',
      'Award-Winning Private Turtle Snorkeling Aruba | Video Included',
      'Private Turtle Snorkel Tour in Aruba +Professional video footage',
      'Aruba Ecological & Coastline Horseback Ride with Beach Photo Stop',
      'Aruba Bamboo Raft Photo| Videoshoot + Free Cocktails Edits 24Hrs',
      'Private Dive + videographer/Photographer (Certified divers only)',
    ]) expect(isContentProduct(item({ title }))).toBe(true);
  });

  // Substring, not word-anchored: two live products advertise the operator
  // handle "@arubaphotoshootexperience", where a letter precedes "photo".
  it('catches a photo product whose title has no word boundary before "photo"', () => {
    expect(isContentProduct(item({ title: "50%OFF Aruba's #1Clear Kayak Experience@arubaphotoshootexperience" }))).toBe(true);
  });

  it('leaves ordinary experiences alone', () => {
    for (const title of [
      'Premium Morning Snorkel Sail with Champagne Brunch',
      'Island Jeep Safari with Natural Pool Baby Beach and Lunch',
      'Aruba De Palm Island Day Pass',
    ]) expect(isContentProduct(item({ title }))).toBe(false);
  });
});

describe('isAutoFillExcluded — the influencer lift', () => {
  const SHOOT = item({ title: 'Professional Sunset Photoshoot in Aruba' });
  const DIAMONDS = item({ title: 'Diamond Shopping Experience with Champagne' });
  const HARLEY = item({ title: 'Harley-Davidson RENTALS ONLY 8 hrs' });

  it('excludes a photoshoot by default', () => {
    expect(isAutoFillExcluded(SHOOT)).toBe(true);
  });

  it('lets a photoshoot through for an influencer', () => {
    expect(isAutoFillExcluded(SHOOT, true)).toBe(false);
  });

  // The lift is scoped to the photo branch only — a jewellery showroom is not an
  // outing for anyone, and a bare motorbike is still not a plan for the day.
  it('still excludes retail and self-drive hire for an influencer', () => {
    expect(isAutoFillExcluded(DIAMONDS, true)).toBe(true);
    expect(isAutoFillExcluded(HARLEY, true)).toBe(true);
  });
});

describe('contentCreatorBonus', () => {
  const SHOOT = item({ title: 'Professional Sunset Photoshoot in Aruba' });
  const SAIL = item({ title: 'Premium Morning Snorkel Sail with Champagne Brunch' });

  it('is zero without the influencer tag', () => {
    expect(contentCreatorBonus(SHOOT, tags('couple', 'beach-chill'))).toBe(0);
  });

  it('is zero for a non-content product even with the tag', () => {
    expect(contentCreatorBonus(SAIL, tags('influencer', 'beach-chill'))).toBe(0);
  });

  it('lifts a content product for an influencer', () => {
    expect(contentCreatorBonus(SHOOT, tags('influencer'))).toBeGreaterThan(0);
  });

  it('makes a photoshoot the group face over a better-reviewed alternative', () => {
    const shoot = item({ id: 'shoot', title: 'Professional Sunset Photoshoot in Aruba',
      price_usd: 125, review_count: 56, popularity_score: 0.3, sections: ['culture-history'] });
    const tour = item({ id: 'tour', title: 'Oranjestad Walking Tour',
      price_usd: 125, review_count: 900, popularity_score: 0.6, sections: ['culture-history'] });
    const t = tags('influencer', 'treat-yourself', 'culture-history');
    expect(bestItemForAnswers([tour, shoot], t)?.id).toBe('shoot');
    // …and without the flag the well-reviewed tour still wins.
    expect(bestItemForAnswers([tour, shoot], tags('treat-yourself', 'culture-history'))?.id).toBe('tour');
  });
});

describe('refaceForAnswers — local activity slot filtering', () => {
  const makeActivity = (id: string, tod: 'Morning' | 'Afternoon' | 'Evening') => ({
    kind: 'activity' as const,
    activity: {
      id, title: id, category: 'Beaches' as const, image: '', description: '', localsSay: '',
      cost: 'Free', duration: '2 hrs', timeOfDay: tod, fitReason: '', location: '',
      rating: 4.5, reviewCount: 100, adventure: 20, sections: ['beaches'] as Section[],
      matched_by: [] as MatchTag[],
    },
  });

  it('passes a morning activity through a morning slot filter', () => {
    const entry = makeActivity('morn', 'Morning');
    expect(refaceForAnswers([entry], new Set(), 'morning').length).toBe(1);
  });

  it('drops an evening activity from a morning pool', () => {
    const entry = makeActivity('eve', 'Evening');
    expect(refaceForAnswers([entry], new Set(), 'morning').length).toBe(0);
  });

  it('drops an evening activity from an afternoon pool', () => {
    const entry = makeActivity('eve', 'Evening');
    expect(refaceForAnswers([entry], new Set(), 'afternoon').length).toBe(0);
  });

  it('passes an evening activity through an evening slot filter', () => {
    const entry = makeActivity('eve', 'Evening');
    expect(refaceForAnswers([entry], new Set(), 'evening').length).toBe(1);
  });

  it('passes all timeOfDays through when no slot given (generator pre-filters)', () => {
    const entries = ['Morning', 'Afternoon', 'Evening'].map((tod) =>
      makeActivity(tod, tod as 'Morning' | 'Afternoon' | 'Evening'));
    expect(refaceForAnswers(entries, new Set()).length).toBe(3);
  });
});

describe('refaceForAnswers', () => {
  const group = { id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
    viator_group_url: '', display_order: 0, matched_by: ['couple'] as MatchTag[], region: 'palm-beach' as const,
    allowed_slots: ['afternoon'] as const };
  const entry: CardEntry = { kind: 'group', group: group as never, bestSeller: YACHT, others: [CATA] };

  it('swaps the card face to the fitting item for a budget couple', () => {
    const [refaced] = refaceForAnswers([entry], tags('budget', 'couple', 'beach-chill'));
    expect(refaced.kind === 'group' && refaced.bestSeller.id).toBe('cata');
  });
  it('drops the whole group when nothing fits the budget', () => {
    const onlyYacht: CardEntry = { kind: 'group', group: group as never, bestSeller: YACHT, others: [] };
    expect(refaceForAnswers([onlyYacht], tags('budget')).length).toBe(0);
  });
});

describe('isWaterBased — the no-boats (seasick) net', () => {
  // Regression: the live feed files this one under food-drink-experiences with
  // no sailing tag, so section- and tag-based detection both missed it and a
  // seasick traveller was handed a dinner cruise.
  it('catches a boat the feed metadata mislabels, on the title alone', () => {
    const mislabelled = item({
      title: 'Luxury Four-Course Caribbean Dinner Cruise Experience',
      group_id: 'food-drink-experiences', sections: ['food-drink'] as Section[], tags: [],
    });
    expect(isWaterBased(mislabelled)).toBe(true);
  });

  it('still catches boats via section and tag metadata', () => {
    expect(isWaterBased(item({ title: 'Anything', sections: ['cruises-water'] as Section[] }))).toBe(true);
    expect(isWaterBased(item({ title: 'Anything', sections: ['food-drink'] as Section[], tags: [11888] }))).toBe(true);
  });

  it('does not flag land experiences', () => {
    for (const title of ['Aruba Nightlife Party Bus Tour', 'Arikok National Park 4x4 Jeep Safari',
                         'Downtown Historic and Cultural Walking Tour', 'Aruba Rum Distillery & Tasting']) {
      expect(isWaterBased(item({ title, sections: ['food-drink'] as Section[], tags: [] }))).toBe(false);
    }
  });
});

describe('matchingSection — kind beats Explore tab order', () => {
  // Regression: primarySection resolves ties by tab order and 'cruises-water' is
  // first, so Aruba's #1 product ("Island Jeep Safari with Natural Pool, Baby
  // Beach and Lunch" — 9,885 reviews) carries both a 4WD tag and a boat tag and
  // was being filed as a watersport.
  it('files a jeep safari that also carries a boat tag as adventures-outdoor', () => {
    const jeep = item({ title: 'Island Jeep Safari with Natural Pool and Baby Beach', tags: [12035, 21701], sections: undefined });
    expect(activityKind(jeep)).toBe('offroad');
    expect(matchingSection(jeep)).toBe('adventures-outdoor');
  });

  it('still files a plain catamaran sail as cruises-water', () => {
    expect(matchingSection(item({ title: 'Catamaran Sail', tags: [11888], sections: undefined }))).toBe('cruises-water');
  });
});

describe('itemAdventure — kind, not section', () => {
  // Regression: every water product shares 'cruises-water' (45), so a
  // section-only value threw a gentle sunset catamaran out of a with-baby (25)
  // or mobility (30) plan alongside the kitesurfing it was meant to exclude.
  it('rates a gentle sail below the with-baby and mobility caps', () => {
    const sail = item({ title: 'Sunset Catamaran Sail', tags: [11888], sections: undefined });
    expect(itemAdventure(sail)).toBeLessThanOrEqual(25);
  });

  it('rates adrenaline kinds above every contraindication cap', () => {
    for (const [title, tag] of [['UTV Off-Road', 12035], ['Jet Ski Rental', 12062], ['Zipline', 13143]] as const) {
      expect(itemAdventure(item({ title, tags: [tag], sections: undefined })), title).toBeGreaterThan(52);
    }
  });

  // Every value must sit STRICTLY above the cap meant to exclude it — an
  // equality or a near-miss silently disables the flag. hike:50 let every Viator
  // hiking product through intense-hikes (52) while the curated local
  // arikok-hiking (55) was dropped; snorkel:30 tied mobility (30) exactly.
  it('keeps each kind clear of the cap that must exclude it', () => {
    const MOBILITY = 30, INTENSE_HIKES = 52, WITH_BABY = 25;
    const adv = (tag: number) => itemAdventure(item({ title: 't', tags: [tag], sections: undefined }));
    expect(adv(11902), 'hike vs intense-hikes').toBeGreaterThan(INTENSE_HIKES);
    expect(adv(11912), 'snorkel vs mobility').toBeGreaterThan(MOBILITY);
    expect(adv(12021), 'dive vs intense-hikes').toBeGreaterThan(INTENSE_HIKES);
    // ...and a gentle sail stays under the strictest cap so the staple survives.
    expect(adv(11888), 'sail vs with-baby').toBeLessThanOrEqual(WITH_BABY);
  });

  it('honours an explicit curated adventure number over the kind default', () => {
    expect(itemAdventure(item({ title: 'Sail', tags: [11888], adventure: 90, sections: undefined }))).toBe(90);
  });
});

describe('departurePointFor', () => {
  it('gives the departure point and the operator check-in quote', () => {
    // '6593P7' is a live sunset-sail product pinned at Pelican Pier, whose
    // Viator listing states the time. Quote is rendered verbatim, never reworded.
    expect(departurePointFor(item({ id: '6593P7' }))).toEqual({
      place: 'Pelican Pier',
      checkin: 'Check-in time is at 9:30 A.M',
      approx: false,
    });
  });

  it('flags an approximate pin so the card can say "near" instead of "from"', () => {
    // '47607P2' pins on the Holiday Inn Resort because that is the landmark the
    // operator's meeting-point text names; the actual hut is on the beach
    // behind it. Right hotel, wrong doorway — stating it as "departs from"
    // would be a confident near-miss.
    expect(departurePointFor(item({ id: '47607P2' }))?.approx).toBe(true);
    expect(departurePointFor(item({ id: '6593P7' }))?.approx).toBe(false);
  });

  it('gives the place alone when the operator never stated a check-in time', () => {
    // The normal case: 44 of 53 departure pins say nothing about timing.
    const out = departurePointFor(item({ id: '103088P1' }));
    expect(out?.place).toBe('Palm Beach');
    expect(out?.checkin).toBeUndefined();
  });

  it('never offers a DESTINATION pin as a departure point', () => {
    // '445910P2' is pinned on the SS Antilla wreck — where the boat goes, not
    // where you board. Printing "departs from" here sends someone to a WW2
    // shipwreck lying offshore.
    expect(departurePointFor(item({ id: '445910P2' }))).toBeNull();
  });

  it('stays silent for items with no pin on record', () => {
    expect(departurePointFor(item({ id: 'no-such-product' }))).toBeNull();
  });

  it('does not label a land activity with a departure point', () => {
    expect(departurePointFor(item({
      id: '6593P7', title: 'Jeep Safari', sections: ['adventures-outdoor'],
    }))).toBeNull();
  });

  it('every check-in quote belongs to a pin that actually exists', () => {
    // A typo in the id would silently drop the quote rather than fail loudly.
    const orphans = Object.keys(CHECKIN_QUOTES).filter((id) => !ITEM_PINS[id]);
    expect(orphans).toEqual([]);
  });

  it('every check-in quote appears verbatim in its own pin citation', () => {
    // Guards the invariant that makes this safe to display: we quote, never
    // assert. A tidied "Check-in 17:00" would be this site stating a fact.
    //
    // Checking the quote against the PIN CITATION is what gives that teeth. An
    // earlier version asserted only that the string contained "check in", which
    // the synthesised "Check-in 17:00" it names as the thing to prevent passes
    // cleanly — it tested nothing. The citation is the researched record of what
    // the operator actually published, so requiring the quote to be a substring
    // of it means a quote can only ever be copied, never composed.
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    for (const [id, q] of Object.entries(CHECKIN_QUOTES)) {
      const cite = ITEM_PINS[id]?.cite ?? '';
      expect(norm(cite).includes(norm(q)), `${id}: ${q}`).toBe(true);
    }
  });
});
