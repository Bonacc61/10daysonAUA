# How geography moves the itinerary engine

Companion to `development-log.md`. Explains the one geographic rule in
`itineraryGenerator.ts`, why the coordinates feeding it were wrong, and what
changes when they are corrected.

Written 2026-08-03, alongside the pin-accuracy work
(`docs/superpowers/specs/2026-08-03-map-pin-accuracy-design.md`).

## The rule

`itineraryGenerator.ts:581-588`:

```ts
const NEAR_KM = 6;
const GEO_PENALTY_PER_KM = 0.5;
function geoPenalty(e: CardEntry, anchorCoord: Coord | undefined): number {
  if (!anchorCoord) return 0;
  const c = entryCoord(e);
  if (!c) return 0;
  return Math.max(0, distanceKm(anchorCoord, c) - NEAR_KM) * GEO_PENALTY_PER_KM;
}
```

In words: the first activity of the day that has a location becomes that day's
**anchor** (`:1290`, `:1335`, `:1381`). Every later candidate that day is
penalised by **(distance from anchor − 6 km) × 0.5**.

Calibration that matters: `BAND = 1` is the width of the band the engine treats
as interchangeable and shuffles for variety. So **8 km from the anchor costs a
full band** — decisive, not a tiebreak. Within 6 km there is no penalty at all,
which is what preserves local variety.

**An activity with no coordinate gets a penalty of zero.** It is geographically
neutral and placeable anywhere. This matters more than it looks — see
"The one genuinely bad outcome" below.

The rule is sound. The problem was what fed it.

## Why the old coordinates broke it

Before this work, `coordForEntry` fell through to `GROUP_COORDS` — six invented
points, one per Viator category — for roughly 340 of ~361 catalog items.

Note the subtlety: `activitySource.ts` re-files every item by its real Viator
tags at ingest, so by the time the generator runs, the **categories are correct**.
That is not the bug. The bug is that **a category is not a place.** "Adventure
tours" happen at Conchi, at Palm Beach, and in the south. All of them received
the Arikok gate.

The rule then misfired in both directions.

### Wrongly permissive

Two activities sharing an invented point score zero distance from each other,
regardless of where they really are.

| Pair, both filed "adventure tours" | Engine saw | Reality |
|---|---|---|
| Conchi jeep tour + Palm Beach ATV | 0 km, penalty **0.00** | **15.0 km**, should cost **4.51** |

The engine placed both on one day believing it was a tight local day. The
traveller drives 15 km across the island between them.

### Wrongly restrictive

Anything far from a category's invented point was punished for a distance that
was not real. With a **Baby Beach** morning as the anchor:

| Candidate category | Distance the engine used | Penalty |
|---|---|---|
| Any off-road tour | 10.6 km | 2.32 |
| Any cruise | 24.7 km | **9.37** |
| Any sightseeing tour | 20.0 km | 7.01 |

A 9.37 penalty buries a candidate outright. So after a Baby Beach morning the
engine would essentially never offer a boat trip — **including one departing
from the south, ten minutes away.** It was not rejecting that cruise for where
the cruise is. It was rejecting it for where its category's imaginary point is.

## What changes with real coordinates

1. **Days that looked tight but were not get corrected.** The Conchi + Palm
   Beach pairing starts costing 4.51 and loses to something genuinely near Conchi.
2. **Wrongly buried options return.** A southern boat trip becomes available
   after a southern morning.
3. **En-route lunch changes.** `pickEnRouteStop` (`:1424`) picks food near the
   day's driving route. Fed invented coordinates it was solving for a drive the
   traveller was not taking.

Every individual decision becomes more correct, because each is now based on
where things actually are.

## The one genuinely bad outcome

Because a coordinate-less activity is neutral (penalty 0, placeable anywhere),
deleting a coordinate without replacing it does not make the engine cautious —
it makes the activity **teleport**. It can land on any day, next to anything.

This is why `tools/audit-coords.ts` **hard-fails** when an activity that the
engine is allowed to auto-place has no confirmed coordinate. The failure mode is
silent by nature, so it needs a loud gate.

Coverage is therefore scoped to the *plannable pool* — everything passing
`isAutoFillExcluded` (`itemFit.ts:244`) and `MIN_CHAMPION_REVIEWS = 25`
(`itineraryGenerator.ts:130`) — rather than the whole catalog. Items outside
that pool never get suggested unasked, so a missing coordinate there costs
nothing but a map pin.

## Verifying the change rather than assuming it

More correct inputs do not automatically mean a trip the traveller prefers. Two
effects to watch:

- Loosening a wrongly-tight day makes it *look* more spread out on the map, even
  though the old version was equally spread out and merely lying about it.
- A day that genuinely degrades means a coordinate is missing, not that the rule
  is too strict.

The check is a before/after trace diff across all five
`tools/itinerary-trace.ts` personas (`docs/map/itinerary-geo-diff.md`). **The bar
is no day whose geographic clustering degraded.** If one has, find the missing
coordinate — do not soften `NEAR_KM` or `GEO_PENALTY_PER_KM`.

## Reference figures

Distances computed with the equirectangular approximation the codebase already
uses (`enRoute.ts`), at latitude 12.52.

| From | To | km | Penalty |
|---|---|---:|---:|
| Arikok gate (old "adventure" point) | Palm Beach | 15.0 | 4.51 |
| Arikok gate (old "adventure" point) | Natural Pool | 2.9 | 0.00 |
| Sailing centroid (old) | De Palm Island | 11.8 | 2.88 |
| Sailing centroid (old) | Baby Beach | 24.7 | 9.37 |
| Baby Beach | Palm Beach | 24.8 | 9.42 |
| Baby Beach | Natural Pool | 13.3 | 3.66 |
| California Lighthouse | Baby Beach | 28.9 | 11.43 |
