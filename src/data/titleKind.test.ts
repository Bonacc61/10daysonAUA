import { describe, it, expect } from 'vitest';
import { titleKind, KIND_VOCABULARY } from './itemFit';

/**
 * The title layer as a PRIMITIVE. It is not wired into activityKind — see the
 * note there and ROADMAP item 13 — because kind drives group membership via
 * regroupItems, not just deduplication. These tests pin the parser so the
 * decision to wire it can be made without re-deriving it.
 */
describe('titleKind', () => {
  const t = (title: string) => titleKind({ title });

  it('reads the kinds the Viator tags missed', () => {
    // Every one of these sat in a generic `sec:` bucket on the live catalog.
    expect(t('Aruba 2-Tank guided Dive for certified divers')).toBe('dive');
    expect(t('Night Shore Diving Mangel Halto Aruba')).toBe('dive');
    expect(t('Aruba PADI Scuba Diving Program')).toBe('dive');
    expect(t("Aruba's Northern Coast Horseback Adventure")).toBe('horseback');
    expect(t('Kids Parasailing Experience Aruba')).toBe('parasail');
    expect(t('Fortunata Half Day Private Sailing')).toBe('sail');
    expect(t('Private Boat Cruise with Snorkeling')).toBe('snorkel');
    expect(t('Aruba UTV Rental | Explore the Island')).toBe('offroad');
  });

  it('catches a horseback tour mis-filed under water', () => {
    // 14261P1 sat in sec:cruises-water on the live catalog.
    expect(t('Horseback Ride Tour to Natural Pool in Arikok National Park')).toBe('horseback');
  });

  it('resolves a two-activity title to the one that defines the outing', () => {
    // A sail with snorkelling on it, not a snorkel trip that happens to float.
    expect(t('VIP Morning Delight Champagne Sailing and Snorkeling with Lunch')).toBe('sail');
  });

  it('never invents a kind outside the vocabulary', () => {
    // Every kind carries an adrenaline value the contraindication caps read, so
    // a thirteenth kind is a decision about who gets excluded from a plan.
    for (const title of ['Aruba Downtown Historic and Cultural Walking Tour',
                         'Discovery Papiamento Distillery', 'Aruba Private Tours on a ac bus',
                         'Rum and Chocolate Sensory Journey']) {
      const k = t(title);
      expect(k === '' || KIND_VOCABULARY.has(k)).toBe(true);
    }
  });

  it('says nothing rather than guessing', () => {
    expect(t('Aruba Downtown Historic and Cultural Walking Tour')).toBe('');
    expect(t('Aruba Mural Food and Culture Tour')).toBe('');
    expect(t('')).toBe('');
  });

  it('does not fire on a place name that merely contains a kind word', () => {
    // Word boundaries are the whole defence: Aruba has a Surfside Beach, and a
    // beach picnic filed as a watersport would inherit surf's adrenaline score.
    expect(t('Surfside Beach Picnic')).toBe('');
    expect(t('Divi Beach Day')).toBe('');
  });
});
