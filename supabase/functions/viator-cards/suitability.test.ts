import { describe, it, expect } from 'vitest';
import { suitabilityLines, ageSentence, suitabilityProfile, searchText } from './suitability';

describe('suitabilityLines — keeps what says who a product suits', () => {
  it('keeps the stroller line', () => {
    expect(suitabilityLines(['Infants and small children can ride in a pram or stroller']))
      .toEqual(['Infants and small children can ride in a pram or stroller']);
  });

  it('keeps wheelchair, fitness, service-animal and contraindication lines', () => {
    const input = [
      'Wheelchair accessible',
      'Suitable for all physical fitness levels',
      'Service animals allowed',
      'Not recommended for pregnant travelers',
    ];
    expect(suitabilityLines(input)).toEqual(input);
  });

  it('drops logistics noise that says nothing about suitability', () => {
    expect(suitabilityLines([
      'Public transportation options are available nearby',
      'Refunds will not be issued if tour / activity is missed due to late arrival',
      'Pick up time is between 45 minutes and 20 minutes prior to tour departure',
      'May be operated by a multi-lingual guide',
    ])).toEqual([]);
  });

  it('drops a drinking age, which is not a participation age', () => {
    // tools/probe-suitability.ts guards this deliberately; the composer must
    // agree with it, or "18 years old" lands in the corpus of a family boat
    // trip that merely serves rum.
    expect(suitabilityLines([
      'Minimum age to consume alcoholic drinks is 18 years old.',
      'Age restriction to drink 18+',
    ])).toEqual([]);
  });

  it('drops duplicates, keeping first appearance', () => {
    expect(suitabilityLines(['Wheelchair accessible', 'Wheelchair accessible']))
      .toEqual(['Wheelchair accessible']);
  });
});

describe('ageSentence — only when the age bands actually mean something', () => {
  it('reports the child floor when the operator prices for children', () => {
    expect(ageSentence([
      { ageBand: 'CHILD', startAge: 2 },
      { ageBand: 'ADULT', startAge: 12 },
    ])).toBe('Children welcome from age 2.');
  });

  it('says nothing for a single ADULT 0-99 band', () => {
    // The catalog's false friend: 67 of 328 products price this way and report a
    // minimum age of 0 while being adults-only in practice. Claiming "children
    // welcome from age 0" here is exactly how a UTV rental ends up ranked for
    // "good with a toddler".
    expect(ageSentence([{ ageBand: 'ADULT', startAge: 0 }])).toBe('');
  });

  it('reports an adults-only floor when there is no child band', () => {
    expect(ageSentence([{ ageBand: 'ADULT', startAge: 16 }, { ageBand: 'SENIOR', startAge: 65 }]))
      .toBe('Adults only, from age 16.');
  });

  it('says nothing when there are no bands at all', () => {
    expect(ageSentence([])).toBe('');
  });

  it('says nothing for a CHILD or INFANT band that starts at 0', () => {
    // The same billing artifact from the other side. Viator's default pricing
    // template is CHILD 0-17 / ADULT 18+, so a floor of 0 here is a pricing
    // default rather than a statement about toddlers — and "Children welcome
    // from age 0" is the strongest toddler phrase in the whole vocabulary.
    // Emitting it from a template put it on 58 of 327 profiles, including a
    // sip-and-paint evening with no other child signal at all.
    expect(ageSentence([{ ageBand: 'INFANT', startAge: 0 }, { ageBand: 'ADULT', startAge: 12 }])).toBe('');
    expect(ageSentence([{ ageBand: 'CHILD', startAge: 0 }, { ageBand: 'ADULT', startAge: 18 }])).toBe('');
  });

  it('still reports a child floor the operator actually chose', () => {
    expect(ageSentence([{ ageBand: 'CHILD', startAge: 3 }, { ageBand: 'ADULT', startAge: 12 }]))
      .toBe('Children welcome from age 3.');
  });
});

describe('suitabilityProfile — what the snapshot stores per product', () => {
  it('joins the kept lines and the age sentence into one string', () => {
    expect(suitabilityProfile(
      ['Wheelchair accessible', 'Public transportation options are available nearby'],
      [{ ageBand: 'CHILD', startAge: 3 }, { ageBand: 'ADULT', startAge: 12 }],
    )).toBe('Wheelchair accessible. Children welcome from age 3.');
  });

  it('is empty when a product says nothing useful', () => {
    expect(suitabilityProfile(['Refunds will not be issued'], [])).toBe('');
  });
});

describe('searchText — the text the search corpus embeds', () => {
  it('carries the title, the description and the profile', () => {
    const out = searchText('Semi-Submarine Cruise', 'See the reef without getting wet.', 'Children welcome from age 3.');
    expect(out).toContain('Semi-Submarine Cruise');
    expect(out).toContain('See the reef without getting wet.');
    expect(out).toContain('Children welcome from age 3.');
  });

  it('truncates the DESCRIPTION rather than the profile when over budget', () => {
    // The profile is the whole point of this text. Appending it last and then
    // slicing the result would cut precisely the part that makes a suitability
    // query answerable — silently, and only on the longest listings.
    const long = 'x'.repeat(4000);
    const out = searchText('T', long, 'Children welcome from age 3.', 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toContain('Children welcome from age 3.');
    expect(out).toContain('T');
  });

  it('omits the separator when a product has no profile', () => {
    expect(searchText('T', 'Desc.', '')).toBe('T. Desc.');
  });
});
