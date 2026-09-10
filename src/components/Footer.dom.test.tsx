// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
