// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { SavedTrip } from '../lib/trips';
import type { PageId } from '../App';

/**
 * Renders the Itineraries rows rather than reading their source.
 *
 * Deleting an itinerary used to be guarded by `window.confirm`, which the
 * BROWSER enforced: there was no way to reach the delete without answering it.
 * That guard is now ordinary JSX we own, reached from two different buttons
 * that share one piece of state — so the thing standing between a traveller and
 * a permanently destroyed itinerary is code that can regress silently.
 *
 * These assertions were all confirmed red first: against a version that called
 * `onDeleteTrip` directly from the icon, and against one where `confirmDelete`
 * was a boolean rather than the row, which made every row delete the first trip.
 */

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, session: null, loading: false }),
}));
vi.mock('../data/useCatalog', () => ({
  useCatalog: () => ({ catalog: { activities: [], groups: [], items: [] }, loading: false }),
}));
vi.mock('../lib/booked', () => ({
  useBooked: () => ({ booked: new Set<string>(), toggle: () => {} }),
}));

const { ItineraryPanel } = await import('./Dashboard');

const ANSWERS = {
  days: 10, groupType: '', budget: '', interests: [], adventureLevel: 50,
  startOffset: 7, lodging: '', flags: [], specialNotes: '',
};

const trip = (id: string, name: string | undefined, updatedAt: string): SavedTrip => ({
  id,
  updatedAt,
  answers: { ...ANSWERS, tripName: name },
  plan: [{ day: 1, title: 'Day 1', color: '#e8b04b', morning: [], afternoon: [], evening: [] }],
  rejected: new Set<string>(),
  rejectedGroups: new Set<string>(),
} as unknown as SavedTrip);

/** The confirmation card. Scoped because its confirm button and the row icons
 *  deliberately share the words "Delete itinerary". */
const prompt = () => within(document.querySelector('.login-modal-card') as HTMLElement);

const TRIPS = [
  trip('t1', 'Honeymoon week', '2026-08-18T12:00:00Z'),
  trip('t2', undefined,        '2026-08-17T12:00:00Z'),
];

let onDelete: ReturnType<typeof vi.fn<(id: string) => void>>;
let onOpen: ReturnType<typeof vi.fn<(id: string) => void>>;
let setPage: ReturnType<typeof vi.fn<(p: PageId) => void>>;

function show(trips: SavedTrip[] = TRIPS) {
  onDelete = vi.fn<(id: string) => void>();
  onOpen = vi.fn<(id: string) => void>();
  setPage = vi.fn<(p: PageId) => void>();
  return render(
    <ItineraryPanel
      setPage={setPage}
      trips={trips}
      onLogin={() => {}}
      onOpenTrip={onOpen}
      onDeleteTrip={onDelete}
      activeTripId="t1"
    />,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the itinerary row', () => {
  it('offers edit and delete without expanding first', () => {
    show();
    expect(screen.getAllByLabelText('Edit itinerary').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Delete itinerary').length).toBeGreaterThan(0);
  });

  it('names an unnamed itinerary by its date, so two can be told apart', () => {
    show();
    expect(screen.getByText('Honeymoon week')).toBeTruthy();
    expect(screen.getByText('Untitled itinerary · 08/17/26')).toBeTruthy();
  });

  it('edit opens THIS itinerary, not whichever was last touched', () => {
    show();
    // Second row — the one that is NOT activeTripId.
    fireEvent.click(screen.getAllByLabelText('Edit itinerary')[1]);
    expect(onOpen).toHaveBeenCalledWith('t2');
    expect(setPage).toHaveBeenCalledWith('itinerary');
  });
});

describe('deleting an itinerary', () => {
  it('does not delete on the first click — it asks', () => {
    show();
    fireEvent.click(screen.getAllByLabelText('Delete itinerary')[0]);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Are you sure you want to delete?')).toBeTruthy();
  });

  it('names the itinerary it is about to destroy', () => {
    show();
    fireEvent.click(screen.getAllByLabelText('Delete itinerary')[1]);
    // The second row is the untitled one; the prompt must carry ITS label, not
    // the first row's — the bug a boolean `confirmDelete` would have caused.
    expect(prompt().getByText(/Untitled itinerary · 08\/17\/26/)).toBeTruthy();
  });

  it('deletes the row it was opened from, once confirmed', () => {
    show();
    fireEvent.click(screen.getAllByLabelText('Delete itinerary')[1]);
    fireEvent.click(prompt().getByRole('button', { name: 'Delete itinerary' }));
    expect(onDelete).toHaveBeenCalledWith('t2');
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('Cancel destroys nothing and closes the prompt', () => {
    show();
    fireEvent.click(screen.getAllByLabelText('Delete itinerary')[0]);
    fireEvent.click(prompt().getByText('Cancel'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Are you sure you want to delete?')).toBeNull();
  });
});
