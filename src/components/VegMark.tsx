/**
 * The menu "V" — a green disc with a V, the mark menus everywhere use for
 * vegetarian. Sits inline in a card's header band (`card-header-band` flex
 * row), same slot as Explore's "Local pick" tag.
 *
 * WHICH cards wear it is not this component's call: the call sites check
 * `hasVegetarianOptions(id)` (src/data/lunchspots.ts), a hand-verified
 * high-confidence list — see the evidence notes there before adding a spot.
 *
 * Cream "V" on the green disc — the generic light-on-green rendering menus and
 * delivery apps use, which is what makes the mark readable at a glance.
 * DELIBERATELY not the official European V-Label (yellow circle, V with a
 * leaf): that is the EVU's trademarked CERTIFICATION mark, and wearing it
 * would claim a certification these restaurants do not hold.
 *
 * Cream-on-green is ~2:1 contrast, the same WARN Stats.tsx records for green
 * marks — discharged the same way: the meaning is never colour-or-glyph-alone,
 * the accessible name and the title say "Vegetarian options" in words, and the
 * 2px ink border keeps the disc itself visible on the dark band.
 */
export default function VegMark() {
  return (
    <span
      role="img"
      aria-label="Vegetarian options"
      title="Vegetarian options on the menu"
      style={{
        flexShrink: 0, width: 20, height: 20, boxSizing: 'border-box',
        borderRadius: 999, background: 'var(--green)', color: 'var(--cream)',
        border: '2px solid var(--ink)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 800, lineHeight: 1,
      }}
    >V</span>
  );
}
