// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Questionnaire from './Questionnaire';
import { DEFAULT_ANSWERS, type Answers } from '../App';
import { trackMilestoneOnce } from '../lib/beacon';

vi.mock('../lib/beacon', () => ({ trackMilestoneOnce: vi.fn() }));

/**
 * Renders the questionnaire rather than reading its source.
 *
 * The controls this guards were removed because they did NOTHING — `birthday`
 * and `work-trip` had no reader outside this file, and Q7 (lodging) reached the
 * engine only through the RNG seed. A grep over the component would have passed
 * against a version that still drew them from a stale constant; a render will
 * not.
 */

const noop = () => {};

function show(step: number, over: Partial<Answers> = {}, setAnswers: (a: Answers) => void = noop) {
  return render(
    <Questionnaire
      setPage={noop}
      answers={{ ...DEFAULT_ANSWERS, groupType: 'Couple', budget: 'Mid-range', interests: ['Beach & chill'], ...over }}
      setAnswers={setAnswers}
      onComplete={noop}
      initialStep={step}
    />,
  );
}

describe('Questionnaire — the controls that were removed', () => {
  it('runs to seven steps, not eight', () => {
    show(1);
    expect(screen.getByText('1/7')).toBeInTheDocument();
  });

  it('never asks where the traveller is staying', () => {
    // Q7 is parked for v2: the render branch and LODGING_OPTS still exist, so
    // only a render can tell you the question is actually gone from the flow.
    for (let step = 1; step <= 7; step += 1) {
      const { unmount } = show(step);
      expect(screen.getByText(`${step}/7`)).toBeInTheDocument();
      expect(screen.queryByText('Where are you staying?')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('offers no Birthday or Work trip pill on the last step', () => {
    show(7);
    expect(screen.getByText('Anything we should know?')).toBeInTheDocument();
    expect(screen.getByText('Honeymoon / anniversary')).toBeInTheDocument();
    expect(screen.queryByText('Birthday')).not.toBeInTheDocument();
    expect(screen.queryByText('Work trip')).not.toBeInTheDocument();
  });
});

describe('Step 7 (q8) — a flag group with nothing under it', () => {
  // "Celebrating something?" holds only `honeymoon`, and flagAppliesTo() keeps
  // that couples-only. Every other group type was therefore shown the heading
  // above an empty row. Asserting on the heading rather than the pill is the
  // point: the pill was already correctly absent.
  it('drops the "Celebrating something?" heading for a group it cannot offer', () => {
    show(7, { groupType: 'Solo' });
    expect(screen.getByText('Anything we should know?')).toBeInTheDocument();
    expect(screen.queryByText('Celebrating something?')).not.toBeInTheDocument();
    expect(screen.queryByText('Honeymoon / anniversary')).not.toBeInTheDocument();
  });

  it('still shows it to a couple, who have a pill to tick', () => {
    show(7, { groupType: 'Couple' });
    expect(screen.getByText('Celebrating something?')).toBeInTheDocument();
    expect(screen.getByText('Honeymoon / anniversary')).toBeInTheDocument();
  });

  it('keeps the groups that apply to everyone', () => {
    show(7, { groupType: 'Solo' });
    expect(screen.getByText('Prefer to skip')).toBeInTheDocument();
    expect(screen.getByText('Good to know')).toBeInTheDocument();
  });
});

describe('Q6 — arriving further out than the slider reaches', () => {
  // The slider tops out at 30 days, so before the date field there was no way to
  // say "we come in February". Fake timers pin today, or the offsets below drift
  // with the calendar.
  const TODAY = new Date(2026, 7, 19); // 19 Aug 2026, local

  function withFixedToday(fn: () => void) {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    try { fn(); } finally { vi.useRealTimers(); }
  }

  it('turns a date months away into the right startOffset', () => {
    withFixedToday(() => {
      let saved: Answers | null = null;
      show(6, {}, (a) => { saved = a; });
      fireEvent.change(screen.getByLabelText('Coming later in the year?'), { target: { value: '2027-02-14' } });
      expect(saved).not.toBeNull();
      // 19 Aug 2026 → 14 Feb 2027 is 179 days.
      expect(saved!.startOffset).toBe(179);
    });
  });

  it('offers a whole year of arrival dates, not just the slider month', () => {
    withFixedToday(() => {
      show(6);
      const field = screen.getByLabelText('Coming later in the year?');
      expect(field).toHaveAttribute('min', '2026-08-19');
      expect(field).toHaveAttribute('max', '2027-08-19');
    });
  });

  // The regression this guards: the slider's max used to be derived from the
  // value it renders (`Math.max(30, value)`), which fed the control its own
  // output. Dragging the thumb from day 179 to mid-track reports 90, the track
  // re-renders as 0-90, the thumb snaps back under the cursor at 100%, and the
  // next mousemove reports ~45. One leftward drag collapsed a February arrival
  // to the 30-day floor. Driven through real state, because a controlled
  // component is the only place the loop closes.
  it('survives a drag without collapsing the answer', () => {
    withFixedToday(() => {
      function Harness() {
        const [a, setA] = useState<Answers>({ ...DEFAULT_ANSWERS, groupType: 'Couple', budget: 'Mid-range', interests: ['Beach & chill'], startOffset: 179 });
        return <Questionnaire setPage={noop} answers={a} setAnswers={setA} onComplete={noop} initialStep={6} />;
      }
      render(<Harness />);
      const slider = () => screen.getByLabelText('When you start') as HTMLInputElement;

      // Three successive drags to the middle of the track. Each one should halve
      // the answer once, not compound against a shrinking track.
      expect(slider().max).toBe('179');
      fireEvent.change(slider(), { target: { value: '90' } });
      expect(slider().value).toBe('90');
      expect(slider().max).toBe('179');
      fireEvent.change(slider(), { target: { value: '45' } });
      expect(slider().value).toBe('45');
      expect(slider().max).toBe('179');
      // And the far end of the track still reads the date it was widened to.
      expect(screen.getByText('Feb 14')).toBeInTheDocument();
    });
  });

  it('widens the track when the date field reaches past it', () => {
    withFixedToday(() => {
      function Harness() {
        const [a, setA] = useState<Answers>({ ...DEFAULT_ANSWERS, groupType: 'Couple', budget: 'Mid-range', interests: ['Beach & chill'] });
        return <Questionnaire setPage={noop} answers={a} setAnswers={setA} onComplete={noop} initialStep={6} />;
      }
      render(<Harness />);
      expect((screen.getByLabelText('When you start') as HTMLInputElement).max).toBe('30');
      fireEvent.change(screen.getByLabelText('Coming later in the year?'), { target: { value: '2027-02-14' } });
      expect((screen.getByLabelText('When you start') as HTMLInputElement).max).toBe('179');
      expect((screen.getByLabelText('When you start') as HTMLInputElement).value).toBe('179');

      // ...and re-tightens when they change their mind to a nearer date, rather
      // than leaving a September trip crammed into the left 7% of a 179-day track.
      fireEvent.change(screen.getByLabelText('Coming later in the year?'), { target: { value: '2026-09-01' } });
      expect((screen.getByLabelText('When you start') as HTMLInputElement).max).toBe('30');
      expect((screen.getByLabelText('When you start') as HTMLInputElement).value).toBe('13');
    });
  });

  it('shows a far-out date rather than pinning the slider at 30', () => {
    withFixedToday(() => {
      show(6, { startOffset: 179 });
      // Twice: once as the headline, once as the slider's end tick — the slider
      // now spans today → the chosen date, so its far end IS that date.
      expect(screen.getAllByText('Feb 14')).toHaveLength(2);
      expect(screen.getByText(/179 days from now/)).toBeInTheDocument();
      const slider = screen.getByLabelText('When you start');
      expect(slider).toHaveAttribute('max', '179');
    });
  });
});

/**
 * Drop-off milestones. The dashboard's bounce-per-question card is fed by a
 * q_reached_N milestone fired on ARRIVING at question N — so someone who
 * opens question 4 and leaves counts as stopping there, whether or not they
 * touched it. Step 1 fires nothing: opening the page is already the pageview,
 * and the landing CTA enters at step 2 anyway.
 */
describe('Questionnaire — where travellers stop', () => {
  it('marks arrival at the entry step, from step 2 on', () => {
    vi.mocked(trackMilestoneOnce).mockClear();
    show(2);
    expect(trackMilestoneOnce).toHaveBeenCalledWith('q_reached_2');
  });

  it('marks each question Continue advances to', () => {
    vi.mocked(trackMilestoneOnce).mockClear();
    show(2);
    fireEvent.click(screen.getByText('Continue'));
    expect(trackMilestoneOnce).toHaveBeenCalledWith('q_reached_3');
  });

  it('marks nothing on question 1', () => {
    vi.mocked(trackMilestoneOnce).mockClear();
    show(1);
    const reached = vi.mocked(trackMilestoneOnce).mock.calls.filter(([m]) => m.startsWith('q_reached_'));
    expect(reached).toEqual([]);
  });
});
