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
| `usedRouteFamilies` | five families, each retired trip-wide after one placement: `natural-pool`, `offroad`, `kayak`, `day-sail`, `evening-cruise` |
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
the day shape (<=2 outings, <=1 meal, <=3 non-meal cards); when
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
  is the only ITEM-LEVEL rule that reads Q2, and it is a single exclusion rather
  than a scoring dimension. Group type does reach the plan two other ways —
  `flagAppliesTo` uses it to decide which Q8 pills apply, and live groups carry
  'couple'/'friends' in `matched_by`, which `candidatesFor` filters on. What it
  never does is score an individual item. Building a real one needs a per-item family signal the feed
  does not provide — Viator's "Kid-Friendly" tag covers 2 of 337 live products.

- **Evening pool depth**: with one evening cruise per trip (2026-08-05),
  evening fill across five personas sits at 220/288 seeds×days. The shortfall is
  candidate exhaustion — the live evening pool is ~10 items for a given persona,
  and the 0.08 same-day threshold blocks much of what is left. More evening
  inventory is the fix; no constant will do it.

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
