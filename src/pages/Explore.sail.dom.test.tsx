// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Activity } from '../data/activities';
import { DEFAULT_ANSWERS } from '../App';

/**
 * The Sail filter and its pill row, rendered.
 *
 * `sailPass` is unit-tested in data/exploreItems.test.ts. What only a render can
 * answer is here: that the pills toggle rather than replace each other, that
 * times widen while what is on board narrows, and that nothing can be left
 * pressed once sailing is switched off.
 *
 * The ids are real ones from src/data/startTimes.json, so the time pills are
 * exercised against the same snapshot production ships:
 *   245504 -> 09:00        245508 -> 17:30        102406P4 -> 09:00, 13:00
 * Tag 11888 is Viator's "sailing", one of the four activityKind reads as a sail.
 */

const group = (): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'palm-beach', allowed_slots: [],
});

const item = (id: string, title: string, over: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id: 'sailing-cruises', title, image_url: '', price_usd: 110, duration: '3 hrs',
  rating: 4.8, review_count: 300, viator_item_url: '', is_best_seller: false, display_order: 0,
  sections: ['cruises-water'], adventure: 40, description: '', tags: [11888], ...over,
});

const CATALOG: Catalog = {
  groups: [group()],
  items: [
    item('245504', 'Morning Snorkel Sail', { description: 'Snorkelling stops and a light brunch on board.' }),
    item('245508', 'Aruba Sunset Sail', { description: 'Open bar as the sun goes down.' }),
    item('102406P4', 'Half Day Private Sailing', { description: 'Two departures, cocktails included.' }),
    // Not a sail: carries no sailing tag, and says every on-board word anyway,
    // so a facet matching on text alone would wrongly keep it.
    item('offroad', 'Aruba Jeep Safari', { tags: [], sections: ['adventures-outdoor'], description: 'Lunch, open bar and snorkelling at the pool.' }),
  ],
  // Two curated entries, and the pair is the point.
  //
  // The first carries the REAL tag array of the live "Catamaran Sail & Snorkel
  // at Boca Catalina" — [11888, 11912] — and is NOT a sail: KIND_BY_TAG tests
  // snorkel (11912) before the sail row, so activityKind answers 'snorkel'.
  // Measured on the actual record, after an earlier fixture here used a
  // sail-only [11888] that exists nowhere in production and made the tests
  // agree with a claim the data does not support.
  //
  // The second is sail-tagged only. No curated pick looks like this today; it
  // exists so the activity branch of isSail is exercised by something rather
  // than being dead code nothing can fail on.
  activities: [
    { id: 'boca-catalina-snorkel', title: 'Catamaran Sail & Snorkel at Boca Catalina', category: 'Watersports',
      image: '', description: 'Catamaran drops anchor at Boca Catalina.', localsSay: '', cost: '$65 pp',
      duration: '2-3 hrs', timeOfDay: 'Morning', fitReason: '', location: 'Boca Catalina',
      rating: 4.7, reviewCount: 1245, adventure: 32, sections: ['cruises-water'], tags: [11888, 11912], matched_by: [] },
    { id: 'sunset-schooner', title: 'Curated Sunset Schooner', category: 'Watersports',
      image: '', description: 'A hand-picked evening sail.', localsSay: '', cost: '$70 pp',
      duration: '2 hrs', timeOfDay: 'Evening', fitReason: '', location: 'Oranjestad',
      rating: 4.8, reviewCount: 90, adventure: 30, sections: ['cruises-water'], tags: [11888], matched_by: [] },
    { id: 'eagle-beach', title: 'Eagle Beach Morning', category: 'Beaches', image: '', description: 'White sand.',
      localsSay: '', cost: 'Free', duration: '2 hrs', timeOfDay: 'Morning', fitReason: '', location: 'Eagle Beach',
      rating: 4.9, reviewCount: 10, adventure: 8, sections: ['beaches'], matched_by: [] },
  ],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({ semanticSearchEnabled: () => false, searchByMeaning: vi.fn() }));

const Explore = (await import('./Explore')).default;

const openMore = () => fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
const titles = () => [...document.querySelectorAll('.a-card h3')].map((n) => n.textContent).sort();
const sailToggle = () => screen.getByLabelText('Sail') as HTMLInputElement;
// One row, no visible heading — the checkbox above names the filter. `when` and
// `onboard` are the same row; the names say which half of the rule is in play.
const pill = (name: string) =>
  [...screen.getByRole('group', { name: 'Sail options' }).querySelectorAll('button')]
    .find((b) => b.textContent === name)!;
const when = pill;
const onboard = pill;

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — the sail filter', () => {
  it('keeps the checkbox and both rows behind "More filters"', () => {
    expect(screen.queryByLabelText('Sail')).not.toBeInTheDocument();
    openMore();
    expect(sailToggle()).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sail options' })).toBeInTheDocument();
  });

  // The owner's actual request, and nothing else guarded it: the two new
  // filters are named by their checkbox, not by a heading of their own. Five
  // headings for two controls is what this replaced.
  it('adds no heading of its own to the panel', () => {
    openMore();
    const headings = [...document.getElementById('explore-more-filters')!.querySelectorAll('h4')]
      .map((h) => h.textContent);
    expect(headings).toEqual(['Duration', 'Show']);
  });

  it('the pills are dead until sailing is on', () => {
    openMore();
    for (const p of ['Morning', 'Afternoon', 'Sunset']) expect(when(p)).toBeDisabled();
    for (const p of ['Food', 'Cocktails', 'Snorkelling']) expect(onboard(p)).toBeDisabled();
  });

  it('narrows to sails, and the jeep does not sneak in on its words', () => {
    openMore();
    expect(titles()).toHaveLength(7);
    fireEvent.click(sailToggle());
    expect(titles()).toEqual([
      'Aruba Sunset Sail', 'Curated Sunset Schooner',
      'Half Day Private Sailing', 'Morning Snorkel Sail',
    ]);
  });

  // The one the tag order decides. Its array is the real one, and snorkel is
  // tested first, so the "Catamaran Sail" in its own name does not make it one.
  it('a curated pick tagged snorkel-first is not a sail', () => {
    openMore();
    fireEvent.click(sailToggle());
    expect(titles()).not.toContain('Catamaran Sail & Snorkel at Boca Catalina');
  });

  // A curated pick has no Viator schedule — its id is a slug — so without its
  // hand-written timeOfDay it would answer to no time facet and vanish the
  // moment one was pressed.
  it('a curated sail keeps its place under a time pill', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Sunset'));
    expect(titles()).toContain('Curated Sunset Schooner');
    fireEvent.click(when('Sunset'));
    fireEvent.click(when('Morning'));
    expect(titles()).not.toContain('Curated Sunset Schooner');
  });

  it('keeps curated picks that are sails', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click([...screen.getByRole('group', { name: 'Show' }).querySelectorAll('button')]
      .find((b) => b.textContent === 'Local picks')!);
    expect(titles()).toEqual(['Curated Sunset Schooner']);
  });

  // The pills are toggles, not a radio group: a second click adds rather than
  // replaces, which is the whole difference from the vehicle row.
  it('holds more than one pill at once', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Morning'));
    fireEvent.click(when('Sunset'));
    expect(when('Morning')).toHaveAttribute('aria-pressed', 'true');
    expect(when('Sunset')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(when('Morning'));
    expect(when('Morning')).toHaveAttribute('aria-pressed', 'false');
  });

  // ANDing three times would ask for a sail that leaves at two of them and
  // return nothing; ORing returns both, which is what a traveller means.
  it('times widen each other', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Morning'));
    expect(titles()).toEqual(['Half Day Private Sailing', 'Morning Snorkel Sail']);
    fireEvent.click(when('Sunset'));
    expect(titles()).toEqual(['Aruba Sunset Sail', 'Curated Sunset Schooner', 'Half Day Private Sailing', 'Morning Snorkel Sail']);
  });

  it('what is on board narrows, across the rows and within them', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Morning'));
    fireEvent.click(when('Sunset'));
    fireEvent.click(onboard('Snorkelling'));
    expect(titles()).toEqual(['Morning Snorkel Sail']);
    fireEvent.click(onboard('Cocktails'));
    expect(titles()).toEqual([]);
  });

  it('switching sailing off drops the pills with it', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Sunset'));
    expect(titles()).toEqual(['Aruba Sunset Sail', 'Curated Sunset Schooner']);
    fireEvent.click(sailToggle());
    expect(titles()).toHaveLength(7);
    fireEvent.click(sailToggle());
    expect(when('Sunset')).toHaveAttribute('aria-pressed', 'false');
    expect(titles()).toHaveLength(4);
  });

  it('counts as one filter in the badge, however many pills are on', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Sunset'));
    fireEvent.click(onboard('Cocktails'));
    expect(screen.getByRole('button', { name: /Fewer filters/ })).toHaveTextContent('1 on');
  });

  it('"Clear all filters" switches sailing back off', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Sunset'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(titles()).toHaveLength(7);
    expect(when('Sunset')).toBeDisabled();
  });
});
