// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Activity } from '../data/activities';
import { DEFAULT_ANSWERS } from '../App';

/**
 * Explore's search box moved into a shared component on 2026-08-14 so My Aruba >
 * Personalized could draw the same one. Nothing rendered this page before that
 * refactor, which meant `tsc` was the only thing standing between a rewire and
 * a broken search on the busiest surface on the site. These tests close that.
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

const activity = (id: string, title: string, over: Partial<Activity> = {}): Activity => ({
  id, title, category: 'Beaches', image: '', description: '', localsSay: '', cost: 'Free',
  duration: '2 hrs', timeOfDay: 'Morning', fitReason: '', location: 'Eagle Beach',
  rating: 4.9, reviewCount: 10, adventure: 10, sections: ['beaches'], matched_by: [], ...over,
});

const CATALOG: Catalog = {
  groups: [group()],
  items: [
    // The boat's description mentions seasickness ON PURPOSE, so the query
    // below is a substring HIT on it. Without that the contraindication test
    // below cannot fail: "we get seasick" matches no fixture, so the boat
    // vanishes whether or not anything honours the flag.
    item('boat', 'Catamaran Sunset Sail', { description: 'Open water — bring a remedy if you get seasick.', kids: { min_age: 4, baby_ok: true } }),
    // Deliberately unlike the catamaran on every axis the sidebar filters read
    // (price, duration, Viator's private flag) AND on the two "Recommended"
    // reads (adventure, sections), so every control has something to separate.
    item('sub', 'Submarine Dive', { price_usd: 250, duration: '8 hrs', flags: ['PRIVATE_TOUR'], adventure: 90, sections: ['adventures-outdoor'], kids: { min_age: 16, baby_ok: false } }),
  ],
  activities: [activity('eagle', 'Eagle Beach Morning Session')],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({ semanticSearchEnabled: () => false, searchByMeaning: vi.fn() }));

const Explore = (await import('./Explore')).default;

const search = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search beaches, activities, food…'), { target: { value } });

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — search after the shared-component refactor', () => {
  it('lists the catalog with the box empty', () => {
    expect(screen.getByText('Catamaran Sunset Sail')).toBeInTheDocument();
    expect(screen.getByText('Eagle Beach Morning Session')).toBeInTheDocument();
  });

  it('filters on what was typed', () => {
    search('submarine');
    expect(screen.getByText('Submarine Dive')).toBeInTheDocument();
    expect(screen.queryByText('Catamaran Sunset Sail')).not.toBeInTheDocument();
  });

  it('still honours a typed contraindication', () => {
    // 'seasick' is BOTH a substring hit on the catamaran's description and a
    // no-boats contraindication. So the boat is in the results and then taken
    // out again — which is the only arrangement where this test can fail if the
    // contraindication layer is removed.
    search('seasick');
    expect(screen.queryByText('Catamaran Sunset Sail')).not.toBeInTheDocument();
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('clears back to the full catalog', () => {
    search('submarine');
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.getByText('Catamaran Sunset Sail')).toBeInTheDocument();
  });

  // Both Viator fixtures sit at 100 reviews — above the cutoff that used to
  // suppress the count — so this fails if brackets come back only on the thin
  // ones. The island activity renders no chip at all here: its rating did not
  // come from Viator, and `ActivityTile` shows a star only when it did.
  it('shows the review count on every Viator tile', () => {
    const counts = [...document.querySelectorAll('.a-rating')].map(n => n.textContent);
    expect(counts).toHaveLength(2);
    expect(counts.every(t => t?.includes('(100)'))).toBe(true);
  });
});

/**
 * The sidebar filters, exercised through the rendered page rather than through
 * `filterExploreEntries` — the predicates have their own unit tests, and what
 * these add is that the controls are wired to them at all.
 *
 * The fixture is three tiles: two Viator products (4.7★, 100 reviews) and one
 * hand-written local pick with an editorial 4.9 and no `ratingSource`. That
 * shape is the point — it is what makes "the rating bar keeps local picks but
 * the review bar drops them" a test that can fail.
 */
describe('Explore — the sidebar filters', () => {
  const pill = (name: string) => screen.getByRole('button', { name });
  const openMore = () => fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
  const titles = () => [...document.querySelectorAll('.a-card h3')].map((n) => n.textContent);

  it('the extra filters stay behind "More filters" until it is opened', () => {
    expect(screen.queryByLabelText('Duration')).not.toBeInTheDocument();
    openMore();
    expect(screen.getByLabelText('Duration')).toBeInTheDocument();
  });

  it('a rating bar drops the products under it and keeps the local pick', () => {
    fireEvent.click(pill('4.8★+'));
    expect(screen.queryByText('Catamaran Sunset Sail')).not.toBeInTheDocument();
    expect(screen.queryByText('Submarine Dive')).not.toBeInTheDocument();
    expect(screen.getByText('Eagle Beach Morning Session')).toBeInTheDocument();
  });

  it('a review bar drops the local pick, which has no crowd behind it', () => {
    openMore();
    fireEvent.click(pill('10+'));
    expect(screen.queryByText('Eagle Beach Morning Session')).not.toBeInTheDocument();
    expect(screen.getByText('Catamaran Sunset Sail')).toBeInTheDocument();
  });

  it('a duration band narrows to what runs that long', () => {
    openMore();
    fireEvent.click(pill('Full day'));
    expect(screen.getByText('Submarine Dive')).toBeInTheDocument();
    expect(screen.queryByText('Catamaran Sunset Sail')).not.toBeInTheDocument();
  });

  it('"Private tours only" keeps just what Viator itself flags as private', () => {
    openMore();
    fireEvent.click(screen.getByLabelText('Private tours only'));
    expect(titles()).toEqual(['Submarine Dive']);
  });

  it('"Local picks" shows the hand-written ones and nothing else', () => {
    openMore();
    fireEvent.click(pill('Local picks'));
    expect(titles()).toEqual(['Eagle Beach Morning Session']);
  });

  it('sorting by price reorders the grid, both ways', () => {
    const select = screen.getByLabelText('Sort results');
    fireEvent.change(select, { target: { value: 'price-asc' } });
    expect(titles()).toEqual(['Eagle Beach Morning Session', 'Catamaran Sunset Sail', 'Submarine Dive']);
    fireEvent.change(select, { target: { value: 'price-desc' } });
    expect(titles()).toEqual(['Submarine Dive', 'Catamaran Sunset Sail', 'Eagle Beach Morning Session']);
  });

  // The local pick has no `ratingSource`, so `ratingOf` reports it unrated and no
  // star chip is drawn for it — but the founders' vouch ranks it as 5.0/2, which
  // beats both 4.7 products. Front of the grid, still starless.
  it('sorting by rating puts the vouched local pick above lower-starred products', () => {
    fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'rating' } });
    expect(titles()[0]).toBe('Eagle Beach Morning Session');
    expect(document.querySelectorAll('.a-rating')).toHaveLength(2); // no chip on the pick
  });

  it('sorting by reviews drops the vouched pick below both 100-review products', () => {
    fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'reviews' } });
    expect(titles()[2]).toBe('Eagle Beach Morning Session');
  });

  it('a collapsed filter that empties the page says where it is hiding', () => {
    openMore();
    fireEvent.click(pill('500+'));
    expect(screen.getByText('No results found')).toBeInTheDocument();
    // Panel still open — the control is on screen, so claiming it is "hidden"
    // would be false. Only once it is collapsed does the note earn its place.
    expect(screen.queryByText(/hidden under/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Fewer filters/ }));
    expect(screen.getByText(/hidden under/)).toBeInTheDocument();
  });

  // The disclosure must precede what it reveals, or opening it inserts four
  // control groups above the focused button and tabbing onward skips them all.
  it('the More filters button sits before the controls it reveals', () => {
    const button = screen.getByRole('button', { name: /More filters/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    openMore();
    const panel = document.getElementById('explore-more-filters');
    expect(button).toHaveAttribute('aria-controls', 'explore-more-filters');
    expect(panel).toBeTruthy();
    expect(button.compareDocumentPosition(panel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('"Clear all filters" puts the whole catalog back', () => {
    fireEvent.click(pill('4.8★+'));
    expect(titles()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(titles()).toHaveLength(3);
  });
});

/**
 * "Recommended" is no longer a no-op — it blends review-weighted quality, the
 * curated template's character, and the questionnaire. These check the wiring:
 * that answers reach the ranking at all, and that an un-answered questionnaire
 * contributes nothing rather than ranking on a default nobody chose.
 */
describe('Explore — Recommended reads the questionnaire', () => {
  const titles = () => [...document.querySelectorAll('.a-card h3')].map((n) => n.textContent);

  // Compared against each OTHER rather than against position 0: the two products
  // are identically rated, so in a three-tile fixture the vouched local pick
  // takes the top slot on quality whatever the answers say. Their relative order
  // is what the questionnaire actually decides here.
  const order = (answers: object) => {
    document.body.innerHTML = '';
    render(<Explore setPage={() => {}} canSeeItinerary={false} answers={{ ...DEFAULT_ANSWERS, ...answers } as never} />);
    const t = titles();
    return { sub: t.indexOf('Submarine Dive'), boat: t.indexOf('Catamaran Sunset Sail') };
  };

  it('an adrenaline answer ranks the intense product above the calm one', () => {
    const { sub, boat } = order({ interests: ['Adventure & adrenaline'], adventureLevel: 95 });
    expect(sub).toBeLessThan(boat);
  });

  it('a chill answer reverses that order', () => {
    const { sub, boat } = order({ interests: ['Beach & chill'], adventureLevel: 5 });
    expect(boat).toBeLessThan(sub);
  });

  // An untouched questionnaire still yields `med-adventure`, because the slider's
  // midpoint is 50. Ranking on that would be a preference nobody expressed.
  it('an untouched questionnaire does not steer the page', () => {
    document.body.innerHTML = '';
    render(<Explore setPage={() => {}} canSeeItinerary={false}
      answers={{ ...DEFAULT_ANSWERS, adventureLevel: 95 }} />);
    const withSliderOnly = titles();
    document.body.innerHTML = '';
    render(<Explore setPage={() => {}} canSeeItinerary={false} answers={DEFAULT_ANSWERS} />);
    expect(titles()).toEqual(withSliderOnly);
  });
});

/**
 * "Good for kids" runs on searchPool's `kids` verdict, the same one the search
 * box uses. The fixture is deliberately one of each state the filter can meet:
 * the catamaran suits a 4-year-old (pass), the submarine is 16+ (fail), and the
 * local pick carries no kids judgement at all (unjudged) — which is the case
 * 128 of the 350 live entries are in.
 */
describe('Explore — the Good for kids filter', () => {
  const titles = () => [...document.querySelectorAll('.a-card h3')].map((n) => n.textContent);
  const openMore = () => fireEvent.click(screen.getByRole('button', { name: /More filters/ }));

  it('keeps what suits a child and drops what does not', () => {
    openMore();
    fireEvent.click(screen.getByLabelText('Good for kids'));
    expect(titles()).toEqual(['Catamaran Sunset Sail']);
  });

  it('says how many were hidden for lack of a judgement, not for failing one', () => {
    openMore();
    fireEvent.click(screen.getByLabelText('Good for kids'));
    // One unjudged entry (the local pick), and it must read as ONE. The 16+
    // submarine FAILED and is not counted — conflating the two would overstate
    // how little we know about the catalog.
    expect(screen.getByText(/1 activity we haven’t checked is hidden/)).toBeInTheDocument();
    expect(screen.queryByText(/1 activities/)).not.toBeInTheDocument();
  });

  // The predicate is `min_age <= 8` — the youngest age the activity TAKES, not a
  // promise that any child of 8 will be fine. The copy must not invert that.
  it('states the minimum age rather than promising the activity suits a child', () => {
    openMore();
    fireEvent.click(screen.getByLabelText('Good for kids'));
    expect(screen.getByText(/Minimum age 8 or under/)).toBeInTheDocument();
    expect(screen.queryByText(/Suits a child of 8 or under/)).not.toBeInTheDocument();
  });

  it('counts toward the More filters badge and clears with the rest', () => {
    openMore();
    fireEvent.click(screen.getByLabelText('Good for kids'));
    expect(screen.getByRole('button', { name: /Fewer filters/ })).toHaveTextContent('1 on');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(titles()).toHaveLength(3);
  });

  it('is off by default, so the page is unchanged until it is ticked', () => {
    openMore();
    expect(screen.getByLabelText('Good for kids')).not.toBeChecked();
    expect(titles()).toHaveLength(3);
  });
});
