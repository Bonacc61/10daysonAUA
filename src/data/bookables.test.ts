import { describe, it, expect } from 'vitest';
import { bookableTier, isBookable, bookingDays, ANIMAL_SANCTUARY_ID, JET_SKI_ID, SUBMARINE_ID, DE_PALM_ISLAND_ID } from './bookables';
import type { CardEntry, MatchTag, Section, ViatorGroup, ViatorItem } from '../types';
import type { Activity } from './activities';

const tags = (...t: MatchTag[]) => new Set<MatchTag>(t);

const GROUP: ViatorGroup = { id: 'g', name: 'g', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'islandwide', allowed_slots: [] };

function group(over: Partial<ViatorItem>): CardEntry {
  const bestSeller: ViatorItem = {
    id: 'x', group_id: 'g', title: '', image_url: '', price_usd: 100, duration: '',
    rating: 4.7, review_count: 100, viator_item_url: '', is_best_seller: false,
    display_order: 0, sections: ['cruises-water'] as Section[], ...over,
  };
  return { kind: 'group', group: GROUP, bestSeller, others: [] };
}

function local(over: Partial<Activity>): CardEntry {
  return { kind: 'activity', activity: {
    id: 'a', title: '', category: 'Activities', image: '', description: '', localsSay: '',
    cost: '$50', duration: '', timeOfDay: 'Morning', fitReason: '', location: '',
    rating: 4.5, reviewCount: 10, matched_by: [], ...over,
  } as Activity };
}

// tag 11888 = sailing, 11912 = snorkelling, 12035 = 4WD/off-road (see KIND_BY_TAG)
const SAIL = group({ title: 'Sunset Catamaran Sail', tags: [11888] });
const SNORKEL_BOAT = group({ title: 'Antilla Wreck Snorkel Cruise', tags: [11912] });
const BEACH_SHUTTLE = group({ title: 'Aruba Baby Beach Express Tour', tags: [11912] });
const JEEP = group({ title: 'Natural Pool Rugged Jeep Safari', tags: [12035] });
const ESCOOTER = group({ title: 'Guided 3-Hour E-Scooter Island Tour in Aruba', tags: [12035] });

describe('bookableTier — kind families', () => {
  it('accepts a sail for anyone', () => {
    expect(bookableTier(SAIL, tags('couple', 'mid-range'))).toBe(1);
  });

  it('accepts a snorkel boat but rejects a beach shuttle wearing the snorkel tag', () => {
    expect(bookableTier(SNORKEL_BOAT, tags('couple'))).toBe(1);
    expect(bookableTier(BEACH_SHUTTLE, tags('couple'))).toBe(null);
  });

  it('accepts a jeep safari but rejects an e-scooter wearing the off-road tag', () => {
    expect(bookableTier(JEEP, tags('couple'))).toBe(1);
    expect(bookableTier(ESCOOTER, tags('couple'))).toBe(null);
  });

  // 2026-08-19. "Epic Off-Road Surron Electric Bike Tour in Aruba" ($160, 42
  // reviews) was a bookable for one reason only: "Off-Road" is in its name. It
  // is an e-bike tour — the same class as the e-scooters above, which are out
  // only because no JEEP_TITLE word happens to appear in their titles.
  //
  // Both directions, because a rule that simply narrowed the off-road row would
  // pass the first assertion and quietly delete the family. The three tours
  // below are live products the owner named as ones that MUST stay eligible.
  it('rejects an off-road e-bike tour', () => {
    expect(bookableTier(
      group({ title: 'Epic Off-Road Surron Electric Bike Tour in Aruba', tags: [12035] }), tags('couple'),
    )).toBe(null);
  });

  it('still accepts genuine off-road tours that name no bike', () => {
    for (const title of [
      'Private Off-Road Adventure to Cave Pool and Tres Trapi',
      'Aruba Off Road Safari Tour to Natural Pool',
      'Aruba Off-Road ATV Tour',
    ]) {
      expect(bookableTier(group({ title, tags: [12035] }), tags('couple'))).toBe(1);
    }
  });

  // ...and a title that NAMES a four-wheeler keeps its place, however it
  // advertises itself. "Quad bike" and "dirt bike" are standard ATV marketing,
  // so bare `bike` is not evidence of two wheels on its own. The first title
  // below is the offline stub's own `atv-quad` ($75, 622 reviews), which the
  // e-bike rule alone took from tier 1 to null — and the stub IS the catalog
  // whenever `loadCatalog()` fails.
  it('keeps a quad bike, which is an ATV however it is advertised', () => {
    for (const title of [
      'ATV Quad Bike Adventure Tour',
      'Aruba Dirt Bike and Buggy Safari',
      'UTV Off-Road Bike Tour to Natural Pool',
    ]) {
      expect(bookableTier(group({ title, tags: [12035] }), tags('couple'))).toBe(1);
    }
  });

  // The exclusion is scoped to the OFF-ROAD row and must stay there: "scooter"
  // is not a disqualifier in the water, where a sea scooter is the outing.
  it('leaves the seabob scooter reef tour on the snorkel row', () => {
    expect(bookableTier(
      group({ title: 'Aruba Seabob Scooter Reef Tour', tags: [11912] }), tags('couple'),
    )).toBe(1);
  });

  it('rejects anything free, because a booking costs money', () => {
    expect(bookableTier(group({ title: 'Free Sail', tags: [11888], price_usd: 0 }), tags('couple'))).toBe(null);
  });
});

describe('bookableTier — persona-conditional families, both directions', () => {
  const sanctuary = group({ id: ANIMAL_SANCTUARY_ID, title: 'Half-Day Aruba Animal Sanctuary Guided Tour' });
  const jetski = group({ id: JET_SKI_ID, title: 'Aruba Jet Ski Rental' });
  const sub = group({ id: SUBMARINE_ID, title: 'Aruba Atlantis Submarine Tour' });
  const dePalm = group({ id: DE_PALM_ISLAND_ID, title: 'Aruba De Palm Island Day Pass', tags: [11912] });
  const kite = local({ id: 'kitesurfing-lesson', title: "Kitesurfing at Fisherman's Huts", cost: '$120 lesson' });

  it('animal sanctuary: young kids only', () => {
    expect(bookableTier(sanctuary, tags('family-young-kids'))).toBe(1);
    expect(bookableTier(sanctuary, tags('couple'))).toBe(null);
    expect(bookableTier(sanctuary, tags('family-teens'))).toBe(null);
  });

  it('jet ski and kitesurfing: teens AND high-adventure', () => {
    expect(bookableTier(jetski, tags('family-teens', 'high-adventure'))).toBe(1);
    expect(bookableTier(jetski, tags('family-teens', 'med-adventure'))).toBe(null);
    expect(bookableTier(jetski, tags('friends', 'high-adventure'))).toBe(null);
    expect(bookableTier(kite, tags('family-teens', 'high-adventure'))).toBe(1);
    expect(bookableTier(kite, tags('family-teens'))).toBe(null);
  });

  it('submarine is tier 2 for young kids and nothing for teens', () => {
    expect(bookableTier(sub, tags('family-young-kids'))).toBe(2);
    expect(bookableTier(sub, tags('family-teens'))).toBe(null);
    expect(bookableTier(sub, tags('couple'))).toBe(null);
  });

  it('De Palm Island is tier 2 for kids of either age and NOT reachable via the snorkel row', () => {
    expect(bookableTier(dePalm, tags('family-young-kids'))).toBe(2);
    expect(bookableTier(dePalm, tags('family-teens'))).toBe(2);
    // The carve-out. Its Viator tag is snorkelling and its title says "Island"
    // and "Day Pass", so without an explicit id check it would pass row 3.
    expect(bookableTier(dePalm, tags('couple', 'mid-range'))).toBe(null);
  });
});

describe('bookableTier — content products (ruling R8)', () => {
  // isContentProduct reads the TITLE ("photoshoot"/"photography"/"photo shoot",
  // or the broader footage/video net) — see itemFit.ts. Untagged and unnamed by
  // id, so it must be tested by title like the curated locals above.
  const photoshoot = group({ id: 'photo-1', title: 'Private Vacation Photoshoot with Photographer in Aruba' });

  it('is tier 1 for a traveller who ticked "I am an influencer"', () => {
    expect(bookableTier(photoshoot, tags('influencer'))).toBe(1);
  });

  it('is null for a traveller who did not — both directions matter, or the tag is decorative', () => {
    expect(bookableTier(photoshoot, tags('couple', 'mid-range'))).toBe(null);
  });

  // Regression guard (ruling R10, 2026-08-18). The content-product row sat
  // ABOVE the kind rows until this ruling and, measured against the live
  // catalog, that order excluded two genuine, top-reviewed turtle snorkel
  // tours for every non-influencer traveller — both merely mention video in
  // the title. The row must sit below `snorkel`/`sail`/`offroad` so a real
  // tour keeps its kind classification regardless of influencer status.
  const turtleSnorkelWithVideo = group({
    id: 'turtle-1', title: 'Private Turtle Snorkel Tour in Aruba +Professional video footage', tags: [11912],
  });

  it('a genuine snorkel tour that merely mentions video stays tier 1 for a traveller with NO influencer tag', () => {
    expect(bookableTier(turtleSnorkelWithVideo, tags('couple', 'mid-range'))).toBe(1);
  });

  // I4 (final whole-branch review, 2026-08-18). The row used to ask
  // `isContentProduct` (`/photo|video/i`, unanchored), which admitted 24 live
  // products the design spec excludes by name. All four titles below are real
  // ones from the live catalog; the kayak was measured landing on day 7 of the
  // influencer persona's plan on both seeds. None carries a whitelist kind, so
  // the ONLY thing deciding them is this row.
  const clearKayak = group({ id: 'kayak-1', title: "50%OFF Aruba's #1Clear Kayak Experience@arubaphotoshootexperience" });
  const horseback = group({ id: 'horse-1', title: 'Horseback Riding Tour with Photos in Aruba', price_usd: 95 });
  const diveWithVideographer = group({ id: 'dive-1', title: 'Private Dive + videographer/Photographer', price_usd: 120 });

  it('is NOT tier 1 for an influencer when the product is a tour that merely throws in photos', () => {
    expect(bookableTier(horseback, tags('influencer'))).toBe(null);
    // The spec has a section titled "Diving is deliberately out".
    expect(bookableTier(diveWithVideographer, tags('influencer'))).toBe(null);
  });

  // 2026-08-21, owner's ruling: the clear-kayak photoshoot IS the influencer's
  // product and must appear for them and for nobody else. This reverses I4's
  // verdict on this one genre — `clearKayak` above asserted `null` for an
  // influencer until today. I4's other half stands untouched and is still
  // guarded by `horseback` and `diveWithVideographer` above, and by the turtle
  // snorkel test: a tour that merely MENTIONS video is still not a shoot.
  //
  // What made the genre slip through was word boundaries, twice over — the
  // operator's social handle is glued to the title, and a digit sits in front
  // of "Clear". Both spellings are real live titles, so both are pinned here.
  const clearKayakHandle = clearKayak;
  const clearKayakDigit = group({ id: 'kayak-2', title: '#1Clear Kayak Aruba Shoot| FREE Cocktail|Edits 24hr|+Free Coupons' });

  it('gives the clear-kayak photoshoot to an influencer, however the title is spelled', () => {
    expect(bookableTier(clearKayakHandle, tags('influencer'))).toBe(1);
    expect(bookableTier(clearKayakDigit, tags('influencer'))).toBe(1);
  });

  it('gives the clear-kayak photoshoot to NOBODY else', () => {
    for (const t of [tags('couple', 'mid-range'), tags('friends', 'high-adventure'), tags('family-young-kids')]) {
      expect(bookableTier(clearKayakHandle, t)).toBe(null);
      expect(bookableTier(clearKayakDigit, t)).toBe(null);
    }
  });

  it('is still tier 1 for an influencer when the product IS the shoot', () => {
    expect(bookableTier(photoshoot, tags('influencer'))).toBe(1);
    expect(bookableTier(group({ id: 'photo-2', title: 'Aruba Vacation Photography Session at Sunset' }), tags('influencer'))).toBe(1);
    expect(bookableTier(group({ id: 'photo-3', title: 'Private Beach Photo Shoot in Aruba' }), tags('influencer'))).toBe(1);
  });
});

describe('bookableTier — the extended-itinerary curation (2026-08-21)', () => {
  const ride = (id: string, title: string, over = {}) => group({ id, title, tags: [11902], price_usd: 99, ...over });
  const LONG = (...t: string[]) => tags('long-trip', ...(t as never[]));

  it('offers horseback only on a trip longer than 10 days', () => {
    const h = ride('h1', 'Aruba Countryside: Horseback Adventure to Urirama Cove');
    expect(bookableTier(h, tags('couple', 'mid-range'))).toBe(null);        // 10 days or fewer
    expect(bookableTier(h, LONG('couple', 'mid-range'))).toBe(2);           // 11+
  });

  // The two rides Viator files under `offroad`. Without the title test above the
  // kind rows they would reach row 2 and be handed to EVERY traveller as jeep
  // safaris — the opposite of "keep them separate".
  it('catches the rides Viator mis-files as off-road', () => {
    for (const t of ['Aruba Horseback Riding Tour For Advanced Riders',
                     'Horseback Riding and Natural Pool Adventure in Aruba']) {
      expect(bookableTier(ride(`o-${t.slice(0, 8)}`, t, { tags: [12035] }), tags('couple'))).toBe(null);
      expect(bookableTier(ride(`o2-${t.slice(0, 8)}`, t, { tags: [12035] }), LONG('couple'))).toBe(2);
    }
  });

  it('gives kitesurfing to an adventurous splurge traveller on a long trip, and to nobody shorter', () => {
    const kite = local({ id: 'kitesurfing-lesson', cost: '$120 lesson' });
    expect(bookableTier(kite, LONG('treat-yourself', 'high-adventure'))).toBe(1);
    expect(bookableTier(kite, LONG('money-no-object', 'high-adventure'))).toBe(1);
    // Each condition is load-bearing — drop any one and it is refused.
    expect(bookableTier(kite, tags('treat-yourself', 'high-adventure'))).toBe(null);      // not long
    expect(bookableTier(kite, LONG('mid-range', 'high-adventure'))).toBe(null);           // not splurge
    expect(bookableTier(kite, LONG('treat-yourself', 'low-adventure'))).toBe(null);       // not adventurous
  });

  it('keeps the family-teens route to kitesurfing, which predates all of this', () => {
    const kite = local({ id: 'kitesurfing-lesson', cost: '$120 lesson' });
    expect(bookableTier(kite, tags('family-teens', 'high-adventure'))).toBe(1);
  });
});

describe('bookableTier — guided hikes (tier 2, 2026-08-21)', () => {
  // Every title here is a real live product. Tier 2, so a hike fills a booking
  // day the curated set left over and never competes with a catamaran.
  const hike = (id: string, title: string) => group({ id, title, tags: [11902], price_usd: 60 });

  it('accepts a guided hike, at tier 2 and not tier 1', () => {
    expect(bookableTier(hike('h1', 'Half Day Hike at Arikok National Park & Snorkel'), tags('couple'))).toBe(2);
    expect(bookableTier(hike('h2', 'Private Aruba National Park Hiking & Natural Pool Swimming'), tags('couple'))).toBe(2);
  });

  it('refuses the bike tours that share the hike KIND', () => {
    // `activityKind` files both under 'hike'; neither is a walk. This is the
    // off-road row's lesson applied to a new family, as the spec asks.
    expect(bookableTier(hike('b1', 'Private Mountain Bike Tour in Aruba'), tags('couple'))).toBe(null);
    expect(bookableTier(hike('b2', 'Baby Beach Sunrise Adventure Bike, Hike & Snorkel'), tags('couple'))).toBe(null);
  });

  it('is a hike for every traveller — this row carries no persona condition', () => {
    const h = hike('h3', 'Hooiberg Hill Hike (Sunrise, Sunset, Night)');
    for (const t of [tags('couple', 'mid-range'), tags('family-young-kids'), tags('friends', 'high-adventure')]) {
      expect(bookableTier(h, t)).toBe(2);
    }
  });
});

describe('bookableTier — curated locals', () => {
  it('accepts the three curated boat and jeep trips', () => {
    for (const id of ['antilla-wreck-dive', 'boca-catalina-snorkel', 'natural-pool-jeep']) {
      expect(bookableTier(local({ id, cost: '$60 pp' }), tags('couple'))).toBe(1);
    }
  });

  it('rejects the park gate, the optional guide and the Flamingo pass', () => {
    expect(bookableTier(local({ id: 'arikok-hiking', cost: '$11 entry' }), tags('couple'))).toBe(null);
    expect(bookableTier(local({ id: 'oranjestad-walking', cost: '$25 guided' }), tags('couple'))).toBe(null);
    expect(bookableTier(local({ id: 'flamingo-renaissance', cost: '$125 day pass' }), tags('treat-yourself'))).toBe(null);
  });

  it('rejects restaurants, which are meals rather than outings', () => {
    expect(bookableTier(local({ id: 'gasparito-restaurant', category: 'Food', cost: '$35–60 pp' }), tags('couple'))).toBe(null);
  });
});

describe('isBookable', () => {
  it('agrees with bookableTier on presence', () => {
    expect(isBookable(SAIL, tags('couple'))).toBe(true);
    expect(isBookable(ESCOOTER, tags('couple'))).toBe(false);
  });
});

describe('bookingDays', () => {
  // Verified against a reference implementation run over all 14 lengths while
  // the spec was written. If you change the formula, regenerate this table
  // rather than editing rows to match.
  const EXPECTED: Record<number, number[]> = {
    1: [1], 2: [2], 3: [2], 4: [3], 5: [2, 4], 6: [3, 5], 7: [2, 4, 6],
    8: [3, 5, 7], 9: [2, 4, 6, 8], 10: [3, 5, 7, 9], 11: [4, 6, 8, 10],
    12: [3, 5, 7, 9, 11], 13: [4, 6, 8, 10, 12], 14: [3, 5, 7, 9, 11, 13],
  };

  it('matches the schedule table for every trip length', () => {
    for (const [n, days] of Object.entries(EXPECTED)) {
      expect(bookingDays(Number(n))).toEqual(days);
    }
  });

  it('never books the arrival or the departure day on a real trip', () => {
    for (let n = 3; n <= 14; n += 1) {
      const days = bookingDays(n);
      expect(days).not.toContain(1);
      expect(days).not.toContain(n);
    }
  });

  it('never books two days running', () => {
    for (let n = 1; n <= 14; n += 1) {
      const days = bookingDays(n);
      for (let i = 1; i < days.length; i += 1) expect(days[i] - days[i - 1]).toBeGreaterThan(1);
    }
  });

  it('caps at six however long the trip', () => {
    expect(bookingDays(14).length).toBe(6);
  });

  it('honours days a curated template has already claimed', () => {
    // The balanced template places a wreck snorkel on day 2 and a natural-pool
    // jeep on day 4, both by construction and both bookables. They are pinned
    // into the schedule and the rest fill latest-first.
    expect(bookingDays(10, [2, 4])).toEqual([2, 4, 7, 9]);
  });

  it('ignores a pinned day that is illegal or adjacent to another', () => {
    expect(bookingDays(10, [1])).toEqual([3, 5, 7, 9]);   // arrival day
    expect(bookingDays(10, [10])).toEqual([3, 5, 7, 9]);  // departure day
    // 5 is adjacent to 4, so it is skipped; the schedule still fills to its full count,
    // the same as when a pinned day is illegal — both are "cannot be honoured" cases
    expect(bookingDays(10, [4, 5])).toEqual([2, 4, 7, 9]);
  });
});
