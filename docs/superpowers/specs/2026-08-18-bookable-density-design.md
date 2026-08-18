# Bookable density: how many things a traveller must book, and when

Status: design approved 2026-08-18, not yet implemented.

## The problem, measured

Run against the live catalog (328 items, 26 curated locals), 10-day trips, seeds
0–2, via a throwaway harness over the real `generatePlan`:

| persona | paid outings | days carrying one | spend |
|---|---|---|---|
| Family with young kids, Mid-range, Adventure & adrenaline, adventure 80 | **9** | 2,3,4,5,6,7,8,9,10 | $972 |
| Family with teens, Mid-range, Adventure + Watersports, adventure 85 | **9** | 2,3,4,5,6,7,8,9,10 | $984 |
| Couple, Mid-range, Beach & chill, adventure 50 (the balanced template) | 5 | 2,3,4,5,6 | $475 |

Nine bookings across ten days, every day consecutive, including the departure
day ($120 first-time dive on day 10). Even the curated balanced persona books on
five consecutive days, all in the first half of the trip.

The engine has exactly one rule in this family — `MAX_PAID_OUTINGS_PER_DAY = 1`
— plus a trip-wide *spend* pool (`budgetAvgCap` × days). Nothing caps the
**count**, and a spend ceiling cannot: cheap outings are always affordable, so
every day that can pay for one gets one. This is the same failure mode recorded
on 2026-08-17 for the budget tier, one level up.

The visible symptom is a persona-fit failure. The adventure-85 family gets *Sip
and Paint Aruba Sunset Creative Experience* ($65) on day 10 across all three
seeds, and a $39 *Downtown Historic and Cultural Walking Tour* on day 9. Those
are not scoring bugs. The fill ladder widens as it exhausts good matches, and
nine slots demanding a paid outing is what drives it to the bottom of the
catalog. Fewer bookables removes most of these without touching the scorer.

## The rule being encoded

Owner's specification, 2026-08-18:

- 4–5 bookable activities on a 10-day trip; one per 2.5 days, floor 1, cap 6.
- Never more than one per day, never on consecutive days.
- Zero on the arrival day and zero on the departure day.
- At least one fully unstructured day in the middle.
- Bias placement toward the second half of the middle — people book more
  readily once they trust the itinerary.
- Aruba has roughly five things that genuinely need booking. A planner
  suggesting eight is recommending things no local would recommend, and readers
  feel it even when they cannot articulate why.

Refined by the owner on 2026-08-18 into a named set rather than a generic
category list: sailing (catamaran, snorkelling, sunset, dinner, Jolly Pirates);
the natural pool / Conchi excursion; the animal sanctuary when young kids are in
the group; jet ski / watersports / kitesurfing when teens are in the group and
budget and adventure appetite allow; and snorkelling free or paid according to
what the traveller's average daily spend allows. Diving and the day-pass attractions were moved
out of the must-do set and behind the Swap this button.

Two of the five named categories have **no supply in this catalog**, measured:
deep sea fishing resolves to one 2-review kayak fishing tour and one private
charter, and party bus / pub crawl returns zero titles. The whitelist below is
therefore four families plus a hand-picked attraction list, not five categories.

## 1. What counts as a bookable

New predicate `isBookable(entry, tags)` — note the second argument. The set is
**persona-conditional**, not flat: the owner's specification on 2026-08-18 makes
three of the families contingent on who is travelling and on what they can
spend. It is also **two-tier**: a curated must-do set that has first claim on the
trip's booking days, and a contingent set that is placed only if days remain.

### Tier 1 — the curated must-do set

| # | family | identified by | items | condition |
|---|---|---|---|---|
| 1 | sailing | `activityKind === 'sail'` + curated `boca-catalina-snorkel`, `antilla-wreck-dive` | 33 | everyone |
| 2 | natural pool / off-road | `activityKind === 'offroad'` **and** title names the vehicle family, + curated `natural-pool-jeep` | 72 | everyone |
| 3 | snorkelling | `activityKind === 'snorkel'`, title names water or a boat, **minus De Palm Island** | 35 | everyone — spend decides, see below |
| 4 | animal sanctuary | product `7389P10` | 1 | young kids in the group |
| 5 | teen watersports | product `137607P22` (jet ski) + curated `kitesurfing-lesson` | 2 | teens in the group **and** `high-adventure` |

Row 1 covers what the owner named as catamaran, snorkelling, sunset and dinner
sails. Both **Jolly Pirates** products are already in it and need no special
handling — the Afternoon Sail with Snorkeling ($89, 529 reviews) and the Sunset
Sail with Open Bar ($70, 464 reviews) both classify as `sail`.

Row 2 is deliberately the whole jeep/UTV family rather than only the 20 products
that name the natural pool. Of the 72, 50 clear the 25-review champion floor;
the 20 that name Conchi are led by a $139 Jeep Safari with 9,997 reviews, but
the island's single most-booked off-road product — *Aruba UTV & ATV Adventure*,
**8,816 reviews** — never says "natural pool", and *UTV Tour with Natural Cave
Pool and Cliff Jumping* (5,353 reviews) goes to one without using the words. The
title does not reliably say where a tour goes.

Row 3 needs the same title guard as row 2, and for the same reason. Of 44
`snorkel` items, 8 name no water or boat at all. Three of those clear the review
floor and are precisely the products this change exists to stop: **Aruba Baby
Beach Express Tour** ($55, 111 reviews) and **Baby Beach Day Roundtrip** ($40, 51
reviews) are shuttles to a beach the plan already carries as a free curated card,
and *Half-Day Aruba Sightseeing Tour & Beach in an Air-condition Bus* ($55, 87
reviews) is a bus tour. Requiring a positive water word — snorkel, catamaran,
sail, cruise, boat, charter, seabob, reef, wreck, sea scooter, plus island / day
pass so day passes are not caught by accident — keeps 36 and drops all three.

One carve-out is then required. **De Palm Island passes row 3 on its own merits**
— Viator tags it for snorkelling and its title contains "Island" and "Day Pass"
— which would make it available to every traveller and quietly override the
audience rule set for it in tier 2. It is therefore excluded from row 3 by
product id, leaving 35, and governed solely by its tier 2 entry. Without this the
tier 2 condition would be unreachable code.

That two of the five families needed a title guard is worth stating plainly:
`activityKind` is a good dedup key and a poor eligibility filter. Its buckets are
built from Viator tags, and Viator tags describe what a product touches rather
than what it is, so an air-conditioned bus that stops at a snorkelling beach is
tagged for snorkelling. Any future family added to this whitelist should be
audited by title before it is trusted.

Row 3 carries the owner's rule that snorkelling is free or paid depending on
budget, and **this needs no new code at all.** Clarified 2026-08-18: a dedicated
snorkelling trip may be suggested to a budget-conscious traveller as long as
average daily spend stays around $55–60. That is exactly what the existing
trip-wide pool already enforces — `BUDGET_AVG_OVERRIDE = { budget: 60 }`, turned
into a pool of $60 × days, so a 10-day budget trip has $600 to spend across four
bookings and a $57 snorkelling trip fits comfortably.

It is a real ceiling for this tier rather than a suggestion, which is the part
worth checking before resting a rule on it: `runLadder` returns null at
`maxPrice === 0 || ctx.tags.has('budget')` rather than falling through to the
over-budget rungs. That guard was added on 2026-08-17 after a measured leak — a
pool of $30 admitting a $90 outing and going to −$60 — and it applies to the
cheapest tier only.

So no persona condition on this row. A budget traveller who cannot afford a
snorkelling trip within their pool simply gets the free curated shore snorkels
that already fill their non-booking days: Tres Trapi, Malmok Beach and Boca
Catalina.

Row 4 is one product. The Half-Day Aruba Animal Sanctuary Guided Tour ($57, 201
reviews) is the only usable one; Philip's Animal Garden exists at $20 but has 5
reviews and cannot clear the champion floor. It classifies `sec:adventures-outdoor`,
so no kind rule can reach it — it is on the list by product id.

Row 5 is two cards, and the supply is thinner than the category name suggests.
**There are zero kitesurfing products in the Viator catalog** — the only kitesurf
item on the site is the curated local at $120, adventure 85. There is exactly one
jet ski product ($58, 214 reviews). Parasailing has one product with 1 review,
below the champion floor, so it is unreachable whatever the whitelist says.
Seabob reef tours ($97 and $120, ~220 reviews each) are already reachable through
row 3, since they classify as `snorkel`.

On row 5's gating: **budget needs no new code.** The existing per-item ceiling
already excludes the $120 kitesurfing lesson from the budget tier ($110 cap) and
admits it from mid-range up. Only the adventure gate is new, set at
`high-adventure` — the slider above 66. "Teens in the group" uses the same
definition the balanced template already uses for its `kids` alternative type,
i.e. `family-young-kids` or `family-teens`, narrowed here to `family-teens`.

### Tier 2 — contingent extras

Placed only if booking days remain after tier 1 has had its pick. Anything that
does not fit stays available behind the card's **Swap this** button.

- **Atlantis Submarine** (`2455SUB`, $112, 1,255 reviews) — **young kids only**
  (`family-young-kids`), not teens. Classified `sec:cruises-water`, so it is
  invisible to every kind rule and is listed by product id. This is also what
  keeps the balanced template's day-7 kids swap working for its intended
  audience.
- **De Palm Island day pass** (`2455P18`, $135, 371 reviews) — **young kids or
  teens**, and only when the budget allows. "Budget allows" needs no new code:
  $135 is above the budget tier's $110 ceiling and below mid-range's $200, so
  the existing per-item cap already draws that line.

The two therefore need different audience predicates, and they must be named
distinctly. The balanced template's existing `altTypesFor` treats
`family-young-kids` and `family-teens` alike under one `kids` type; De Palm
Island matches that, the submarine does not. Reusing the word "kids" for both
meanings is how this gets broken later.

### Flamingo Beach: removed from the bookable set

The owner asked for this to be double-checked and the check is decisive.
**Zero of 328 Viator products name Flamingo or Renaissance in the title.** Seven
mention flamingos in a description — including the De Palm Island pass, which
has its own — but nothing sells the Renaissance Island day pass. It can only be
booked direct with the hotel, so it can never produce a click or a commission,
and the owner's point that real spend exceeds the $125 pass (drinks are dear
there) means the sticker price understates it.

`flamingo-renaissance` therefore stays a curated advice card and is **not** a
bookable. It does get a direct booking link — see section 7. Its "book direct, weeks ahead, and budget past the pass price" note is
exactly the kind of thing the separate honesty layer exists to say out loud.

### Diving is deliberately out

13 products, 4 clearing the review floor, median $104. The owner's call is that
a dive does not belong in the curated must-do set but **should be offered when
an adventurous traveller presses Swap this**. That needs no new code and one new
constraint: `isBookable` is consulted in the generator only, and never in
`refaceForAnswers`, which builds the swap shelf. That function filters by
time-of-day and by fit alone, with no notion of a whitelist, so a dive stays
reachable there today. A test must pin that down, because moving the whitelist
one call site further out would silently delete diving from the site.

### Curated locals

The 26 curated locals carry no Viator kind, so the 9 paid ones get a hand-set
marker:

- **Bookable:** `antilla-wreck-dive` ($60), `boca-catalina-snorkel` ($65),
  `natural-pool-jeep` ($75), `kitesurfing-lesson` ($120, teens + high-adventure
  only).
- **Not bookable:** `flamingo-renaissance` ($125, see above), `arikok-hiking`
  ($11) and `oranjestad-walking` ($25) — an entry fee and an optional guide, not
  advance bookings — plus `zeerovers-fresh-catch` and `gasparito-restaurant`,
  already excluded as meals.

Keeping the $11 Arikok gate out matters more than its price suggests: at
adventure 55 it is the most adventurous near-free item in the entire curated
set, and spending a booking slot on a park gate would be the change costing the
most for the least.

### Relationship to `MAX_PAID_OUTINGS_PER_DAY`

That rule is **unchanged**. It answers a different question — how much a single
day asks of you — which is why the owner ruled the Arikok gate, the Flamingo
pass and the kitesurfing lesson into it on 2026-08-15. A kitesurfing lesson
still spends the day's one paid-outing slot on intensity grounds while not
necessarily being one of the trip's four bookables. Two overlapping predicates,
two distinct purposes; neither replaces the other.

### What this excludes

Taking the union across every persona — nobody sees all of it, since three
families are conditional — **144 of 328 Viator products are eligible for someone
and 184 are eligible for no one.** Everything outside tiers 1 and 2 becomes
ineligible for auto-placement as a paid outing. It remains reachable through Explore and through the manual Swap and
add-from-shortlist paths, which are uncapped by deliberate prior decision.

The two largest excluded buckets are led by their most popular members:
`sec:tours-sightseeing` by a $55 Half-Day Island Tour with 1,485 reviews, and
`sec:cruises-water` by a $59 Full-Day History and Landmarks Tour with 1,596
reviews. Both are bus tours. High review counts are not evidence they belong —
they are exactly what a local tells you to skip and drive yourself, and their
popularity is the reason the ladder reached them.

Also excluded, with the counts clearing the 25-review floor: kayak (24 items, 12
clearing), horseback (16, 11), guided hike (9, 4), food & drink tours (10, 2),
e-scooters and vehicle rentals (16, 8). Each is defensible in isolation;
together they are how a five-category island grew nine bookings.

## 2. The schedule

`bookingDays(nDays)` returns the days permitted to carry a booking. Take
`round(nDays / 2.5)`, clamp to 1–6, then fill the latest non-consecutive days in
the window `[2, nDays-1]`, capped by how many that window can hold.

| trip | bookings | days | | trip | bookings | days |
|---|---|---|---|---|---|---|
| 1 day | 1 | 1 | | 8 days | 3 | 3, 5, 7 |
| 2 days | 1 | 2 | | 9 days | 4 | 2, 4, 6, 8 |
| 3 days | 1 | 2 | | **10 days** | **4** | **3, 5, 7, 9** |
| 4 days | 1 | 3 | | 11 days | 4 | 4, 6, 8, 10 |
| 5 days | 2 | 2, 4 | | 12 days | 5 | 3, 5, 7, 9, 11 |
| 6 days | 2 | 3, 5 | | 13 days | 5 | 4, 6, 8, 10, 12 |
| 7 days | 3 | 2, 4, 6 | | 14 days | 6 | 3, 5, 7, 9, 11, 13 |

Produced by a reference implementation run over all 14 lengths, not by hand.

Every rule except the count falls out of this construction rather than being
enforced separately: arrival and departure days are outside the window,
non-consecutive is what "latest non-consecutive" means, and with alternating
days every other day is free of bookings, so "at least one unstructured middle
day" needs no code of its own.

Two deliberate departures from the owner's note:

- **A 10-day trip gets 4, not "4 or 5."** Placing 5 non-consecutive days inside
  a 7- or 8-day window is arithmetically impossible; the first trip length that
  reaches 5 is 12 days. The note's "days 2 through 8" is tighter still — inside
  it, 4 non-consecutive days has exactly one solution, `{2,4,6,8}`, which is
  front-loaded and contradicts the note's own late-bias rule. Opening the window
  to day `nDays-1` is what makes the late bias expressible.
- **Very short trips drop the departure-day rule.** The window is
  `[2, nDays-1]` for `nDays >= 3`, `[2, 2]` at `nDays = 2` and `[1, 1]` at
  `nDays = 1`. On a two-day trip day 2 *is* the departure day, and on a one-day
  trip day 1 is both arrival and departure — so the rule is dropped rather than
  taking those trips to zero bookings. The generator already makes the same
  exception in the other direction, exempting single-day trips from the day-1
  free-only rule on the grounds that the traveller has no other day.

The schedule is **fixed, not seed-varied**. There is no Regenerate button: both
app call sites build plans at seed 0 (`Itinerary.tsx:77` passes no seed,
`Map.tsx:176-178` pass `{ seed: 0 }`), so a seed-weighted pattern chooser would
produce one pattern in production while carrying a weighting table and tests for
machinery nothing can trigger. Swapping "always the latest" for "pick by seed"
is a one-line change inside `bookingDays` if a Regenerate button ever ships.

## 2b. Does the whitelist supply enough bookings?

Worth checking, because the engine already retires a *route family* after one
placement trip-wide and a narrow whitelist could collide with that. The families
tier 1 can claim are `day-sail`, `evening-cruise`, `natural-pool` and `offroad`
— and below `SECOND_SAIL_MIN_DAYS` (8) the first two collapse into a single
`sail`. Day passes are exempt: `isFullDayProduct` returns no family at all, so De
Palm Island never competes with the catamaran.

| trip | booking days | tier 1 families available | fit |
|---|---|---|---|
| 7 days | 3 | sail, natural-pool, offroad = 3 | exact |
| 10 days | 4 | day-sail, evening-cruise, natural-pool, offroad = 4 | exact |
| 14 days | 6 | the same 4 | 2 days unbooked unless tier 2 or a conditional family applies |

The two shorter cases land exactly, which is a good sign the density rule and the
variety rules were reaching for the same number from different directions. At 14
days a couple with no kids will simply book four times rather than six — the
floor is a floor, not a quota, and under-booking is the direction this change
pushes anyway.

A family with kids at 14 days has more: the animal sanctuary, the submarine and
the De Palm Island pass are all outside those four families, so they can fill the
remaining days without repeating a route.

## 3. Where it is enforced

Five paths place paid items, in this order: pins → balanced template → premium
splurge → staples → the fill ladder. A schedule enforced in the ladder alone
would be outflanked by the four pre-passes, which place unconditionally. All
five therefore consult the same `bookingDays` set and the same remaining-count
counter, held on `Ctx` alongside `budgetLeft`.

**Pins are exempt but still count.** A traveller who explicitly shortlisted a
tour keeps it wherever it lands, and it spends one of the four. This mirrors the
existing treatment of pins against the budget pool: budget-exempt, but they
debit it so normal fill respects what they consumed.

**Tier 1 has first claim.** A tier 2 extra may take a booking day only once no
tier 1 family that applies to this traveller can still be placed on it. Without
that ordering a family with kids could spend day 3 on the submarine and reach
day 9 with no catamaran, which inverts the owner's priority. The counter is
therefore consulted twice: once to ask whether any booking days remain, and once
to ask whether tier 1 still has an unplaced family that fits the day.

Anything that does not fit — a tier 2 extra with no day left, or a dive, which is
never auto-placed — stays available behind the card's **Swap this** button. That
requires `isBookable` to be consulted in the generator only. `refaceForAnswers`
in `itemFit.ts` builds the swap shelf and must not learn about the whitelist.

## 4. Template reconciliation

The balanced template places two bookables by construction, bypassing the fill
ladder entirely: `antilla-wreck-dive` on day 2 and `natural-pool-jeep` on day 4.
Both are whitelist families. Rather than move hand-curated entries — whose day
placement carries geography and day-theme reasoning documented in
`balancedTemplate.ts` — the template's booking days are **pinned into the
schedule first**, and the remainder fill latest-first from the legal days that
remain. A balanced 10-day traveller therefore gets `{2, 4, 7, 9}`; every other
persona gets the plain latest pattern. Only `isBalancedTraveller` travellers are
affected, which is the same ~8% of answer combinations the template already
gates on.

One consequence to accept rather than fix: the template's day-2 *kids*
alternative (`7389P10`, Animal Sanctuary, $57) is not a whitelist family and
sits on a day whose morning already carries the wreck snorkel. It is blocked by
the existing one-paid-outing-per-day rule and falls back to the default
`alto-vista-chapel`, which is free. The day-7 kids alternative — the Atlantis
Submarine — is on the attraction list and on a booking day, so it survives.

## 5. Explicitly out of scope

- **Ranking.** The schedule decides *where* and *how many*; the existing fit
  score still decides *which*. The owner's "optimize for the memorable expensive
  thing, not for coverage" is a ranking change that interacts with the trip
  budget pool and deserves its own measurement.
- **The free-alternative honesty layer** ("you can pay for a tour to Baby Beach,
  but honestly just drive"). Separate cycle; needs editorial data per bookable.
- **Persona-fit scoring.** The development log records that group type never
  scores an individual item and that Viator's kid-friendly tag covers 2 of 337
  products. Separate cycle, partly data-blocked.
- **Free adventure content.** 17 of 26 curated locals are free and 13 of those
  are beaches; the free non-beach content tops out at Bushiribana Coastal Walk
  (adventure 50). So an adventure-85 family's six non-booking days will read
  much like a beach-and-chill family's. This is a content gap, not an engine
  gap, and closing it means writing self-guided north-coast content into the
  curated set.

## 6. Verification

Unit tests on `bookingDays()` across all 14 trip lengths, and on
`isBookable(entry, tags)` over both the offline stub and the live catalog —
including the 16 `offroad` items and the 8 `snorkel` items the title filters must
drop, both Jolly Pirates products they must keep, and the four hard-coded ids.

Because the set is persona-conditional, the same item must be asserted in both
directions: the animal sanctuary is a bookable for a family with young kids and
not for a couple; the jet ski and the kitesurfing lesson are bookables for
high-adventure teens and not for anyone else; the submarine is a bookable for
young kids and **not** for teens, while De Palm Island is a bookable for both. A
one-directional test here would pass against a predicate that ignores its `tags`
argument entirely.

De Palm Island needs one test of its own, asserting it is **not** a bookable for
a childless traveller. It reaches row 3 through Viator's own snorkelling tag, so
a carve-out removed by a later refactor would silently hand it to everybody and
nothing else would fail.

Two exclusions need their own tests, because both are the kind of thing a later
change re-introduces by accident: `flamingo-renaissance` is never a bookable,
and diving is never auto-placed but **is** still returned by
`refaceForAnswers` for an adventurous traveller. That second test is the one
guarding the Swap shelf — moving the whitelist one call site further out would
silently delete diving from the site.

Plan-level invariants across personas × seeds, in the style of
`engineCoverage.test.ts`: bookable count ≤ the trip's cap, none on day 1, none
on the final day, no two on consecutive days, and every bookable in a whitelist
family.

Every test mutation-checked in both directions per the project rule — break the
code, confirm the test goes red, restore. Several tests in this repo passed
against deliberately broken code before that habit.

`tools/plan-diff.ts` imports `isBookable` and `bookingDays` rather than
mirroring them. That file's header records what mirroring costs: a previous copy
used `isWaterBased` for the boat cap and reported violations that were not
violations.

Four product ids are hard-coded — the animal sanctuary, the jet ski, the
submarine and the De Palm Island pass — and a catalog refresh can silently
invalidate any of them. One test asserts every id still resolves against the
live catalog; a failure there means the list needs re-curating, not that the
code broke.

## 7. A direct booking link for Flamingo Beach

Requested 2026-08-18, and it is the direct consequence of section 1's finding
that no Viator product sells the Renaissance Island day pass. The card says a
pass books out weeks ahead and then gives the traveller nowhere to go. The
operator's own booking page is <https://renaissancearuba.idaypass.com/> —
verified to return 200 with no redirect.

### Why it cannot reuse `viator_item_url`

`Activity` already has a `viator_item_url` field, but every surface that renders
it passes it through `viatorLink()`, which appends `medium=link` — an affiliate
parameter. Attaching that to a hotel's own booking site is meaningless at best,
and it muddies the project invariant that affiliate parameters belong on Viator
URLs and must survive any rewrite. A commission-bearing link and a courtesy link
are different things and should not share a field.

So: a new optional `bookingUrl?: string` on `Activity`, holding a direct,
non-affiliate booking URL, never passed through `viatorLink`.
`flamingo-renaissance` is its only holder today.

### One helper, not a sixth copy

The expression deciding a curated card's book link is currently duplicated at
five call sites — `ItineraryCard.tsx:49`, `Explore.tsx:452`,
`Dashboard.tsx:117` and `:137`, `SurpriseMe.tsx:54` and `:79` — each some form
of `viator_item_url && cost > 0 ? viatorLink(...) : null`. Adding a second
source of truth to five near-identical expressions is how they drift; the repo
already carries scar tissue from exactly that (see the `tools/plan-diff.ts`
header).

Introduce `bookUrlForActivity(a): { url: string; affiliate: boolean } | null`
beside `viatorLink` in `exploreItems.ts`. It prefers the affiliate Viator link
when there is one and the activity costs money, falls back to `bookingUrl`, and
returns null otherwise. The five sites call it.

This is wider than the literal request and is included deliberately: adding the
field at one call site would put the link on the itinerary card and leave it
missing from Explore, the Dashboard and Surprise Me, which is a bug a traveller
would notice before we did.

### Label

The `affiliate` flag exists so the button can be honest about what it is.
A Viator link keeps **Book now**; a direct link reads **Book direct ↗**. That
costs nothing and it is the same instinct as the free-alternative layer — the
traveller can see that this one is not us selling them something.

### Verification

A render test that the Flamingo card shows a working direct link and does **not**
carry `medium=link`, and a test that a Viator-linked curated activity still
does. The second is the one that matters: it is the guard on the affiliate
invariant, and it must be mutation-checked by pointing the helper at the wrong
branch and confirming it goes red.

## 8. Expected effect

The adventurous family goes from 9 bookables to 4. The jet ski, e-scooter
island tour, horseback ride, kayak tour, walking tour and sip-and-paint all
become ineligible — that last one being the reported symptom.

The balanced couple goes from 5 bookings on 5 consecutive front-loaded days to 4
on days 2, 4, 7 and 9.

Trip spend should fall from ~$972 toward roughly $400–500, well under the
mid-range pool, which means the four that remain can be better rather than
cheaper. **That figure is a projection, not a measurement** — which four
bookings survive depends on ranking, which this change does not touch. Measure
it on the live catalog once implemented rather than quoting it.
