// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Privacy from './Privacy';
import { NO_ANALYTICS_KEY } from '../lib/beacon';

/**
 * The GDPR Article 21 control, rendered.
 *
 * This is not a nicety: the visitor beacon runs on legitimate interest, and
 * legitimate interest without a working right to object has no lawful basis. So
 * the control shipping and working is a condition of the beacon shipping at all
 * — which is why it is tested by RENDERING rather than by reading the source.
 *
 * The disclosure assertions matter for the same reason. The project rule is that
 * any new collection needs its basis written into the Privacy Policy; a test
 * that the words are on the page is the cheapest way to stop the beacon and its
 * disclosure drifting apart.
 */
describe('Privacy — the right to object to visit counting', () => {
  beforeEach(() => localStorage.clear());
  const show = () => render(<Privacy setPage={() => {}} />);

  it('discloses the counting, its purpose and its basis', () => {
    show();
    expect(screen.getByText(/Counting visitors/i)).toBeTruthy();
    expect(screen.getByText(/Nothing is stored on your device for this/i)).toBeTruthy();
    // The basis has to be nameable, not implied.
    expect(document.body.textContent).toMatch(/Legitimate interest/i);
    // And the daily-only property, because it is the figure someone will quote.
    expect(document.body.textContent).toMatch(/different, unconnected\s+visitor/i);
  });

  it('starts unticked and writes nothing until asked', () => {
    show();
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(localStorage.getItem(NO_ANALYTICS_KEY)).toBeNull();
  });

  it('records the objection when ticked', () => {
    show();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(localStorage.getItem(NO_ANALYTICS_KEY)).toBe('true');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(document.body.textContent).toMatch(/You are not being counted/i);
  });

  it('REMOVES the key when unticked rather than writing "false"', () => {
    // Changing your mind should leave nothing behind on the device — a stored
    // 'false' is a preference we were never asked to keep.
    show();
    const box = screen.getByRole('checkbox');
    fireEvent.click(box);
    fireEvent.click(box);
    expect(localStorage.getItem(NO_ANALYTICS_KEY)).toBeNull();
  });

  it('reflects an objection already made on this device', () => {
    localStorage.setItem(NO_ANALYTICS_KEY, 'true');
    show();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});
