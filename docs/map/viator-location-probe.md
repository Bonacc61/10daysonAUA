# Viator location data — probe findings

**Date:** 2026-08-03
**Probe:** temporary `op=locations` on the `viator-cards` edge function
**Sample:** 20 live Aruba product codes (the jeep/UTV and bus tours listed in the
old `VIATOR_ITEM_COORDS`), fetched via `/products/{code}` with refs resolved
through `/locations/bulk`.

## Verdicts

> **`viator-poi` is a usable source tier: NO.**
> **`departure` (pickup) data is usable: LARGELY NO — 3 of 24 refs carry coordinates, and those are hotels.**

## What was tested

For each product: `itinerary.items[].pointOfInterestLocation.location.ref`
(where the tour goes) and `logistics.start[].location.ref` (where you are
collected), then every collected ref resolved via `/locations/bulk`.

## Result 1 — there is no destination data. At all.

| Metric | Batch 1 | Batch 2 | Total |
|---|---|---|---|
| Products probed | 10 | 10 | **20** |
| With ≥1 itinerary POI | 0 | 0 | **0** |
| With ≥1 `logistics.start` ref | 8 | 6 | **14** |

Every one of the 20 products returned `itineraryType: "STANDARD"` and an empty
`itinerary.items` POI list. Not sparse — **zero**, across jeep safaris, UTV
tours, hiking tours and open-bus sightseeing tours.

The assumption in the design spec that Viator would tell us where a tour goes is
**wrong**. `pointOfInterestLocation` is presumably populated for `ITINERARY`-type
products; nothing in the Aruba catalog sample is one.

## Result 2 — the meeting-point data is mostly unusable

24 distinct refs were collected across both batches. Resolved:

| Kind | Count | Coordinates? | Notes |
|---|---|---|---|
| TripAdvisor hotel records | ~7 | **Yes** | Playa Linda Beach Resort, Coconut Inn, JOIA Aruba, "Apartment With Pool" |
| Google place refs | ~14 | **No** | Only `providerReference` (a Google Place ID, e.g. `ChIJHbhCgI47hY4RIHy1LJ-5uB8`). No name, no `center`. |
| Not places at all | 2 | No | `"I will contact the supplier later"`, `"I will meet at the departure point"` — booking-flow options stored as locations |

Three problems, any one of which would sink it:

1. **Only ~29% carry coordinates.** The Google-provider refs return an opaque
   Place ID and nothing else. Resolving them means calling the Google Places API
   — a different vendor, a separate key, per-call cost, and its own privacy
   review. Out of scope.
2. **The ones that do resolve are hotels, not departure points.** "Playa Linda
   Beach Resort" is one stop on a hotel pickup round, not where the tour departs.
   Rendering it as *the* pickup would be actively misleading — precisely the
   class of confident-but-wrong claim this project exists to remove.
3. **Two refs are UI options, not locations.** Anything consuming this data
   blindly would render "I will contact the supplier later" as a place.

## Consequences for the design

Update `docs/superpowers/specs/2026-08-03-map-pin-accuracy-design.md`:

- **Delete the `viator-poi` source tier.** It does not exist.
- **Demote `departure`.** It cannot be sourced from Viator at usable quality. It
  survives only as a hand-curated value for products where a real departure point
  is known (a named marina or pier), researched the same way as any other pin.
- **Title/description matching against the place table is now the primary
  mechanism, not a fallback.** This is what the user proposed from the start —
  "look up the coordinates based on the title" — and the probe confirms there is
  no authoritative alternative.
- **The pickup block in the activity card loses its data source.** Its
  "Pickup unknown → omit the block entirely" branch becomes the overwhelmingly
  common case. See the open question below.

The good news: this *removes* work. No ingest enrichment, no `product_locations`
cache table, no per-refresh API cost, and the probe was the only Viator API work
in the plan.

## Open question for the product owner

The pickup block was an explicit requirement. Viator cannot supply the data.
Three options:

1. **Drop the pickup block.** Least work, honest, loses a genuinely useful piece
   of traveller information.
2. **Curate pickup only where it is known** — the ~29 editorial activities and
   any Viator product whose departure point is a named, checkable place. The
   block renders for a minority of cards and is omitted elsewhere.
3. **Add Google Places resolution** for the ~14 opaque refs. New vendor, new key,
   per-call cost, GDPR review, and it still yields hotel pickup rounds rather
   than departure points. Not recommended.

## Reproducing

The temporary `op=locations` branch is still deployed on `viator-cards`
(`index.ts`, immediately before the cache read). Read-only, requires the anon key
like every other op. Remove it once the registry research is complete — see
Task 10, Step 6 of `docs/superpowers/plans/2026-08-03-map-pin-accuracy.md`.

```bash
FN=$(grep '^VITE_VIATOR_FN_URL=' .env.production | cut -d= -f2-)
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env.production | cut -d= -f2-)
curl -s "$FN?op=locations&codes=6841POOL,6841P7" -H "Authorization: Bearer $KEY"
```

## Incidental finding

`deno check supabase/functions/viator-cards/index.ts` reports a **pre-existing**
type error, unrelated to this work:

```
TS2345 embeddings.ts:41 — sort comparator typed { index?: number }
       but the array elements are { embedding: number[] }
```

It does not break at runtime (Deno Deploy strips types without checking), but it
means `deno check` cannot currently be used as a clean pre-deploy gate. Worth
fixing separately.
