import { describe, it, expect } from 'vitest';
import { entryExcludedByFlags, type ExploreEntry } from './exploreItems';
import { flagsFromNotes } from './notesFlags';
import type { ViatorItem, Section } from '../types';
import type { Activity } from './activities';

const itemEntry = (over: Partial<ViatorItem> = {}, adventure = 45): ExploreEntry => ({
  kind: 'item', category: 'Watersports', adventure, sections: ['cruises-water'],
  item: {
    id: 'i', group_id: 'sailing-cruises', title: 'Catamaran Sunset Sail',
    image_url: '', price_usd: 90, duration: '', rating: 4.7, review_count: 100,
    viator_item_url: '', is_best_seller: false, display_order: 0,
    sections: ['cruises-water'] as Section[], ...over,
  },
});

const activityEntry = (over: Partial<Activity> = {}, adventure = 10): ExploreEntry => ({
  kind: 'activity', category: 'Beaches', adventure, sections: ['beaches'],
  activity: {
    id: 'a', title: 'Eagle Beach', category: 'Beaches', image: '', description: '',
    localsSay: '', cost: 'Free', duration: '', timeOfDay: 'Morning', fitReason: '',
    location: '', rating: 4.9, reviewCount: 10, sections: ['beaches'], matched_by: [], ...over,
  },
});

describe('typed contraindications reach search', () => {
  it('"we get seasick" excludes the boats it would otherwise rank first', () => {
    // The golden set's worst case: 0/3 by similarity alone, because the sentence
    // embeds next to the very thing it rules out.
    const flags = new Set(flagsFromNotes('we get seasick'));
    expect(flags.has('no-boats')).toBe(true);
    expect(entryExcludedByFlags(itemEntry(), flags)).toBe(true);
    expect(entryExcludedByFlags(activityEntry({ sections: ['cruises-water'] }), flags)).toBe(true);
  });

  it('leaves the dry activities alone', () => {
    const flags = new Set(flagsFromNotes('we get seasick'));
    expect(entryExcludedByFlags(activityEntry(), flags)).toBe(false);
  });

  it('excludes drives when the traveller says they have no car', () => {
    const flags = new Set(flagsFromNotes('we have no rental car'));
    expect(flags.has('no-car')).toBe(true);
    expect(entryExcludedByFlags(activityEntry({ requires_car: true }), flags)).toBe(true);
    expect(entryExcludedByFlags(activityEntry(), flags)).toBe(false);
  });

  it('applies the same adventure ceiling a ticked pill would', () => {
    // mobility caps at 30 via the shared FLAG_ADVENTURE_CAP table, so typing the
    // words and ticking the pill cannot give different answers.
    const flags = new Set(flagsFromNotes('wheelchair access needed'));
    expect(flags.has('mobility')).toBe(true);
    expect(entryExcludedByFlags(itemEntry({}, 55), flags)).toBe(true);
    expect(entryExcludedByFlags(activityEntry({}, 10), flags)).toBe(false);
  });

  it('does nothing at all for an ordinary query', () => {
    // The common case must be untouched — no exclusions, no behaviour change.
    const flags = new Set(flagsFromNotes('snorkel with turtles'));
    expect(flags.size).toBe(0);
    expect(entryExcludedByFlags(itemEntry(), flags)).toBe(false);
  });

  it('does not fire on a place name that merely contains a trigger word', () => {
    // "Baby Beach" must not read as with-baby; the parser's word boundaries are
    // what stop that, and this pins the behaviour search now depends on.
    expect(flagsFromNotes('baby beach snorkeling')).toEqual([]);
  });
});
