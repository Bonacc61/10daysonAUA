# Itinerary geography — before/after the coordinate change

Measured 2026-08-03, against `refactor(coords): the registry is the only
coordinate source` (845ec98). Baseline is `pre-engine-geo-change` (3594bff).

Method: `npm run trace -- --persona <p>` for all five personas in
`tools/itinerary-trace.ts`, before and after, diffing the slot lines.

## Results

| Persona | Slots | Changed | Empty slots before → after |
|---|---:|---:|---|
| default | 21 | 6 | 4 → 4 |
| foodie | 21 | 7 | 2 → 2 |
| adventurer | 21 | 4 | 3 → 3 |
| **splurge** | 21 | 9 | **2 → 3** |
| family | 21 | 1 | 10 → 10 |

Most changes are reordering: Kitesurfing and the Downtown Walking Tour swap
days, California Lighthouse gives way to California Dunes at Sunset.

## The one regression, and why it is not a reason to revert

Splurge loses an afternoon to `blocked-by-overrun` — the day exceeded its time
cap. The chain: the coordinate change altered which morning activity scored
best (De Palm Island Day Pass instead of a private beach-hop), and that pick
runs long enough to push the day past `DAY_CAP_MIN`.

The **time overrun** is the defect, and it predates this work. From
`docs/ROADMAP.md`:

> The en-route food post-pass has no time accounting. It appends a second
> afternoon card after the day loop, outside `feasible`, so a day can exceed the
> 8h daytime cap: measured on the live catalog, 52 of 558 days run past 12h.

Reverting the coordinates would not fix that. It would re-hide it behind a
different pick until some other change surfaced it again.

## What improved

The engine previously read six invented category centroids for ~340 catalog
items, which made it wrong in both directions — see
`docs/matching-engine/geography.md`. Two concrete corrections:

- A Conchi jeep tour and a Palm Beach ATV both sat at the Arikok gate and scored
  0.00 distance from each other while being 15km apart. They now cost 4.51.
- Every cruise sat on one west-coast point, so a Baby Beach morning gave any boat
  trip a 9.37 penalty — burying even a southern departure ten minutes away.

## Caveat: coverage is 53%

89 of 168 plannable items carry a registry coordinate. The other 79 are
geographically neutral (penalty 0, placeable anywhere) until reviewed. Raising
coverage should tighten day clustering further; this diff should be re-run once
it does.
