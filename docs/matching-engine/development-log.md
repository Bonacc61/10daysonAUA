# Matching Engine — Development Log

## Architecture overview

The matching engine lives in `src/data/itineraryGenerator.ts` and builds a
`Day[]` from questionnaire answers + catalog in a single deterministic pass.
Supporting modules:

| File | Role |
|---|---|
| `src/data/matcher.ts` | `matchPool` / `blendPools` — tag-based pool filtering |
| `src/data/itemFit.ts` | `fitItem` / `refaceForAnswers` / `isEveningItem` — per-item scoring + TOD |
| `src/data/answerTags.ts` | `answersToTags` — questionnaire → `MatchTag[]` |
| `src/data/activitySource.ts` | `getCatalog` — merges stub catalog with live Viator data |
| `src/data/activities.ts` | Stub local activities + `SAMPLE_ITINERARY` (Landing preview only) |
| `src/types.ts` | `ViatorGroup`, `ViatorItem`, `MatchTag`, `Slot`, `Section` |

### Pipeline (one call to `generatePlan`)

```
answersToTags(answers)
  → applyCatalogFlags(catalog, flags)     // no-boats / mobility / intense-hikes
  → isAutoFillExcluded + championsByExperience   // one well-reviewed champion per experience
  → pin pre-pass                          // claim slots for `opts.pinned` (see note)
  → balanced template pre-pass            // mid-slider personas only
  → premium splurge pre-pass              // money-no-object; runs BEFORE staples
  → staple pre-pass                       // stands down on a family the splurge took
  → day loop (d = 1 … nDays)
      for each slot (morning / afternoon / evening):
        candidatesFor(ctx, slot, tags)    // matchPool + blendPools + refaceForAnswers
        pickForSlot(ctx, slot, …)         // ranked fill ladder
        record pick → update ctx
      empty-day rescue                    // spends the open afternoon rather than render a blank day
  → en-route food post-pass               // appends a lunch stop; NOT time-budgeted
```

### Context (`Ctx`)

Accumulates trip-wide state across the day loop:

| Field | Purpose |
|---|---|
| `lastUsedDay` | item-id → day number; no id repeats, except a free local `Beaches` activity, which may return after `REVISITABLE_MIN_DAY_GAP` (2) clear days — unless the traveller pinned it |
| `pinnedIds` | ids the traveller pinned; exempt from the beach-revisit allowance, so a pinned pick is placed exactly once |
| `usedClusterIds` | embedding clusters placed; a hit is conclusive, a miss falls through |
| `usedTagSets` | tag arrays of placed items; trip-wide Jaccard at 0.35 |
| `dayTagSets` | tag arrays placed TODAY, reset per day; stricter Jaccard at 0.08 |
| `usedRouteFamilies` | route families retired trip-wide after one placement: `natural-pool`, `offroad`, `kayak`, and the sail families — which are LENGTH-DEPENDENT since 2026-08-12: collapsed to one `sail` below 8 days, split into `day-sail` + `evening-cruise` at 8+. See `tripRouteFamily`. |
| `lastFamilyDay` | family → last day used; enforces FAMILY_MIN_DAY_GAP (boat outings) |
| `usedGroupIds` | last-resort group dedup; only for items with neither tags nor a cluster |
| `dayFamilies` | families placed TODAY; hard cap of one boat outing per day |
| `day` / `nDays` | current day and trip length; day-level eligibility (Conchi avoids the first and last day on trips longer than 2 days) |
| `trace?` | opt-in diagnostic callback; undefined in the app |
| `groupById` | group lookup for per-item candidates |

**Note on pins:** the pre-pass and `opts.pinned` are intact and still covered by
tests, but **no caller passes them since 2026-08-05**. The shortlist used to be fed
in as pins, so anything saved in Explore was auto-placed. Saving now means "keep this
in mind" only — the traveller drops it into a slot from the empty-slot picker in
`Itinerary.tsx`. Treat the pin path as available, not live.

### Fill ladder (`pickForSlot`)

Four tiers, best → worst. Every tier is gated by `unused` (no id repeats, except a free local beach after a 2-day gap),
`notSimilar` (semantic dedup) and `feasible` — the day/evening time budget AND
the day shape (<=3 cards a day INCLUDING the meal, <=2 outings, <=1 meal, and a
full-day pass alone on its day); when
`maxPrice === 0` (the free-only arrival day) it returns before tiers 3-4. `kindOk` runs the whole ladder for
variety-introducing picks first, then relaxes for same-kind picks:

1. Affordable + on-theme
2. Affordable + widened (any slot)
3. Over-budget + on-theme
4. Over-budget + widened

When all tiers are exhausted the slot stays open ("Drop an activity here").

---

## Bug log

### 2026-07-06 — Submarine 5× duplicate (`usedGroupIds`)

**Symptom:** "Atlantis Submarine Tour" appeared on 5 consecutive days.

**Root cause:** The generator tracked used *item* IDs (`lastUsedDay`) but not
*group* IDs. The Atlantis group carries multiple booking-option items (adult,
child, 45-min, 65-min) with distinct product codes. Each day a different item
passed the dedup check — same real-world experience, five different IDs.

**Fix:** Added `usedGroupIds: Set<string>` to `Ctx`. Both paths in
`candidatesFor` filter `!ctx.usedGroupIds.has(g.id)`. When any item from a
group is placed, `ctx.usedGroupIds.add(group.id)`. Covered by the "fills
evening every day" test (rewritten to use 10 distinct groups × 1 item each).

---

### 2026-07-06 — Day 1 paid tours (`freeOnly`)

**Symptom:** Arrival day included full-price Viator tours.

**Root cause:** No arrival-day rule existed; the generator treated day 1 the
same as any other day.

**Fix:** `freeOnly = nDays > 1 && d === 1`; `maxP = freeOnly ? 0 : budgetLeft`.
Single-day trips are exempt. Pinned picks bypass the rule.

---

### 2026-07-06 — Wrong TOD slots in `SAMPLE_ITINERARY`

**Symptom:** "Dinner at Gasparito" appeared in the afternoon slot.

**Root cause:** The generator's TOD filtering (`matchPool`, `refaceForAnswers`)
is correct. The bug was in the hardcoded `SAMPLE_ITINERARY` array in
`activities.ts`, used only for the Landing page preview (days 1–2). Four
activities had wrong slot assignments:
- `natural-pool-jeep` (Morning) placed in afternoon
- `zeerovers` (Afternoon) placed in evening
- `baby-beach-snorkel` (Morning) placed in afternoon
- `kitesurfing-lesson` (Afternoon) placed in morning

**Fix:** Corrected all four slot assignments in `SAMPLE_ITINERARY`. Engine
logic untouched.

---

### 2026-07-08 — Cross-group semantic duplicates: tag Jaccard (initial fix)

**Symptom:** "Ultimate Island Jeep Safari with Natural Pool, Baby Beach &
Lunch" and "Aruba Natural Pool and Indian Cave Rugged Jeep Safari" suggested
on consecutive days.

**Root cause:** Two distinct Viator products (different codes, different
groups) representing the same real-world experience. `usedGroupIds` only
retires within a single group — it cannot detect cross-group semantic
duplicates.

**Why not title similarity?** Jaccard on title tokens is lexical: "Sunset
Sailing Cruise" and "Evening Catamaran Experience" score near zero despite
being the same outing. Viator's own tag IDs are a controlled vocabulary.

**Initial fix (shipped, now superseded as fallback):** `tagJaccard` on Viator
tag-ID arrays; `TAG_SIMILARITY_THRESHOLD = 0.35`. Catches obvious duplicates
but still has a ceiling: two products from different operators describing
identically-named tours can have divergent tag sets if Viator categorised them
differently.

---

### 2026-07-08 — Cross-group semantic duplicates: embedding clustering (primary fix)

**Why embeddings beat tag Jaccard:** Tag IDs are a controlled vocabulary but
inconsistently applied — Viator may tag two identical-experience products with
different leaf tags. Sentence embeddings encode *meaning*, not surface form, so
"Natural Pool Rugged Jeep Safari" and "Ultimate Island Jeep Safari with Natural
Pool" cluster together even with zero token or tag overlap.

**Architecture:** Embeddings are computed **at ingest time** inside the
`viator-cards` edge function, not at plan time. Only a cluster ID string ships
to the browser — no vectors in the client payload.

**`supabase/functions/viator-cards/embeddings.ts`** (new file):
- `activeProvider()` — checks env vars, returns `'openai' | 'voyage' | null`
- `embedBatch(texts)` — routes to the active provider
- `clusterByEmbedding(ids, embeddings, threshold)` — greedy O(n²) cosine
  clustering; items sorted by rating desc so the best product founds each
  cluster

**Provider router** (cheapest-first, no quality compromise for short texts):

| Priority | Provider | Model | Price | Dims |
|---|---|---|---|---|
| 1 | OpenAI | `text-embedding-3-small` | $0.02 / M tokens | 256 (reduced) |
| 2 | Voyage AI | `voyage-3-lite` | $0.02 / M tokens | 512 |

Set `OPENAI_API_KEY` **or** `VOYAGE_API_KEY` as a Supabase secret. If neither
is set the edge function logs a warning and items ship without cluster IDs —
the generator falls back to tag Jaccard automatically.

**Cost per ingest cycle (~400 items × ~50 tokens = ~20k tokens):**
≈ $0.0004 per sync. Cache TTL is 6 hours so worst-case cost is ~$0.002/day.
**Zero additional cost per user or per itinerary** — embeddings run once at
ingest, not once per plan.

**`experience_cluster_id` on `ViatorItem`:** assigned by the edge function;
items sharing an id are the same real-world experience. The cluster founder is
the highest-rated product in the cluster.

**Generator changes (`Ctx`):**
- `usedClusterIds: Set<string>` — retired when any cluster member is placed
- `notSimilar` predicate: checks `usedClusterIds` first (primary); falls back
  to tag Jaccard when `experience_cluster_id` is absent (no embedding run)

**Clustering threshold:** cosine similarity ≥ 0.88 → same experience.
Empirically, near-identical experiences score 0.92–0.98; clearly distinct
activities (hiking vs snorkelling) score < 0.70. Constant is named
`EMBEDDING_CLUSTER_THRESHOLD` in `index.ts` for easy tuning.

**Activation steps (one-time):**

1. Get an API key — either:
   - **OpenAI:** platform.openai.com → API keys → Create new secret key
   - **Voyage AI:** voyageai.com → sign up → API keys (Anthropic-backed, same price)

2. Set the secret in Supabase:
   ```bash
   supabase secrets set OPENAI_API_KEY=sk-...
   # or
   supabase secrets set VOYAGE_API_KEY=pa-...
   ```

3. Redeploy the edge function:
   ```bash
   SUPABASE_ACCESS_TOKEN=$(cat /root/.supabase_token) supabase functions deploy viator-cards
   ```

4. Verify it worked — the function logs:
   `[viator-cards] openai: 400 items → N experience clusters`
   Check Supabase dashboard → Edge Functions → viator-cards → Logs.

Until step 3 is done the function falls back silently to tag Jaccard dedup.
No frontend changes needed — cluster IDs flow through the existing catalog
response automatically.

**Tests:** `itineraryGenerator.test.ts`:
- "never places two items sharing an experience_cluster_id" — primary path
- "never places two Viator items with high tag overlap" — Jaccard fallback path

---

### 2026-08-05 — Repeat kayak outings, and a water park suggested to couples

**Symptom (reported):** a 7-day plan carried "Aruba Glass Bottom Kayak Tour
through the Mangrove Forest" on day 3 and "Kayak Tour at Mangel Halto and
Spanish Lagoon" on day 5 — the same lagoon twice. Separately, "Aruba De Palm
Island Day Pass" was being suggested to travellers who never said they had
children with them.

**Root cause (kayaks):** every dedup net had a reason to let the pair through.
The two products sit in different clusters (`70453P1` / `122173P1`); their tag
Jaccard is 0.31 against a `TAG_SIMILARITY_THRESHOLD` of 0.35; and `kayak` is
not in `BOAT_KINDS`, so the one-boat-per-day cap and the two-day boat gap never
looked at them. Measured on the live catalog, the beach+watersports couple
persona averaged **17 kayak picks across 6 seeds of a 7-day trip** — seed 0
alone placed three, including the "50%OFF Aruba's #1Clear Kayak
Experience@arubaphotoshootexperience" listing.

**Fix:** `routeFamilyOf` gained a `kayak` family, retired trip-wide after one
placement — the same mechanism as off-road. Detection is tag-kind OR title,
because neither alone is sufficient on live data: "Aruba Kayak Explorers" also
carries a snorkelling tag, which wins in `KIND_BY_TAG` and makes its kind
`snorkel`; "Sea Glass Island Aruba Tour" is tagged as kayaking with no kayak in
its title. Lowering the Jaccard threshold to 0.31 was rejected — it would have
thinned every other slot in the plan to catch one pair.

**Root cause (De Palm):** the product carries a snorkelling tag, so
`isCrowdPleaser` returns true, and at 370 reviews its popularity score is 0.86
— it out-scored the field for every persona. Nothing in the engine knew it was
a water park, because **Q2 group type had no effect on Viator picks at all**:
`classifyTags` only ever emits budget, interest and adventure-band tags, so
`solo` / `couple` / `family-young-kids` can never match an item in `fitItem`'s
interest loop. This is the first rule that reads group type.

**Fix:** `isKidsOriented` in `itemFit.ts` — Viator tag 12043 "Water Parks", plus
a title net for "day pass" / "water park" / "kids". Gated at auto-fill only, so
the product stays in Explore and a pinned one still places. Viator's 11919
"Kid-Friendly" tag was deliberately NOT used: it is on 2 of 337 live products
and one is the 1,584-review "Full-Day Aruba History and Must-See Landmarks
Tour". It marks "children welcome", not "this is for children".

Measured after, on the persona that placed De Palm in 6 of 6 seeds: 6/6 for
"Family with young kids" and "Family with teens", 0/6 for Solo, Couple, Friends
and Multi-gen (Multi-gen excluded by product decision, not by accident). Max
kayaks per trip is 1 for every group type, including 14-day plans.

**Cost, and what it exposed:** the `e2e-engine` intra-day spread guard went
10.1 -> 11.9 km and tripped its threshold of 11. It is not a coherence
regression. Splitting the metric by slot shows **daytime** spread barely moved
(2.15 -> 2.54 km, and not one day of 42 spreads past 15 km in either build);
the entire rise is the evening leg. Every sunset spot and dinner cruise on the
island is on the WEST coast, so any day spent on the south coast ends 15-24 km
from where it was — that is Aruba, not the engine. Retiring the repeat kayaks
(all launching near Palm Beach) simply moved more daytime south, so a
pre-existing evening mismatch now shows on more days. The old plans looked
tighter because they paddled the same lagoon up to three times.

The guard was therefore split in two: a tight daytime assertion (< 6 km, the
property the geo penalty actually controls) and a loose whole-day one (< 14 km).
Worth noting the old comment claimed "~7.9 km" while the live catalog had
already drifted to 10.1 unnoticed — the number in that comment is now stated
with the date it was measured.

---

### 2026-08-05 — One sail per trip, and a day pass that takes the day

**Symptom (reported):** "sailing / catamaran / jolly pirates — they're the same
activity, just different tour operators", appearing several times in one plan.
Separately, the De Palm Island Day Pass is a full-day activity and was not
being treated as one.

**Root cause (sails):** measured on the live catalog, a 14-day friends plan
carried "Premium Catamaran Afternoon Sail", "Aruba Sail and Snorkel with
Turtles" and "Morning Champagne and Lobster Sail". Their pairwise tag Jaccard is
**0.17-0.33** against a `TAG_SIMILARITY_THRESHOLD` of 0.35, and all three sit in
**different embedding clusters**. Clustering is not the answer here and cannot
be: it groups six other sails under `444239P2` (Jolly Pirate, Iconic Sail and
Snorkel, Half-Day Snorkel Sail, Antilla Snorkel Cruise…) and
`championsByExperience` already thins those to one — cross-cluster duplicates
are exactly the blind spot.

**Fix:** two more trip-wide route families. `day-sail` (kinds `sail` + `snorkel`)
and `evening-cruise` (any evening water outing, by `isWaterBased` — three live
evening products are neither sail nor snorkel kind). Split deliberately, so the
curated pairing survives: one daytime catamaran AND one sunset/dinner cruise per
trip, which is what the catamaran-sail and beach-dinner staples have always
placed.

Three things this needed beyond the family itself:

1. **The generic bucket.** `activityKind` falls back to the Explore section when
   the feed gives no defining tag, so 12 real snorkel sails — including the
   527-review "Antilla Shipwreck and Catalina Bay Snorkel Sail" — sat in
   `sec:cruises-water` and escaped. A title net now pulls them in, applied ONLY
   to that bucket so dives, jet skis, seabobs, submarines and a misfiled
   horseback ride keep their own kinds. Same trap the kayak family hit; kind
   alone is not enough on this feed.
2. **Pre-placed picks never consult dedup.** Pins, staples and the premium
   splurge are placed unconditionally, so a money-no-object traveller got the
   catamaran staple AND a "Luxury Private Yacht Charter" splurge. The premium
   pre-pass now skips a candidate whose route family is already claimed, and
   claims its own (a fortnight places two splurges).
3. **The day pass is not a boat.** De Palm carries Viator's snorkelling tag
   among 19 others, so `activityKind` calls it `snorkel` — it joined `day-sail`
   and the catamaran staple then retired it from *every* plan, including the
   family trips it exists for. `routeFamilyOf` now returns nothing for a
   full-day product. Caught only because the live check ran after the change;
   the unit tests were all green.

**Root cause (day pass):** it reports 6 hrs. The slot maths reads that as a long
morning that still leaves 120 minutes of afternoon. You take a ferry to a
private island — the day is spent.

**Fix:** `isFullDayProduct` floors these at `FULL_DAY_MIN` (420, the same number
`durationMinutes` gives the words "full day"), and the existing overrun rule
clears the rest of the day by itself. Note this changes nothing visible on
today's catalog: at 6 hrs the 8h cap already left only 60 minutes, and nothing
in the pool fits that. It was correct by accident, and the catalog has 30-minute
products. Title-matched on "day pass" rather than Viator's 11928 "Full-day
Tours" tag, which is on 20 products and is applied to "Aruba Half day Private
Jeep Tour" and to a 3-hour boat tour.

**Cost:** evening slots filled across five personas × 6 seeds went **246/288 ->
222/288**; total cards held (813 -> 811), the daytime absorbing it. The lost
evenings are pool exhaustion, not the new rule firing twice: traced on the
budget foodie, the open evening had all 10 evening candidates gone — 5 already
placed, 5 blocked by the 0.08 same-day threshold. This is the documented trade
(no-repeat beats a full evening), now costing about one evening per plan on
evening-thin personas. Worth revisiting if the evening pool stays this shallow.

Side effect, in the right direction: the intra-day spread guard fell from 11.9
back to **10.9 km** — one catamaran instead of three means fewer west-coast
marina departures pulling days apart.

**Superseded tests:** two fixtures encoded the old behaviour and were rewritten,
not deleted — "fills evening every day" used ten identical "Sunset Dinner Cruise
N" items (a pool of depth 1 under the new rule, so its titles are now distinct
experiences), and "places two different items from the SAME group" asserted that
a catamaran charter and a Jolly Pirates cruise are different experiences, which
is the exact claim this change overturns. That pair is now a sail and a jeep
safari — realistic, since the feed files 68 of 85 off-road products under
"Sailing & Cruises".

---

### 2026-08-05 — Day shape: two outings, one meal, and an Arikok day that stays free

**Symptom (reported):** "the 'Aruba Jolly Pirates Afternoon Sail' card is
suggested in the morning… and subsequently Boca Grandi and Zeerovers fish fry
are suggested, both on the other side of the island: too much for one day. Four
activities should not be recommended on 1 day." Plus: days with an Arikok
activity should have the afternoon free.

**Root cause (time of day):** `itemSlotOk` only ever distinguished evening from
daytime. 14 live products state a time of day in their own title, so the card
could contradict the name printed on it. Fixed with `titleTimeOfDay`, which
deliberately ignores "morning or afternoon" — one live UTV tour says both words
and a first-match rule would have read it as morning-only.

That alone did not fix it. The catamaran staple never goes through
`itemSlotOk`: `STAPLE_SPECS` names its own slots and `getPinSlotPrefs` places
pins and splurges. Both now narrow to the product's stated time of day. Live
mis-slotted cards: 8 -> 0 across five personas × 6 seeds.

**Root cause (day shape):** three slots plus an en-route food post-pass that
appends a fourth card with no accounting. 28 of 168 days carried four cards.

**Fix:** at most **two outings and one meal**, with a hard ceiling of three
cards. Meals are `category: 'Food'` (the two curated restaurants and every
lunchspot); a Viator dinner cruise is an outing, not a meal, by product
decision. Three things this needed:

1. **Pre-placed picks reserve their slot up front.** Pins, staples, splurges and
   template entries are placed unconditionally when their slot arrives, so the
   ladder has to count them BEFORE spending the budget — otherwise it filled
   morning and afternoon and the evening dinner-cruise staple landed as a third
   outing. Days with >2 paid outings: 11 -> 0.
2. **Free local beaches are exempt from the outing count.** Strict counting made
   a one-day trip come back as two free beach staples and nothing bookable at
   all. A beach is where to BE, not a thing you booked. The three-card ceiling
   is what stops that exemption stacking back up to four.
3. **The en-route post-pass honours the ceiling and the one-meal rule.** It runs
   after the day loop, outside the ladder, and was the fourth card in the
   reported day. It now skips days that are full or already have a meal — which
   costs it: en-route stops fell from ~33 to ~17 days. Which meal wins is
   placement order, since the evening ladder runs before the post-pass; a
   roadside stop is arguably the better card on a far-drive day.

**Root cause (Arikok):** the 8h "Island Jeep Safari" already cleared its
afternoon by overrunning its slot, but the 4h Natural Pool tours did not. The
reported day was worse than that, though: for a balanced traveller (mid-range +
med-adventure) the whole plan comes from `BALANCED_TEMPLATE`, which hand-placed
`arashi-beach` in day 4's afternoon next to `natural-pool-jeep` — a north-tip
beach after a south-east park run.

**Fix:** four places, because nothing in this engine has one door. `commit`
blocks the afternoon for the ladder; the template entry was removed; and the
staple and premium pre-passes check `freeArikokAfternoon` — the first two are
useless without the last, since a freed slot is immediately attractive to the
catamaran staple. Live: Arikok days with a non-food afternoon card 6 -> 0.

**Caught by the ship gate, second round.** Pinning a product to the slot its
title names made it *unplaceable* where that slot never comes free: on a 2-day
trip both afternoons are held open for arrival/departure, so 5 of 14
time-of-day products vanished when pinned — no card, no badge, an explicit
`10doa:starred` choice silently gone; 8 of 14 went the same way under
`no-early-mornings`. Pins now keep the other daytime slot as a fallback,
consulted only after the stated slot has failed on every day of the trip. The
auto-placed paths deliberately do NOT get that fallback (`strictTimeOfDay`):
a splurge simply moves to its next-best candidate, and a staple is skipped so
normal fill can pick a correctly-slotted sail — better than a card whose own
name disagrees with where it sits. The same round found staples and splurges
adding a third outing to a day the template had already filled (3 of 432 days,
all the balanced persona's day 2), which is why `fitsDayShape` exists rather
than the ladder-only check that shipped first.

**Net shape, five personas × 6 seeds (288 days):** cards/day now 1→16, 2→88,
3→184 and never 4 (was 3→84, 4→28). 744 cards against 813 before this whole
2026-08-05 series — an 8.5% thinner plan, which is the stated intent: a thin
itinerary of highly bookable picks beats a full one padded with near-duplicates.
Evening fill is unchanged from the sail rules at 222/288.

---

### 2026-08-05 — The splurge gets the yacht; party buses leave the catalog

**Symptom (reported):** "I don't think the splurge should be the same product:
users deliberately put the slider on splurge because they want to splurge,
therefore the yacht charter should be visible / in the itinerary if 'splurge' is
set."

**Root cause:** pre-pass ORDER. Staples ran before the premium splurge pass, so
the catamaran staple claimed the `day-sail` route family first and every yacht
charter was then skipped as a duplicate. The splurge fell through to the
next-best non-boat premium product — "Aruba Create Your Own Island Tour" — in
**90 of 90** money-no-object trips. Not a scoring problem: the yacht outscores
it comfortably. It simply never got to compete.

**Fix:** the premium pass now runs BEFORE the staples, and the staple pass skips
any route family the splurge has already taken. For a money-no-object traveller
the yacht IS the trip's sail, so the catamaran staple stands down rather than
making it two sailing days. Measured after: yacht in 90/90 trips, and a
fortnight still gets its second splurge (the island tour, 30 times). Non-splurge
personas are untouched — the premium pass only runs for money-no-object.

Two things this needed:
- The premium pass now registers its picks in `lastUsedDay` and `usedClusterIds`
  up front, the way the staple pass always has. The staple pass reads that set to
  know what is already spoken for; without it the catamaran staple would have
  re-placed the very yacht the splurge had just chosen.
- Both slot maps (`premiumSlots`, `stapleSlots`) had to be hoisted above both
  pre-passes, because the shared `fitsDayShape` / `freeArikokAfternoon` helpers
  close over them. Getting this wrong throws a temporal-dead-zone ReferenceError
  at runtime that `tsc` does not catch — it happened twice while making this
  change, once in each direction.

**Party buses (same session, separate ask):** "I also want the party buses to be
excluded from the viator activities shown on 10daysonaruba." Implemented as
`isPartyBus` in `activitySource.ts` and applied at ingest via
`isExcludedFromCatalog`, NOT as an `isAutoFillExcluded` rule — the ask is "do not
show these", which is a statement about what the site recommends at all, not
about how a product is surfaced. They therefore leave Explore, search, the swap
pool and every plan.

Nine live products go, including the 1,467-review "Aruba Nightlife Party Bus
Tour" — a deliberate choice to leave bookings on the table. The pattern is
narrow on purpose: "party bus" and pub/bar/club crawls, never the bare word
"bus", so Aruba's eight daytime sightseeing bus tours stay ("Best of Aruba by
Bus", 642 reviews, among them). Catalog 337 -> 328 items; evening fill barely
moved (222/288 -> 220/288), because the party buses were mostly losing their
slots to better-fitting picks anyway.

**Caught by the ship gate, third round.** Two regressions, both from this
session's own fixes. (1) Narrowing a staple to its product's stated time of day
with no fall-through repeated the round-2 pin bug on a curated staple: a
morning-titled catamaran has no valid day for a `no-early-mornings` traveller,
and `resolveStaples` picks ONE product, so the trip lost its only boat trip
rather than falling through to the afternoon sailing — a family 4-day plan had a
daytime sail in 1 of 6 seeds, against 6 of 6 at HEAD. `ResolvedStaple` now
carries `alternatives` and the pre-pass works down them. (2) Dropping party
buses took the last evening candidates with them and produced **72 completely
blank days** out of 3,024 — every departure day for a `no-early-mornings`
traveller, where the morning is flag-blocked and the afternoon is deliberately
held open. A day is allowed to be thin, never empty: the fill ladder was
extracted into a closure so an otherwise-empty day can spend its open afternoon
after all. Pacing is the right thing to give up to avoid rendering a page with
nothing on it.

**Caught by the ship gate, fourth round (verdict SHIP, one containment applied).**
The time-of-day rule had been folded into `itemSlotOk`, which the DISPLAY
chokepoint `resolveSlotEntry` also calls — so a stored card whose id fell out of
the slot-filtered pool was re-faced to a different product. Measured: ~5% of
Viator cards in existing plans, including already-SHARED itineraries, would have
quietly rendered as something else ("Premium Catamaran Afternoon Sail" stored in
a morning became "Aruba Atlantis Submarine Tour"). Split into
`itemSlotOkForFill`, used only where we CHOOSE what to suggest (the fill ladder
and the swap pool); `itemSlotOk` is back to being a statement about what would
be WRONG (an evening product in a morning, Conchi after the park shuts). The
lesson generalises: a preference must never reach the display chokepoint, or
changing our mind rewrites plans travellers have already been given. The 2 cards
that still re-face are over-budget products falling out on price — pre-existing,
documented self-healing.

Also from that round: three of the five trace-tool personas carried answer
strings the questionnaire cannot produce ('Water sports', 'Beaches & relaxation',
'Family with kids'), so `splurge` ran with no interest tag and `family` with no
family group type — meaning the family persona never exercised the kids-product
gate at all. Fixed in `tools/itinerary-trace.ts`. A trace persona that cannot
exist is worse than no persona: it reads as evidence.

---

### 2026-08-05 — The south-coast food stop outranks a Noord dinner

**Symptom (reported):** "Zeerover or O'Niels should always be suggested during a
south-coast day because those are about the only two decent / preferrable
options during a south-coast day — in Noord there's a plethora of options."

**Root cause:** placement order, nothing else. The evening ladder runs during the
day loop; the en-route food post-pass runs after the whole plan is built. With
one meal per day, whichever went first won — so a generic Noord restaurant beat
a roadside stop the traveller drives straight past. Nothing ever compared them.

**Fix, in two parts:**
1. The en-route stop now DISPLACES a restaurant the ladder placed, instead of
   standing down for it. The displaced dinner leaves an empty evening rather
   than being replaced: the day keeps two outings and one meal, and an empty
   slot is the honest thing to show when our own suggestion was the weaker one.
2. The day ceiling now counts NON-MEAL cards. It was counting raw cards, which
   blocked the stop on any day already holding three — including
   "Mangel Halto + Baby Beach + Sip and Paint", a day with only one outing on
   it. The meal was always specified as being "on the side", so counting it
   against the activity budget was the bug.

Measured across five personas x 6 seeds: south-coast days carrying Zeerover or
O'Neil's went **24% -> 59%**, and en-route stops 17 -> 36 days. Day shape holds:
0 days with >2 outings, 0 with 2 meals. Some days now show four cards, of which
one is a meal and at most two are outings — that is the "two activities with a
lunch or dinner on the side" shape, not a return to the four-activity day.

**Why not 100%:** the south coast has essentially two decent stops and the
trip-wide no-repeat rule offers each once. A fortnight with four south-coast
days therefore cannot cover them all. Letting a restaurant repeat after a gap
was tried and reached 73%, but it breaks the "nothing repeats except a free
beach" guarantee and fails four tests that guard it — a contract change that
needs a deliberate decision rather than being inferred from this one.

---

### 2026-08-05 — Retail leaves the catalog too

**Reported:** party buses and the Diamond Shopping card still visible in Explore.

Half of that was already fixed: `isPartyBus` had shipped and the live catalog
carried 0 party products. Anyone still seeing them is on a cached bundle — the
footer's `build <sha>` is the ground truth for what a browser is actually
running.

The Diamond Shopping card was real, and by design: `isAutoFillExcluded` means
"we won't suggest this unasked", NOT "you can't have it", so retail stayed in
Explore, in search and in the swap pool. That was a deliberate distinction and
it was the wrong one for retail — a diamond showroom is not an outing on any
surface. `isRetailProduct` moved to `isExcludedFromCatalog`, alongside
transport-only and party buses. Catalog 328 -> 327.

The pattern stays word-boundary anchored, which matters more than it looks:
**"Small-Group" contains "mall"**, and five live products are named that way.
`isAutoFillExcluded` keeps its retail branch as the guard for the offline stub
and for any future path that builds a catalog without going through
`loadCatalog`.

---

### 2026-08-12 — A day pass owned the daytime but not the evening

**Reported:** "Aruba De Palm Island Day Pass" came back with two other cards on
the same day. It is a day pass; it should be the only card.

The daytime half of this was fixed on 2026-08-05: `entryDurationMin` inflates a
day pass to `FULL_DAY_MIN` (420), which leaves 60 of the 480-minute daytime cap
and so blocks anything but a very short second product. That rule was working.

The evening was never covered, and could not be. `feasible` splits into two
independent budgets:

```
slot === 'evening'
  ? BUFFER + entryDurationMin(e) <= EVENING_CAP_MIN      // 240, ignores dayMin
  : dayMin + BUFFER + entryDurationMin(e) <= DAY_CAP_MIN // 480
```

The evening branch never consults `dayMin`, deliberately — that is what lets a
morning tour and a dinner cruise share a normal day. But it also means **no
amount of daytime duration can ever reach the evening**, so inflating the pass
to 420 minutes was structurally incapable of blocking an evening card. Time
accounting was the wrong instrument for this rule.

Measured on the live catalog before the fix, 5 personas x 6 seeds x 10 days:
**6 of 6 day-pass days carried an evening card** — always the family persona,
always day 4, always a local evening pick. 100% reproduction, not an edge case.

The existing regression test could not have caught it: it asserts
`[...morning, ...afternoon]` has length 1 and does not look at the evening. Its
fixture also had no evening-suitable product (`isEveningItem` reads the title,
and "Beach Walk 3" is never an evening candidate), so an evening assertion added
to it would have passed vacuously. Both are fixed — the fixture gains "Sunset
Stroll" fillers, and the test now asserts the whole day.

**Fix:** `isFullDayEntry` in `withinDayShape` (the ladder) and `fitsDayShape`
(the pre-passes), in both directions — nothing joins a day that has a pass, and
a pass never joins a day that has anything. Stated as a day-shape rule rather
than a time calculation, because it is one: a pass IS the day, which is a fact
about the product, not an arithmetic result.

Both gates are needed. The pre-pass gate is not redundant: a **shortlisted** day
pass arrives as a pin before the ladder runs, and a staple would otherwise be
placed beside it.

> **Correction, 2026-08-12 (review).** The sentence above is wrong about today.
> Nothing passes `opts.pinned` in production — the shortlist was unwired from it
> on 2026-08-05 (`Itinerary.tsx:57-59`, and the pin note under Context above).
> So `claimed` is empty in `fitsDayShape` on every live plan and neither
> pre-pass gate can fire; deleting both leaves the whole suite green. They are
> defensive against the shortlist being rewired, not load-bearing now. Two
> further gaps found in the same review and NOT fixed here: the third test
> (`is not placed on a day that already has something`) never constructs a day
> that already has something, so it dies to the same mutation as the second and
> the "reverse direction" is untested; and the balanced-template pre-pass
> bypasses both gates entirely (`templateAvail` checks the slot, not the day),
> which put a second card on the pass's day in 64 of 100 runs with the pin path
> re-enabled. **Close the template hole before rewiring the shortlist** — it
> reopens exactly the bug this entry closed.
>
> **All three are now closed.** The template hole has its own entry below. The
> reverse direction turned out to be reachable after all, but only through a day
> whose EVENING is reserved ahead — in the daytime the 420-minute inflation
> already blocks it, which is why no plain 10-day plan could ever exercise the
> gate. The test now pins two evening items on a 3-day trip and dies to the
> mutation; the gate is load-bearing, not redundant. Roadmap item 7b is closed
> and removed.

After: 6 of 6 -> **0 of 6** shared, with the pass still placed all 6 times — the
rule costs no placements. Open slots across 5 personas x 4 seeds unchanged at
131, so the displaced evening cards moved to other days rather than being lost.

---

### 2026-08-12 — One sail per trip, and the evening pool it was hiding

**Reported:** "I want you to offer only one catamaran trip per itinerary, as all
boat trips are the same trips (same routes)."

Not a bug — a reversal of the 2026-08-05 decision recorded above, which split
boats into two route families on the reasoning that "a sunset dinner cruise is a
different kind of evening from a daytime snorkel sail, and the two are the
curated staple pairing". The premise was wrong. Every operator runs the same
north-west route — Malmok, Boca Catalina, the Antilla wreck — so the second
outing sells the traveller the same water at a different hour. The stub
catalog's own copy says it out loud: "Antilla wreck, Boca Catalina" for the
private charter, "Catalina Bay and Malmok reef" for the lunch cruise.

Measured before the change, 5 personas x 6 seeds x 10 days:

| counting | plans with 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| sail/snorkel outings | 24 | 6 | – | – |
| every `BOAT_KINDS` outing | 9 | 9 | 7 | 5 |

All six two-sail plans were the identical shape: a daytime catamaran plus
"Aruba Celestial Sunset Cruise". The daytime cap was already working.

**Scope was the real decision.** The wide reading — one boat outing of any kind
— was rejected, and the reason is worth keeping: `sec:cruises-water` is Viator's
generic bucket and on the live catalog it contains "Best of Aruba by Bus",
"Horseback Ride Tour to Natural Pool", "Aruba Atlantis Submarine Tour" and "Kids
Parasailing Experience". A blanket one-boat rule would retire the submarine
after a catamaran. That reading needs the enrichment pass first.

**Fix:** three returns in `routeFamilyOf` — the `'day-sail'` and
`'evening-cruise'` labels both become `'sail'`. After: **30 of 30 plans carry
exactly one sail**, and the 4-boat plans are gone (max 3, all dives and Seabob,
which is intended).

Two tests asserted the old behaviour and were inverted, not deleted:
`'still allows a daytime sail AND an evening cruise'` and the splurge test
demanding a second `sailing-cruises` pick alongside the private charter.

**Two things the merge broke, both caught in review, both now covered by tests.**

*The evening arm was testing the wrong predicate.* It matched `isWaterBased`,
which is the **seasick filter** — deliberately over-broad, because a false
negative there is a medical problem. `WATER_KINDS` covers dive/jetski/sup/
parasail/surf and a title net adds "submarine" and "ferry". Broad is right for
"never show this to someone who gets seasick" and wrong for "which outings are
the same route". While the family was evening-only this was harmless; merged, it
meant "Night Shore Diving Mangel Halto" — a beach entry on the opposite coast —
claimed the sail family, and since the catamaran claims it first, **the dive was
deleted from every plan**. Replaced with a title test. The membership was chosen
against the data, not by intuition: of the 30 evening water-based products in
the live catalog, 22 are kind sail/snorkel and 3 are kayaks (already returned
earlier); of the last 5 the title net keeps the four real boats — including
"Luxury Four-Course Caribbean Dinner Cruise", filed under tours-sightseeing with
no sailing tag — and drops only the shore dive. `cruise|yacht` sits on top of
the daytime pattern because a dinner cruise rarely calls itself a sail.

*A `break` became a bug.* The staple candidate loop bailed out entirely on the
first candidate whose route family was claimed — "the whole category is spoken
for", true while each staple's pool sat in one family. `catamaran-sail` claims
`'sail'` one spec BEFORE `beach-dinner`, whose matcher admits both sunset dinner
cruises (family `'sail'`) and land-side shore dinners (no family). Breaking
discarded the shore dinner along with the cruise, and `beach-dinner` has
`localIds: []` — no fallback — so on the seeds where the shuffle led with a
cruise the staple silently stopped existing. Now `continue`. A staple still
stands down when every candidate is in a claimed family; `entry` just stays null.

Neither fix moved the aggregate: open slots stayed at 155 and `plan-diff`
violations at 0. The shore dive is a certified-divers product that was not
reaching these five personas anyway — which is the point of having both a test
and a measurement, since the measurement alone would have called it a non-issue.

**Cost, and what it exposed.** Open slots across 5 personas x 4 seeds went
**131 -> 155**, concentrated almost entirely in the evening (+3 to +5 per
persona, plus 4 splurge afternoons where the charter now stands alone). That is
roughly one evening per itinerary going empty, and it is not the rule
overreaching. The trace shows why:

```
Day 8 evening  x (slot left open)   pool 7/7, survivors 0
    already placed  4
    duplicate experience  3
        Aruba Celestial Sunset Cruise   route family "sail" already placed this trip
        Salsa, Sunsets & Mojitos at Sea route family "sail" already placed this trip
        Sip and Paint Aruba Sunset      tag Jaccard 0.20 >= 0.08 vs something on this day
```

**The entire evening pool is 7 items** for a 10-day trip. Four get placed, two
were sunset sails, one collides on same-day tags. The sunset cruise was papering
over a pool that was already exhausted; removing it made the shortfall visible
rather than causing it. This confirms the standing "Evening pool depth" item
below — more evening inventory is the fix, and no constant will do it.

---

### 2026-08-12 — The yield curve: built, measured, and NOT enabled

Asked to make the curated template the baseline for every traveller rather than
the ~8% the `isBalancedTraveller` gate reaches, with the template yielding slots
as the adventure slider rises so the sliders keep working.

Built (`resolveBalancedTemplate` now takes `tags` and keeps a per-day SPINE plus
the most adventurous remaining entries, capped by
`HIGH_ADVENTURE_TEMPLATE_ENTRIES`) and measured against explicit acceptance
criteria. **On its own criteria it passes everywhere:**

```
profile          tmpl%  niche   $/day   adv>=60/plan
budget/adv-10      65%     0      19          0.0
budget/adv-90      43%     0      54          3.0
mid/adv-50         65%     0      54          0.0
mid/adv-90         43%     0      87          3.0
MNO/adv-50         58%     0     375          2.0
MNO/adv-95         36%     0     526          4.0
```

Niche products go to **0 everywhere** (14 → 0 for budget/chill), MNO rises from
$320 to $375–526/day — the $68/day failure of the naive prototype does not
recur, because removing the gate is also what finally makes the `privateUpgrade`
alternatives reachable — and high-adventure travellers keep 3–4 adventurous
outings instead of collapsing to 1.0.

**Then the existing suite caught what the harness did not measure: it destroys
the Regenerate button.**

```
opposite-persona overlap:  71%   (a test asserts < 50%)
reseed overlap:           100%
distinct plans / 5 reseeds:  1
```

A deterministic template covering 65% of slots leaves nothing for a reseed to
vary. Nine tests fail, and they are not tests encoding the old world — they are
geographic coherence, persona differentiation, reseed variety, the splurge
badge, and a **pinned private charter placed twice**.

Density is the dial, and the trade is clean:

| cap | reseed distinct | tmpl% | niche (budget/chill) |
|---|---|---|---|
| 18 (all) | **1/5** | 65% | 0 |
| 12 | 4/5 | 52% | 3 |
| 9 | **5/5** | 44% | 3 |
| 6 | 5/5 | — | — |

Regenerate recovers at a cap around 9–12; template coverage and niche
suppression get worse in exactly the same step. The two requests — "as few
activities deviating from the template as possible" and "regenerate feels alive"
— are in direct tension, and no cap satisfies both.

**Left unenabled on purpose.** The gate stays, so behaviour is unchanged and the
suite is green; the curve is one line away from live once the density is chosen.
Shipping a guess here would have silently turned Regenerate into a no-op for
almost every traveller.

---

### 2026-08-12 — Template alternatives: the answers swap cards, not plans

The canonical template carries typed alternatives per slot — `highBudget`,
`kids`, `hike` — and the traveller's answers pick which applies. This is the
mechanism that is meant to stop a money-no-object traveller receiving a $68/day
itinerary of free beaches: the template supplies the SHAPE, and the alternatives
upgrade the individual cards inside it.

**Resolution is never by name.** `"Private snorkel sail"` is a label, not an id;
the live catalog has dozens of loose matches and no field marking "this is the
private version of that". An `Alternative` therefore carries either an explicit
`itemId`/`localId`, or `privateUpgrade: true` meaning *resolve by rule*:

- the same route family as the default, so a snorkel-sail slot cannot upgrade
  into a jeep tour;
- `review_count >= MIN_CHAMPION_REVIEWS`, because the priciest private sails on
  the live catalog have **4, 0 and 2 reviews** — "most expensive" alone picks
  junk;
- then the dearest that `fitItem` still accepts, so the traveller's own cap
  decides how far the upgrade goes. `treat-yourself` ($400/day) lands somewhere
  different from money-no-object, with no extra code.

`highBudget` is defined as **more than $200/day**, which is exactly above the
mid-range cap — so `treat-yourself` or `money-no-object`.

**Precedence is explicit:** kids, then highBudget, then hike. A high-budget
family gets the kids swap, because a constraint about who is travelling outranks
a preference about spend. It is tested both ways round so array order in the
template cannot decide it.

**An unresolvable alternative falls back to the default** rather than emptying
the slot — a template slot is a promise about the shape of the day.

**Two limits, both real and both recorded rather than hidden.**

*The offline stub has none of the kid products* — no Atlantis Submarine, no De
Palm Island pass, no animal sanctuary. On the stub those swaps correctly fall
back, so a stub-only test would assert the fallback and never exercise the swap.
The suite adds exactly those three products to a fixture to test the mechanism
offline.

*The `highBudget` branch is 0% reachable — dead code, not merely narrow.* The
first version of this entry said "~11%", which reads as reduced reach. Review
proved the truth is worse and exact: `isBalancedTraveller` requires `mid-range`,
`altTypesFor` emits `highBudget` only for `treat-yourself`/`money-no-object`, and
`answersToTags` maps budget to exactly one tag — so the two sets are **disjoint**.
Measured over an 840-combination grid:

```
get the template:                 70  (8.3%)
qualify for a highBudget swap:   420  (50.0%)
BOTH (needed for privateUpgrade):  0  (0.0%)
```

So all three `highBudget` alternatives and the ~20-line resolver — the most
intricate part of this commit — cannot execute in production. It is inert and
falls back safely, but it is an abstraction built before the gate that would let
it run, and **it does not fix the $68/day problem it was built for**. The
precedence test is written against the pure `pickAlternative` rather than a
generated plan for exactly this reason.

Widening template coverage is the prerequisite, not a follow-up. The `kids` and
`hike` branches DO run today; only `highBudget` is stranded.

---

### 2026-08-12 — One sail, unless the trip is long enough for two

**Refines the merge earlier today.** Collapsing the daytime and evening sail
families was right for the reported bug and too blunt as a general rule: a week
is not long enough to sell the same water twice, but a fortnight is — provided
the second outing is genuinely different. So the rule is now trip-length aware.

```
<= 7 days   one sail, of either kind
>= 8 days   one DAYTIME sail AND one EVENING sail; never two of a kind
```

**Where it lives matters.** `routeFamilyOf` goes back to returning the
fine-grained `'day-sail'` / `'evening-cruise'`, and a new wrapper
`tripRouteFamily(entry, nDays)` collapses them to `'sail'` below
`SECOND_SAIL_MIN_DAYS`. The split is deliberate: `routeFamilyOf` answers *what
is this?* and must stay pure and trip-independent; `tripRouteFamily` answers
*what counts as a repeat on THIS trip?*. Every engine call site and both UI
helpers now take `nDays`.

Measured on the live catalog, 3 group types x 6 seeds at each length:

```
 4 days: daytime 1.00, evening 0.00, violations 0
 7 days: daytime 1.00, evening 0.00, violations 0
 8 days: daytime 1.00, evening 1.00, violations 0
10 days: daytime 1.00, evening 1.00, violations 0
14 days: daytime 1.00, evening 1.00, violations 0
```

**`tools/plan-diff.ts` went stale again — the third time today.** Its mirrored
"one sail per trip" rule immediately reported **20 violations that were not
violations**, because it ran 10-day plans against a rule that no longer applied
at that length. It now imports `SECOND_SAIL_MIN_DAYS` rather than copying it,
and asserts the three-part rule. A known gap is recorded in the file: it counts
Viator products only, so a sail in a curated slot is invisible to it even though
the engine counts one.

---

### 2026-08-12 — Nothing asked who the traveller was

**Reported:** a Solo traveller offered "Aruba Eagle Beach Romantic Sunset Picnic
in a Luxury Cabana". Measured: **90 of 120 Solo plans (75%)** carried a
"Romantic…" product.

**The cause was not a bad score. It was no score.** `answersToTags` emits a
`solo` tag and `fitItem` reads no group-type tag at all, so the picnic scored
identically for everyone:

```
as Solo     1.6483516...
as Couple   1.6483516...
as Friends  1.6483516...
```

`groupType` is read in exactly three places: to build a tag no ITEM-LEVEL rule
consumes (the `couple` tag IS read at group level — `matcher.ts:34` — which is
why the phrasing matters), to decide which Q8 pills apply
(`notesFlags.flagAppliesTo`), and as an input to `hashAnswers`. So it changes
which VARIANT you get, never which product fits.

**A sensitivity sweep, and it is the real finding here.** Same seed, one answer
varied, symmetric difference over 8 seeds:

| answer varied | cards changed (of ~20) |
|---|---|
| Adventure level 5 → 95 | **19.4** |
| Budget low → high | **12.3** |
| Interests: beach → food & drink | 3.0 |
| Interests: beach → culture | 2.0 |
| Group type: Solo → Couple | 1.0 |
| Interests: beach → adventure | 0.8 |
| **Group type: Solo → Family with young kids** | **0.0** |
| **Lodging: Palm Beach → San Nicolas** | **0.0** |

Two sliders do nearly all the work. Solo and "Family with young kids" produce
the identical plan. **Lodging (Q7) changes nothing whatsoever.**

**Fix:** `isCouplesOriented`, mirroring `isKidsOriented` exactly — an auto-fill
exclusion, not a ban. The product stays in Explore and a pinned one still lands;
we simply stop handing it over unasked. `couple` covers the honeymoon pill,
which `answersToTags` already maps.

Explicit markers only. Over the 328 live items the pattern matches 6, and a
wider one adding `intimate|anniversary` matches **exactly the same 6** — so
those words earn nothing and only add false friends. Five of the six sit below
the 25-review champion floor and never auto-placed anyway: the reported bug was
essentially one product.

**Deliberately narrow.** 123 further items are couples-ish by vibe — "Private
Sunset Tour", "Morning Champagne and Lobster Sail" — and are NOT excluded. A
solo traveller on a sunset sail is normal; a solo traveller sold a proposal
photoshoot is the engine not listening. Only titles that name their audience
qualify.

**Result:** 90 of 120 → **0**. `plan-diff` violations unchanged at 0; open slots
155 → 161, the six slots that used to hold a couples product for someone who is
not a couple.

**Not fixed here, and worth stating plainly:** this closes one hole in a wall
that is mostly missing. Group type still does not score anything, interests
barely register, and lodging is inert. The instrument for that is the
conformance harness, not another patch.

---

### 2026-08-12 — The one-sail rule stopped at the generator's edge

**Reported:** two sails in one itinerary — a catamaran and a sunset sail — both
Viator cards, on a plan built by the fixed engine.

The engine was innocent, and measuring said so before anything was changed:

```
1,728 plans (4 group types x 4 budgets x 4 interest sets x 3 adventure x 3 lengths x 3 seeds)
  engine produces >1 Viator sail:      0
  card renderer shows >1 Viator sail:  0
```

**The rule only ever existed inside `generatePlan`.** Every path that edits a
plan *after* generation runs in the UI, and `routeFamilyOf` was not exported —
so swap, add-from-shortlist and drag-between-days had no way to ask which
families were spoken for. There were zero references to route families in
`Itinerary.tsx`.

Swap is the one that bites, and for a precise reason: `applySwap` excludes
candidates by **item id and group id**, while the sail family **spans groups on
purpose**. That is the exact case it was invented for — the original report was
two catamarans that `activityKind` classified differently ('sail' and
'snorkel'). So every exclusion the swap already performed waved the second sail
straight through.

**Fix, in two halves, because the two halves are different questions.**

*Swap is ours, so it obeys the rule.* `routeFamilyOf` is exported, plus
`claimedRouteFamilies(cards, resolve, skipUid)` and
`withoutClaimedFamilies(pool, claimed)` — both pure, both unit-tested. All four
swap pools are filtered: the within-group rotation too, because a group is not a
family ('sailing-cruises' holds sails, dives and a submarine, so rotating a
non-sail card could still surface a sail).

`skipUid` carries the asymmetry that was explicitly asked for — but state it
precisely, because the first version of this entry overclaimed. **`skipUid`
guarantees the new filter never BLOCKS a sail-for-sail swap.** Whether a sail is
actually offered is decided by the pre-existing pool exclusions, which drop
candidates by item id and group id, and those return a non-sail most of the
time: measured over 256 post-fix plans x 5 chips, swapping THE sail returns
another sail 0/256 on the stub and 77/256 (30%) on live — **identical numbers
with the family filter disabled**. The single browser observation that seemed to
confirm "still offers sails" was one lucky draw, not the general behaviour.

Tapping "Swap this" on a jeep never returns a sail while one is planned. That
half IS the new filter's doing, and it is measured: 12,439 → 0 leaked sails on
the stub and 4,608 → 0 on live, across 63,995 simulated swaps.

*An explicit add is the traveller's, so it gets a note, not a block.* A second
card of a family already used shows `⚠ 2nd sail this trip`. Derived from the
plan at render time rather than recorded on add, so it holds however the
duplicate arrived — shortlist picker, a drag, or a trip saved before the rule
existed. Checked for false positives: across the same 1,728 freshly generated
plans the badge fires **0 times**, so it can only ever mark a deliberate choice.

**Mutation-tested rather than assumed.** The first three helper tests passed the
moment they were written, which proves nothing, so all three mutations were run:
making the filter a no-op and ignoring `skipUid` both killed tests; making a
familyless card claim a bucket did not, and a sixth test was added to close it.
Most of the catalog has no route family, and if those claimed some catch-all the
first one placed would block every familyless card from every swap for the rest
of the trip.

**Verified in a browser, and that is how the REAL bug surfaced.** Driving the
app (Playwright against the dev server, stub catalog) showed **three** sails in
one plan before a single swap was clicked:

```
Antilla Shipwreck Snorkel Cruise            <- entry.kind 'activity'
Champagne Sunset Sail with Open Bar         <- entry.kind 'group'
Catamaran Sail & Snorkel at Boca Catalina   <- entry.kind 'activity'
```

**`catalog.activities` is not "local".** This was reported by a traveller who
said plainly that both sails were Viator cards, and the first diagnosis called
them curated locals because of which array they sit in. That was wrong in the
way that matters. On the LIVE catalog `boca-catalina-snorkel` is refaced to
"Arusun Catamaran Sail with Snorkeling in Aruba" and carries a real
`viator_item_url` with the affiliate params, so `ItineraryCard.tsx:54` gives it
a **"Book now"** button — it renders as a Viator card because it IS a Viator
product. The same product also exists as item `8936P1`. The array split is
"curated slot" vs "catalog pool", not local vs Viator, and only the offline stub
makes it look otherwise.

**`routeFamilyOf` never tested `kind: 'activity'` entries for sails.** Its
non-group branch checked off-road and kayak and returned `undefined` for
everything else, so the one-sail rule quietly meant *one `kind: 'group'` sail*.
Two curated slots are boat trips, and `boca-catalina-snorkel` is also the
`catamaran-sail` staple's own `localIds` fallback — so the staple could place a
bookable catamaran that retired nothing and let a second sail follow it.

The test is on the TITLE and has to be: a local carries no Viator kind, and
`loadCatalog` refaces these to live product titles, so the id is no key either.
It requires a VESSEL word, because the shore snorkels ("Malmok Beach Snorkel",
"Boca Catalina Shore Snorkel") share the snorkel tag but are a walk into the
sea. Checked against all 26 locals in both catalogs: exactly the two boat trips
match, before and after refacing.

Measured across the same 1,728 plans, counting BOTH entry kinds: **1,066 with
more than one sail → 0.**

The group-only count was 0 before and after, and reporting that number as "the
engine is clean" was the actual mistake here. It defined a card with a Book now
button out of the measurement and contradicted what the traveller could see on
their screen. **A metric that excludes half the rendered cards is not evidence.**
The browser is what settled it.

Browser after the fix: baseline 3 sails → 1; swapping a NON-sail returned
"Arikok National Park Hike" (still one sail); swapping THE sail returned
"Catamaran Snorkel Cruise to Antilla Shipwreck" — one sail either way. See the
correction above: that second observation is NOT evidence of a general rule.

**Fill cost, both catalogs.** Live: 6,398 → 6,393 cards over 256 plans (−5,
0.08%) — free. **Stub: 6,638 → 6,406 (−232, −3.5%), open slots 1,658 → 1,934.**
The stub is the first paint and the offline fallback, so a pre-live-catalog plan
is about 0.9 cards thinner. The card removed was the duplicate sail, so the
trade is right — but it is a real cost and belongs in the record.

**A side effect worth keeping.** The helper catches families beyond sail: "not
our vibe" on a sail card previously returned a Natural Pool product in 64 of 256
cases where the plan already had one. After the diff, 0.

---

### 2026-08-12 — Three cards a day, and the meal counts

**Asked for:** "max 3 activities per day including food". The engine did not do
that, and the gap was a genuine misunderstanding: asked earlier whether the
ceiling should change, the answer was "keep it at 3" — which was read as *leave
the existing rule alone*, since `MAX_NON_MEAL_CARDS_PER_DAY` was already 3. It
counted **non-meal** cards, plus one meal on the side, so the real ceiling was
**four**.

Measured before the change: **20 of 300 live days** carried four cards, and
**35 of 240** on the stub under the sweep the committed test uses (4 personas ×
6 seeds × 10 days). Always the same shape.

```
default seed 0 day 7:  baby-beach-snorkel | lunch-oniels | alto-vista-chapel | california-lighthouse-sunset
foodie  seed 0 day 4:  San Nicolas tour   | lunch-oniels | rodgers-beach    | california-dunes-sunset
```

**Three places were changed. Only the third does anything.**
`withinDayShape` and `fitsDayShape` both tested the meal *before* the ceiling
and returned early, so a meal never met the ceiling at all. Reordering them is
correct in principle and **changes nothing in practice** — review instrumented
both branches over 10,080 days and got zero hits, and either line can be deleted
with the suite green. The day loop writes at most one entry per slot, so
`cardsToday` cannot exceed 2. They stay as rails, now labelled as such.

The en-route food post-pass is the whole fix. It ran last and appended
unconditionally, with a comment saying so outright: *"The stop is a MEAL, so the
non-meal ceiling cannot block it."* It now bails when the day is full, and
computes that count **before** removing any dinner it would displace, so a day
with no room does not lose its dinner for a stop that then cannot land.

`MAX_NON_MEAL_CARDS_PER_DAY` is renamed `MAX_CARDS_PER_DAY`. A name asserting
"non-meal" on a rule that counts meals is the kind of lie that produced two
other bugs on this same day.

**The counterweight test earned its place immediately.** The first attempt at
the ceiling did not bound the food pass, it deleted it — zero lunch stops. The
test written alongside ("still allows a meal as the third card") caught it. It
sweeps four personas deliberately: the default persona alone returns 0 on the
stub, because the south-coast drive the stop needs is not in its themes, so a
single-persona version would have failed for a reason unrelated to the rule.

**Result.** Four-card days **20 → 0**. Cards per day on the live catalog:

```
before   1:24  2:120  3:136  4:20
after    1:23  2:116  3:161
```

The en-route lunch stop still lands, on **17 of 300 days against 29 before**.
That loss is the accepted cost, and it is the same cost the exemption was
written to avoid in the first place: a full south-coast day can no longer pick
up its food stop, and Zeerover and O'Neil's are close to the only decent options
down there. Traded knowingly for never showing a four-card day.

`tools/plan-diff.ts` mirrored this rule and counted it over `itemsOf`, which
returns only Viator products — so a day of one tour plus a lunch stop plus two
free beaches scored 1. It now counts every slot entry. Verified non-vacuous:
the corrected checker reports **12 violations against the pre-fix engine and 0
against the fixed one**.

---

### 2026-08-12 — The balanced template walked around the day-pass rule

**Found in review, not in production** — and it could not have been found in
production, because the path is dormant. Recorded and fixed anyway, for the
reason below.

The day-pass rule ("a pass IS the day") is stated in two places: `withinDayShape`
for the fill ladder and `fitsDayShape` for the pre-passes. The balanced-template
pre-pass is a third placer and consults neither. It checks `templateAvail`, which
asks **is this SLOT claimed** — never **does this DAY already hold a pass**. And
`fitsDayShape` is declared *after* the template block, so it is in the temporal
dead zone there: it could not have been called even by someone who thought to.

Sequence: the pin pre-pass puts a pinned day pass on day 1 morning →
`templateAvail(1, 'afternoon')` is true → `eagle-beach-morning` lands beside it.

Measured with the pin path exercised directly, 5 personas × 4 trip lengths × 5
seeds:

```
before   runs 100 — pass placed 100, SHARED 40
after    runs 100 — pass placed 100, SHARED  0
```

The 40 is not noise. It is exactly the two **balanced** personas (2 × 4 × 5 =
40) — every single run that qualified for the template, always day 1, always
`eagle-beach-morning`. The other three personas never reach the template at all,
which is why the aggregate looks like 40% rather than 100% of the affected set.

**Fix:** `pinnedFullDayOn(day)` in the template loop. It reads `pinnedSlots`,
which is populated before the template runs, so it needs no restructuring of the
declaration order. Only one direction is required: the template places curated
LOCAL activities and `isFullDayEntry` demands `kind === 'group'`, so the template
can never itself be the pass.

**Why fix a dormant path.** Nothing passes `opts.pinned` today — the shortlist
was unwired from it on 2026-08-05 — so this changes no live plan (`plan-diff`:
0 plans changed, open slots unchanged at 155). But the shortlist is expected to
be rewired, and on the day it is, this reopens the exact bug fixed hours earlier
in the entry above, silently, for the persona that gets the curated template.
The cost of closing it now is four lines; the cost of finding it later is a
second production report.

**Still open, deliberately:** `slotAvail` is per-slot, so two PINS can share a
day, including a pass and something else. Left alone — pins are exempt from
every other rule here too ("an explicit shortlist choice always lands"), and
making the pass the one exception would be a change to what a pin means, not a
bug fix. (The reverse-direction gap noted here on the day was closed the same
day — see the correction under the day-pass entry above.)

---

### 2026-08-12 — A bus tour is not a boat

**Reported:** follow-up to the entry above. Asked why `sec:cruises-water`
contains "Best of Aruba by Bus" at all, and whether the engine should be
filtering on something more granular than a browse section.

It should. **`activityKind` returns two incompatible sorts of answer in one
string**: a real activity kind when the item's Viator tags name one, or
`sec:<browse section>` when they do not. On the live catalog that fallback fires
for **144 of 328 items (44%)**:

| bucket | items |
|---|---|
| `sec:tours-sightseeing` | 74 |
| `sec:cruises-water` | 32 |
| `sec:adventures-outdoor` | 27 |
| `sec:food-drink` | 11 |

`BOAT_KINDS` then mixed three real kinds with one of those buckets —
`{sail, snorkel, dive, 'sec:cruises-water'}` — so any rule reading it inherited
whatever Viator's section tree filed under water. Two things make that a lot:
tag **20255** maps to `cruises-water` and **73 live items carry it**, and
`primarySection` breaks ties by tab order, where water sorts first. So the
horseback ride, whose sections are `[tours-sightseeing, adventures-outdoor,
cruises-water]`, is a water activity because water sorts first.

Four non-boats were the result, all eligible, all well-reviewed:

```
Full-Day Aruba History and Must-See Landmarks Tour   1591 reviews
Horseback Ride Tour to Natural Pool                  1252
Best of Aruba by Bus                                  642
Kids Parasailing Experience                             1
```

Each blocked a sail from sharing its day (`dayCapFamilyOf`) **and** pushed the
next sail two days out (`gapFamilyOf`, `FAMILY_MIN_DAY_GAP = 2`). None is a
full-day product, so both arms were live.

**Fix:** `isBoatOuting(item)` — real kinds count; the generic bucket counts only
with positive title evidence. Checked against all 32 items in the live bucket:
keeps the 28 real boat outings, including the ones the tags miss entirely
("Aruba Seabob Scooter Reef Tour", "Aruba PADI Scuba Diving Program"), and drops
exactly the four above. Every alternative in the regex names a vessel or a thing
you do off one — `reef` and `shipwreck` split the bucket 28/4 identically and
were dropped anyway, because a dive SITE is the kind of word that starts
matching beach walks as the catalog churns.

**Effect, and an honest limit.** Only the splurge persona moves: 758 → 752 cards
across 30 plans, and the trace is complete. The history tour sits on day 4; under
the old rule it claimed the boat family, so the 2-day gap pushed a dive from day
5 to day 6. Freed, the dive lands day 5 and the jet ski takes day 6 — and the
afternoon local pick follows the morning's geography, so `rodgers-beach` (far
south) becomes `palm-beach-strip`, which drops the en-route lunch stop that only
fires for far-south drives. Net: `rodgers-beach` 19→13, `lunch-oniels` 29→23,
`alto-vista-chapel` 24→30. **Open slots unchanged** — the loss is a companion
meal card, not an unfilled slot. The change is provably strictly narrowing (the
new predicate is a subset of the old), so two real boats can never newly share a
day; confirmed over 240 plans.

Worth recording: across those 240 plans the four de-classified items were placed
33 times and **never once landed on a day that also held a real boat**. All
measured benefit flows through the gap rule, not the same-day cap. The
one-sail-per-trip result is evidence of no harm, not evidence the day-cap arm
did anything.

**`tools/plan-diff.ts` now imports `isBoatOuting` and `isSailOuting` instead of
copying them.** It had copied the boat set, and this change made the copy stale
— it would have flagged a legal bus-tour-plus-catamaran day as a violation, on
the one tool whose value is not manufacturing false alarms. Its header already
recorded one such incident; this would have been the second, so the definitions
are imported now and only the two bare integers stay mirrored.

**This is a stopgap, and the real fix is blocked.** Enrichment exists to give
these items a true kind, and `activityKind` already consults `enriched_kind`
before falling back. But `KIND_VOCABULARY` is *derived from `KIND_BY_TAG`*
(`itemFit.ts:199`), so enrichment may only answer one of twelve physical
activity kinds: offroad, snorkel, dive, jetski, kayak, sup, parasail, surf,
sail, hike, horseback, zipline. There is **no kind for a bus tour, a submarine
or a sightseeing tour**, so no `enriched_kind` will ever arrive for them — and
the largest bucket, the 74 in `sec:tours-sightseeing`, is mostly out of reach for
the same reason. The horseback ride is the exception that proves it: `horseback`
IS in the vocabulary, so enrichment can fix that one. Widening the vocabulary is
a separate decision, because `KIND_ADVENTURE` scores every kind and each new
entry needs a value chosen against the flag caps that read it.

---

### 2026-08-05 — The map bypassed the display chokepoint

**Symptom (reported):** the "Luxury Four-Course Caribbean Dinner Cruise
Experience" card shows its photo in the itinerary and no photo on the map.

**Root cause:** two surfaces, two ways of turning a stored id into a product.
The plan stores only ids. `resolveSlotEntry` is the display chokepoint that
heals a stale one — a stored id no longer in the catalog re-faces to the
best-fitting item in the same group, which is why the itinerary still shows
something sensible. The map looked the stored id up in `catalog.items` directly
and got nothing: no photo, no price, no duration, no affiliate link, and a title
that quietly fell back to the GROUP name.

Self-inflicted, and recently: the same session's `isExcludedFromCatalog` work
removed 9 party buses and the retail products, all of which are ids sitting in
saved plans and in `shared_itineraries` rows. Reproduced exactly — a plan
holding party bus `404788P3` (group `sightseeing-tours`) renders as the dinner
cruise with its photo in the itinerary, and as a bare pin on the map.

**Fix:** the map resolves through `resolveSlotEntry` too, so the two surfaces
agree by construction rather than by being kept in step by hand. Coordinates
follow the resolved item as well — a pin for a product that is no longer in the
plan is worse than no pin. Freshly generated plans are unchanged (168 Viator
cards, 0 differences before and after); only stale stored ids move.

**The general lesson**, worth more than this bug: any code that turns a stored
`SlotEntry` into something a traveller sees must go through `resolveSlotEntry`.
Two places now do (Itinerary, Map). A third that forgets will not fail loudly —
it will render a slightly different plan.

---

## Current state — embedding clustering

Present-tense. The dated entries above are records of what was built on the day;
where they disagree with this section, this section wins.

- **It is live.** Verified 2026-08-02 against the live `viator-cards` payload:
  all 361 items carry an `experience_cluster_id` (172 clusters). `index.ts`
  sets that field only inside `if (provider)`, so a provider secret is set and
  clustering runs on every ingest. The activation checklist in the 2026-07-08
  entry is done.
- **Threshold is `EMBEDDING_CLUSTER_THRESHOLD = 0.82`** (in `index.ts`), not the
  0.88 quoted in the July entry. Rationale is in the code comment: two
  Natural-Pool jeep safaris embed at ~0.83, two sunset dinner cruises at ~0.89,
  while genuinely distinct pairs sit at ~0.56–0.60.
- **The algorithm is union-find, not greedy founder-based.** `clusterByEmbedding`
  builds a parent array and unions any pair over threshold; the lowest index
  (highest rating) stays root. Greedy single-pass was the failure mode it
  replaced — two jeep safaris at 0.83 could attach to different founders and both
  survive.
- **Cluster dedup and tag Jaccard are layered nets.** `similarReason` checks
  `usedClusterIds` first; a hit is conclusive, a MISS falls through to tag
  Jaccard. Making the cluster authoritative either way was tried and reverted —
  `championsByExperience` already allows one item per cluster into the pool, so
  `usedClusterIds` almost never fires there, and different option codes of one
  base product get different cluster ids (2455SUB vs 2455SEMI). Jaccard does
  nearly all the real work on live data.

### What actually limits plan variety (measured 2026-08-02)

Over-clustering was the first suspect and it is **not** the main constraint.
Measured over 45 plans (5 personas × 7/10/14 days × 3 seeds) against the live
catalog through the real `loadCatalog()` pipeline, disabling cluster dedup
entirely recovers only ~16 slots and 14 products. Ranked by actual cost:

1. **The auto-fill pool rule** — dominant. The old within-budget-tier popularity
   percentile ranked *items* and was blind to experience structure: it kept many
   redundant variants of popular experiences while deleting whole experiences
   whose members were all modestly reviewed. It wiped **96 of 161 distinct
   experiences entirely**. Replaced by `championsByExperience` (below).
2. **Catalog size** — still the ceiling on *distinct* Viator experiences. 72 of
   155 eligible experiences (retail, photo services and self-drive vehicle hire
   excluded) have a member with 25+ reviews, giving a champion pool of ~81, and
   no-repeat dedup retires a cluster on first use. Open slots are no longer the
   symptom: since free local beaches became revisitable
   (`REVISITABLE_MIN_DAY_GAP = 2`) a 14-day trip filled every ladder slot on all
   five personas (measured 2026-08-03; the same runs before the change left 5-9
   open). That held until the 2026-08-05 curation rules, which leave slots open
   BY DESIGN — a day stops at two outings — so fill is no longer the health
   metric; see docs/ROADMAP.md. What stays thin is the number of distinct Viator
   experiences — an ingestion problem; no constant fixes it.
   problem; no constant fixes it. (An earlier draft of this section said "~50",
   which conflated experiences *surfaced in plans* with experiences *available
   in the pool* — the pool figure is 81.)
3. **Cluster dedup** — third. Real but modest.

The pool sweep, same 45 plans:

| pool rule | open | experiences | mean rating | <25 reviews |
|---|---:|---:|---:|---:|
| percentile floor 0.6 (was live) | 343 | 44 | 4.69 | 10 of 59 |
| champion by raw rating | 207 | 89 | 4.35 | 41 of 93 |
| champion by shrunk rating, no gate | 244 | 83 | 4.40 | 38 of 87 |
| **champion + 25-review gate (shipped)** | **327** | **57** | 4.63 | 8 of 61 |
| champion + 50-review gate | 328 | 40 | 4.75 | 0 of 44 |

Two results worth keeping:

- **Bayesian shrinkage barely helps on its own** (row 2 → row 3). The problem is
  not picking the wrong member of a cluster; most clusters contain no
  well-reviewed member at all, so any champion of a thin cluster is thin. The
  absolute review gate is what does the work.
- **The big variety numbers are unreachable at acceptable quality.** 89
  experiences requires accepting 44% thinly-reviewed products. Of the 96
  experiences the old floor wiped, only ~6 clear a 25-review bar.

Method note: measure through `loadCatalog()`, not the raw edge-function payload —
the app filters transport-only items, regroups, and runs `normalizePopularity` at
load. Probing the raw payload makes the popularity floor look inert (it is not)
and mutating `popularity_score` to disable it also zeroes the ranking bonus in `itemFit.ts`
(`score += (item.popularity_score ?? 0) * 3`). The only clean lever is the pool rule itself.

### Cluster sizes (context, not the headline)

Union-find is transitive, so A~B and B~C merge A and C even when A and C are far
apart. Post-exclusion (transport-only + party bus) the catalog is ~328 items in 161 clusters, sizes
73, 23, 15, 12, 9, 7, 7, 6 … 136 singletons. The 73-item cluster mixes
small-group UTV, private jeep and 4x4 Natural-Pool tours. Worth revisiting
`EMBEDDING_CLUSTER_THRESHOLD` eventually, but it ranks behind the two above.

To inspect: `npm run trace -- --persona adventurer --days 14 --verbose`, then grep
`experience cluster`. On a 14-day adventurer plan the rules now fire roughly
323 (tag Jaccard) / 110 (route family) / 12 (cluster), plus ~385 same-day
Jaccard and ~149 boat day-gap — the two newer rules sit earlier in the chain
and take counts that used to fall to Jaccard. Cluster fires rarely BY
DESIGN: `championsByExperience` has already admitted only one item per cluster
to the pool, so tag Jaccard is the net actually catching duplicates — which is
why making the cluster authoritative removed dedup almost entirely.

Note that rejection *counts* measure how often a rule fires, not what it costs —
a rule can fire constantly and cost nothing while alternatives remain.

## Known limitations / open items

- **Same-day cross-slot**: two items from one Viator group can land on the same
  day. Not a recording-order problem — the day loop records each pick's group,
  cluster and tags immediately, before the next slot is filled. The gap is that
  `similarReason` consults `usedGroupIds` ONLY for items with neither tags nor a
  cluster id, so two tagged items from one group are caught only if Jaccard clears
  a threshold — `SAME_DAY_SIMILARITY_THRESHOLD` (0.08) within one day, or
  `TAG_SIMILARITY_THRESHOLD` (0.35) across the trip. Observed as low-risk at current catalog size.

- **Tag sparsity** (population is empty on live data, measured 2026-08-11):
  GROUP entries with `tags: []` and no cluster id bypass semantic dedup and rely
  on `usedGroupIds` + `lastUsedDay` only. Two corrections to the original
  wording: local activities were never affected — `similarReason` returns at
  `e.kind !== 'group'` before any of this — and no live Viator item is affected
  either, since all 328 carry both tags and a cluster id. The branch is reachable
  only from the offline stub catalog.

- **Group type is still almost inert**: `classifyTags` emits only budget,
  interest and adventure-band tags, so `solo` / `couple` / `friends` /
  `multi-gen` never match anything in `fitItem`. `isKidsOriented` (2026-08-05)
  and `isCouplesOriented` (2026-08-12) are the only ITEM-LEVEL rules that read Q2, and it is a single exclusion rather
  than a scoring dimension. Group type does reach the plan two other ways —
  `flagAppliesTo` uses it to decide which Q8 pills apply, and live groups carry
  'couple'/'friends' in `matched_by`, which `candidatesFor` filters on. What it
  never does is score an individual item. Building a real one needs a per-item family signal the feed
  does not provide — Viator's "Kid-Friendly" tag covers 2 of 337 live products.

- **Evening pool depth.** The underlying shortage is real and unchanged: a trace
  of one 10-day plan shows the whole evening pool at **7 items**, four already
  placed, and the 0.08 same-day threshold blocking one of the rest. More evening
  inventory is the fix; no constant will do it.

  The rule-driven part has since been walked back. The 2026-08-12 merge briefly
  made one sail cover the evening too — costing an evening card per trip and
  taking open slots from 131 → 155 across five personas × 4 seeds — but the
  length-dependent rule later the same day restored the evening sail on trips of
  8+ days. **Those 131 → 155 figures predate both that change and the couples
  exclusion, and have not been re-measured**; treat them as historical, not
  current. Under the pre-merge split, evening fill was 220/288 seeds×days
  (measured 2026-08-05).

- **The evening pick ignores where the day was**: sunset and dinner products are
  all west-coast, and nothing stops one being appended to a day spent on the
  south coast — 15-24 km, routinely. Quantified 2026-08-05 (see the entry
  above): daytime spread averages ~2.0 km, whole-day ~10.3 km (guarded at <6
  and <12), and the gap is
  entirely this. Would need the geo penalty to apply across the evening
  boundary, or an accepted rule that the evening is exempt.

- **Threshold tuning**: `TAG_SIMILARITY_THRESHOLD = 0.35` was set
  conservatively. If the live catalog shows false positives (legitimate variety
  blocked) or false negatives (duplicates still slip through), adjust this
  constant in `itineraryGenerator.ts`.
