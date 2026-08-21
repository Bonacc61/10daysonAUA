// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import { DEFAULT_ANSWERS } from '../App';

/**
 * The badge — the dark strip across the top of an Explore card.
 *
 * 193 of 365 live products belong to more than one section, so something has to
 * pick the single word printed there. It used to be "the first section down the
 * tab row", and Cruises & Water is the leftmost tab, so one water tag beat four
 * adventure tags and a UTV tour was labelled a boat trip. Reported from the
 * live site 2026-08-21.
 *
 * The tags below are the real ones from that product: 12035 and 21421 are
 * off-road, 20255 is one of Viator's water tags. 20255 is not miscategorised —
 * 73 live products carry it and 53 are genuinely water — it simply also sits on
 * ten land tours, so the tie is real and has to be broken by something better
 * than column order.
 */

const group = (over: Partial<ViatorGroup> = {}): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'palm-beach',
  allowed_slots: [], ...over,
});

const item = (id: string, title: string, over: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id: 'sailing-cruises', title, image_url: '', price_usd: 90, duration: '2 hrs',
  rating: 4.7, review_count: 100, viator_item_url: '', is_best_seller: false, display_order: 0,
  sections: ['cruises-water'], adventure: 40, description: '', ...over,
});

const CATALOG: Catalog = {
  groups: [group()],
  items: [
    // The reported bug: a land tour Viator tags as both.
    item('utv', 'Aruba UTV Off-Road North Coast', {
      tags: [12035, 21421, 20255],
      sections: ['cruises-water', 'adventures-outdoor'],
      adventure: 80,
    }),
    // The guard: a fix that dragged real catamarans out of Cruises & Water would
    // be worse than the bug it fixed. Tag-majority voting did exactly that.
    item('cat', 'Catamaran Sunset Sail', {
      tags: [11888, 11885, 22046],
      sections: ['cruises-water'],
    }),
    // The reported bug INVERTED. Modelled on 367744P1 — "Half-Day Aruba
    // Sightseeing Tour & Beach in an Air-condition Bus", which the enrichment
    // snapshot guesses is a `snorkel` at medium confidence — but NOT a copy of
    // it: the real product carries tag 22046, so its sections put it in
    // Adventures & Outdoor either way, which would make a poor test of the rule.
    // This fixture strips it to the case that matters: tags that name no
    // activity, an enrichment guess that says water, and a section that says
    // otherwise. The badge must listen to the tags.
    item('bus', 'Half-Day Sightseeing Tour in an Air-conditioned Bus', {
      tags: [21725],
      sections: ['tours-sightseeing'],
      enriched_kind: 'snorkel',
    } as Partial<ViatorItem>),
  ],
  activities: [],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({ semanticSearchEnabled: () => false, searchByMeaning: vi.fn() }));

const Explore = (await import('./Explore')).default;

const badgeOf = (title: string) => {
  const card = screen.getByRole('button', { name: title }).closest('.explore-flip') as HTMLElement;
  return card.querySelector('.chb-title')?.textContent?.trim();
};
const tab = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('the badge on the All tab', () => {
  it('does not call a land tour a boat, even when Viator tags it as both', () => {
    // `matchingSection` reads the activity KIND before falling back to column
    // order. The engine has filed this correctly all along — itemFit.test pins a
    // jeep safari carrying a boat tag — and only the badge had never been told.
    expect(badgeOf('Aruba UTV Off-Road North Coast')).toBe('Adventures & Outdoor');
  });

  it('still calls an actual boat trip a boat trip', () => {
    expect(badgeOf('Catamaran Sunset Sail')).toBe('Cruises & Water');
  });

  it('does not let an enrichment guess call a bus a boat', () => {
    // `activityKind` falls back to the enrichment snapshot when Viator's tags
    // name no activity — right for the engine, which needs a kind for every
    // product and where a guess beats nothing. Wrong for a badge, which is a
    // claim made to a traveller's face. Blanking `enriched_kind` before asking
    // means the badge only ever overrides a tie the TAGS themselves settle;
    // anything else falls through to tab order exactly as it did before.
    expect(badgeOf('Half-Day Sightseeing Tour in an Air-conditioned Bus')).toBe('Tours & Sightseeing');
  });
});

describe('the badge inside a section tab', () => {
  it('names that tab, on every card', () => {
    // The homogeneity half. A card only ever appears in a tab it genuinely
    // belongs to, so naming the tab cannot lie — and no card in a row wears a
    // different word from its neighbours.
    tab('Cruises & Water');
    const badges = [...document.querySelectorAll('.chb-title')].map((el) => el.textContent?.trim());
    expect(badges.length).toBeGreaterThan(0);
    expect([...new Set(badges)]).toEqual(['Cruises & Water']);
  });

  it('so the same card reads differently in the two tabs it belongs to', () => {
    // The honest cost, asserted rather than left to be discovered. Both readings
    // are true; the UTV really is in both sections.
    tab('Adventures & Outdoor');
    expect(badgeOf('Aruba UTV Off-Road North Coast')).toBe('Adventures & Outdoor');
    tab('Cruises & Water');
    expect(badgeOf('Aruba UTV Off-Road North Coast')).toBe('Cruises & Water');
  });
});
