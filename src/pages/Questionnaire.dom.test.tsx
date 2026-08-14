// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Questionnaire from './Questionnaire';
import { DEFAULT_ANSWERS, type Answers } from '../App';

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

function show(step: number, over: Partial<Answers> = {}) {
  return render(
    <Questionnaire
      setPage={noop}
      answers={{ ...DEFAULT_ANSWERS, groupType: 'Couple', budget: 'Mid-range', interests: ['Beach & chill'], ...over }}
      setAnswers={noop}
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
