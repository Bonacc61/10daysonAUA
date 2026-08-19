import { describe, it, expect } from 'vitest';
import { bookLinkFor, localActivity } from './entryLinks';
import { ACTIVITIES } from './activities';
import type { Catalog } from './activitySource';
import type { MatchTag, SlotEntry, ViatorGroup, ViatorItem } from '../types';

const item = (over: Partial<ViatorItem> = {}): ViatorItem => ({
  id: 'sail-1', group_id: 'sailing-cruises', title: 'Catamaran Sunset Sail', image_url: '',
  price_usd: 90, duration: '2 hrs', rating: 4.7, review_count: 100,
  viator_item_url: 'https://www.viator.com/tours/Aruba/sail/d28-1?pid=P00302487&mcid=42383',
  is_best_seller: true, display_order: 0, sections: ['cruises-water'], adventure: 40, ...over,
});
const group = (): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'palm-beach', allowed_slots: [],
});
const CATALOG: Catalog = { activities: ACTIVITIES, groups: [group()], items: [item()] };
const TAGS = new Set<MatchTag>();
const act = (id: string): SlotEntry => ({ kind: 'activity', id });

/**
 * The Map's pin popup used to read `viator_item_url` off a curated activity
 * directly. Reported 2026-08-19: the Flamingo Beach Day Pass pin was not
 * clickable.
 *
 * It was never only Flamingo. NOT ONE curated activity carries a
 * `viator_item_url` — the first test below is the measurement, not a fixture —
 * so that expression returned null for EVERY local pick on the map and the
 * popup rendered an anchor with no href. Flamingo is simply the one that also
 * has somewhere to send you.
 */
describe('bookLinkFor — the Map pin book link', () => {
  it('no curated activity carries a viator_item_url, which is why the old rule linked nothing', () => {
    expect(ACTIVITIES.filter((a) => a.viator_item_url)).toHaveLength(0);
  });

  it('gives the Flamingo day pass the operator link, with no affiliate tag', () => {
    const link = bookLinkFor(act('flamingo-renaissance'), CATALOG, TAGS, 'morning');
    expect(link).not.toBeNull();
    expect(link!.url).toBe('https://renaissancearuba.idaypass.com/');
    expect(link!.affiliate).toBe(false);
    // The disclosure hangs off this flag — the popup says "book on Viator" only
    // when the click actually earns a commission.
    expect(link!.url).not.toContain('mcid');
  });

  it('leaves a free beach unlinked, because a book button to a public beach is a lie', () => {
    const free = ACTIVITIES.find((a) => a.cost === 'Free')!;
    expect(bookLinkFor(act(free.id), CATALOG, TAGS, 'afternoon')).toBeNull();
  });

  it('still gives a Viator group entry its affiliate link', () => {
    const link = bookLinkFor(
      { kind: 'group', groupId: 'sailing-cruises', bestSellerId: 'sail-1' } as SlotEntry,
      CATALOG, TAGS, 'evening',
    );
    expect(link!.affiliate).toBe(true);
    // The affiliate parameters must survive the rewrite — CLAUDE.md invariant.
    expect(link!.url).toContain('pid=P00302487');
    expect(link!.url).toContain('mcid=42383');
  });

  it('returns null for an id in neither the catalog nor the lunch spots', () => {
    expect(localActivity('no-such-activity', CATALOG)).toBeUndefined();
    expect(bookLinkFor(act('no-such-activity'), CATALOG, TAGS, 'morning')).toBeNull();
  });
});
