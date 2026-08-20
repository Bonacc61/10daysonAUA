// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TripState } from '../lib/tripState';

/**
 * Every click that reaches `createShare` mints a PERMANENT row: the
 * `shared_itineraries` table has no delete policy, immutable by design. So the
 * things worth pinning here are not the happy path's wording but the two ways
 * this row could quietly litter production — minting a second snapshot of a plan
 * that has not changed, and minting one per impatient click.
 *
 * The clipboard branch matters for the opposite reason: it must never claim
 * "Copied ✓" when the write was refused, because the traveller would walk away
 * believing they had a link.
 */

const createShare = vi.fn<(t: TripState) => Promise<{ id: string | null; error: string | null }>>();
vi.mock('../lib/shares', () => ({ createShare: (t: TripState) => createShare(t) }));
const capture = vi.fn();
vi.mock('../lib/analytics', () => ({ capture: (...a: unknown[]) => capture(...a) }));

const { default: CopyLinkRow } = await import('./CopyLinkRow');

const TRIP = { answers: {}, plan: [], rejected: new Set(), rejectedGroups: new Set() } as unknown as TripState;

/** Clipboard that accepts, and one that refuses the way a locked-down browser does. */
const clipboard = (impl: () => Promise<void>) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(impl) }, configurable: true, writable: true,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  createShare.mockResolvedValue({ id: 'abc123', error: null });
  clipboard(() => Promise.resolve());
});

const click = () => fireEvent.click(screen.getByRole('button'));

describe('Copy link', () => {
  it('creates a link and copies it', async () => {
    render(<CopyLinkRow trip={TRIP} />);
    click();
    await waitFor(() => expect(screen.getByText('Copied ✓')).toBeTruthy());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/i/abc123`);
    expect(createShare).toHaveBeenCalledTimes(1);
  });

  it('reuses a link the caller already holds instead of minting a second one', async () => {
    // The whole reason `cachedUrl` exists: rows here are permanent.
    render(<CopyLinkRow trip={TRIP} cachedUrl="https://example.test/i/kept" />);
    click();
    await waitFor(() => expect(screen.getByText('Copied ✓')).toBeTruthy());
    expect(createShare).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.test/i/kept');
  });

  it('hands the fresh link back so the caller can cache it', async () => {
    const onUrl = vi.fn<(u: string) => void>();
    render(<CopyLinkRow trip={TRIP} onUrl={onUrl} />);
    click();
    await waitFor(() => expect(onUrl).toHaveBeenCalledWith(`${window.location.origin}/i/abc123`));
  });

  it('does not mint a second row on an impatient double click', async () => {
    let release!: (v: { id: string | null; error: string | null }) => void;
    createShare.mockReturnValue(new Promise((r) => { release = r; }));
    render(<CopyLinkRow trip={TRIP} />);
    click();
    expect(screen.getByText('Creating link…')).toBeTruthy();
    click();                                   // the button is disabled mid-flight
    release({ id: 'abc123', error: null });
    await waitFor(() => expect(screen.getByText('Copied ✓')).toBeTruthy());
    expect(createShare).toHaveBeenCalledTimes(1);
  });

  it('offers a selectable field rather than claiming success when the clipboard refuses', async () => {
    clipboard(() => Promise.reject(new Error('NotAllowedError')));
    render(<CopyLinkRow trip={TRIP} />);
    click();
    const field = await screen.findByLabelText('Itinerary link');
    expect((field as HTMLInputElement).value).toBe(`${window.location.origin}/i/abc123`);
    expect(screen.queryByText('Copied ✓')).toBeNull();
  });

  it('says so when the link cannot be created, instead of a silent no-op', async () => {
    createShare.mockResolvedValue({ id: null, error: 'boom' });
    render(<CopyLinkRow trip={TRIP} />);
    click();
    await waitFor(() => expect(screen.getByText(/Couldn't create a link/)).toBeTruthy());
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('does not run its close callback after being unmounted', async () => {
    // Copy on one row, switch menus inside the 1400ms hold: a surviving timer
    // would shut the menu the traveller had just opened.
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { unmount } = render(<CopyLinkRow trip={TRIP} cachedUrl="https://example.test/i/kept" onDone={onDone} />);
    click();
    await vi.advanceTimersByTimeAsync(0);      // let the clipboard promise settle
    unmount();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onDone).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
