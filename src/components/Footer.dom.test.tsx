// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpaLink } from './Footer';

describe('SpaLink', () => {
  it('renders a real href a crawler can follow', () => {
    render(<SpaLink page="privacy" setPage={() => {}}>Privacy Policy</SpaLink>);
    expect(screen.getByRole('link', { name: 'Privacy Policy' }))
      .toHaveAttribute('href', '/privacy');
  });

  it('navigates in-app on a plain click, without a page load', async () => {
    const setPage = vi.fn();
    render(<SpaLink page="terms" setPage={setPage}>Terms</SpaLink>);
    await userEvent.click(screen.getByRole('link', { name: 'Terms' }));
    expect(setPage).toHaveBeenCalledWith('terms');
  });

  // A plain click must call preventDefault, or the anchor's real href takes
  // over and the browser does a full page load — the exact regression this
  // component exists to prevent. userEvent.click() does not surface whether
  // preventDefault was called (jsdom only logs "Not implemented: navigation
  // to another Document" either way), so this constructs the event directly
  // with createEvent and inspects it after dispatch.
  it('prevents the default navigation on a plain click', () => {
    const setPage = vi.fn();
    render(<SpaLink page="terms" setPage={setPage}>Terms</SpaLink>);
    const link = screen.getByRole('link', { name: 'Terms' });
    const ev = createEvent.click(link);
    fireEvent(link, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(setPage).toHaveBeenCalledWith('terms');
  });

  // The whole point of using an anchor: these gestures must reach the browser.
  //
  // userEvent.keyboard('{Meta>}') + userEvent.click() was tried first (per the
  // brief) but does not actually deliver metaKey: true on the resulting click
  // event in this project's installed @testing-library/user-event version —
  // verified empirically: it passed against a mutant with the modifier guard
  // deleted, i.e. it exercised nothing. fireEvent.click with an explicit
  // metaKey property sets the event property directly and does fail against
  // that mutant, so it's used here instead.
  it('lets the browser handle a modifier-click so open-in-new-tab works', () => {
    const setPage = vi.fn();
    render(<SpaLink page="terms" setPage={setPage}>Terms</SpaLink>);
    fireEvent.click(screen.getByRole('link', { name: 'Terms' }), { metaKey: true });
    expect(setPage).not.toHaveBeenCalled();
  });

  // Inverse of the preventDefault check above: on a modifier click, default
  // must NOT be prevented, or the browser never gets the chance to open the
  // new tab even though setPage was correctly skipped.
  it('does not prevent default on a modifier-click, so a new tab can open', () => {
    const setPage = vi.fn();
    render(<SpaLink page="terms" setPage={setPage}>Terms</SpaLink>);
    const link = screen.getByRole('link', { name: 'Terms' });
    const ev = createEvent.click(link, { metaKey: true });
    fireEvent(link, ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(setPage).not.toHaveBeenCalled();
  });
});
