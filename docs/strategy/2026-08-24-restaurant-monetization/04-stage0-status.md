# Stage 0 — status and handoff (overnight build, 2026-08-24/25)

Constraint honoured all night: **production untouched.** Everything below is local
commits on `main`, not pushed (pushing deploys). Live site still runs the last
deployed build; local main is ahead by the strategy docs plus one feature commit.

## Built and verified

**`feat(evenings)` — reserve-a-table action on restaurant cards (`2bddf95`).**

- `Activity.reserve?: { url, kind: 'opentable' | 'web' | 'phone' }` — a
  restaurant's reservation channel, deliberately separate from `bookingUrl`
  (a reservation is not a paid booking, and the wording differs).
- The itinerary card renders it where "Book now" would sit: **"Reserve a
  table ↗"** for web/OpenTable links, **"Call to reserve"** (a `tel:` link) for
  phone-only places. Existing "Book now" behaviour untouched.
- Every click fires `restaurant_reserve_click` `{ id, kind }` — id and kind
  only, no traveller text. These per-restaurant counts are the stage-1 sales
  collateral.
- Gasparito — currently the only curated dinner spot — carries
  `tel:+2975867044`: it is **not on OpenTable** and takes phone reservations
  only (verified 2026-08-24; Wed/Sat dinner seatings, ~20 covers).
- Tests: red→green in `ItineraryCard.dom.test.tsx` (web-link + phone + absent
  cases, capture asserted via mock). Full suite 1392/1392. Build green.
  Rendered and screenshotted in the real built app at 1280px and 375px.

## Found while researching (changes what stage 0 links can be)

The OpenTable affiliate rail applies to NONE of the current curated food spots:
Gasparito is phone-only, Zeerovers takes no reservations, and the ten lunch
spots are walk-in counters. The rail becomes real only when OpenTable-listed
dinner restaurants join the evening catalog — which is exactly the "filling
evenings with restaurants" work already underway. Candidates below.

## Candidate dinner restaurants (research, not yet curated)

Confirmed ON OpenTable (a `reserve: { kind: 'opentable' }` link is possible):

| Restaurant | Area | Angle |
|---|---|---|
| Madame Janette | Noord | Fine dining, famous, Euro-Caribbean |
| Passions on the Beach | Eagle Beach | Toes-in-sand sunset dinner (Amsterdam Manor) |
| Elements (Bucuti & Tara) | Eagle Beach | Adults-only, romantic |
| Atardi (Marriott) | Palm Beach | Barefoot beach dinner |
| Patrizia's | Palm Beach | Family-style Italian tasting menu $60pp |
| On The Rocks | Palm Beach strip | Casual craft kitchen |
| Malmok Bar & Grill | Palm Beach | Fresh fish, ocean view, live music |
| Shore Club | Noord | Casual beach club |
| Bodegas Papiamento (distillery) | Oranjestad | Rum distillery in an old ice factory |

NOT on OpenTable (own channel or phone — still linkable, still countable):
Papiamento Restaurant, Flying Fishbone (Savaneta), Yemanja, Quinta del Carmen,
Wacky Wahoo's, The Old Cunucu House, Gasparito (phone), Zeerovers (no res).

Curation is an owner decision (photos in `public/`, the no-invented-quotes
rule, engine balance), so none were added to the catalog.

## Waiting on Jan

1. **Deploy decision** — local main carries the strategy docs + `2bddf95`.
   Ship gate applies: `/code-review` before pushing.
2. **PostHog key** — `VITE_POSTHOG_KEY` is still empty in `.env.production`,
   so the new event (and everything else) captures nothing. Same pre-launch
   blocker as roadmap items 2/18/20. The project API key is a public client
   key; it belongs in `.env.production`.
3. **OpenTable affiliate application** — a founder form, 2–3 week lead time,
   non-revenue until 100+ seated covers/month:
   https://www.opentable.com/restaurant-solutions/api-partners/become-a-partner/
   (affiliate terms at https://dev.opentable.com/partner-portal/terms).
4. **Pick dinner restaurants** from the candidate table (or name others) —
   each needs a photo, an honest blurb, and a `reserve` entry; OpenTable ones
   get their OpenTable URL so the clicks also count toward the 100-cover tier.

## Deliberate scope cuts

- The event carries no day/slot (id + kind is what stage 1 sells on); thread
  those through later if the analysis wants them.
- Explore tiles don't render reserve links yet — itinerary evening cards are
  where the strategy put them; parity is a small follow-up.
- No OpenTable `ref=` parameter constant yet: there is no ref id until the
  application is approved, and no OpenTable-listed restaurant in the catalog
  to carry it.
