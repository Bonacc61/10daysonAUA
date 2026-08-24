# Options A–F

Build / partner / buy across the whole spectrum, scored with ICE (Impact × Confidence ×
Ease, each 1–10, higher is better).

## A. Status quo + editorial links (baseline)

Keep curating restaurants, link to their sites, earn nothing directly. Value accrues as
trust and traffic, monetized via Viator activities.

- **For:** zero cost; trust is the whole brand.
- **Against:** leaves the evening third of every itinerary unmonetized forever.
- **ICE:** 2 × 10 × 10 = **200** (as a floor, not a strategy)

## B. OpenTable affiliate deep links + Viator evening inventory

Join OpenTable's affiliate program; every curated restaurant that's on OpenTable gets a
"Reserve a table" deep link. In parallel, make sure commissionable Viator evening products
(sunset dinner cruises, food tours) compete fairly for evening slots — that rail already
pays and already exists in the catalog.

- **For:** days of work; instruments demand (outbound clicks per restaurant become sales
  collateral for option C); traveller gets real availability without us holding any PII.
- **Against:** payouts are pocket money at our traffic (~€2–5k/yr ceiling, see 01); only
  covers restaurants OpenTable lists; we hand the customer relationship to OpenTable.
- **ICE:** 4 × 9 × 9 = **324** → **do immediately**

## C. Direct partnership program — featured placement + tracked referrals

Approach 5–10 restaurants with our click data. Two SKUs: (1) **featured placement** — flat
€75–150/mo for priority in the engine's evening picks, a richer card, photos; (2)
**tracked referral** — UTM'd link or "mention 10daysonaruba" phrase, per-party fee. Plain
one-page agreements, invoiced from the existing business.

- **For:** best revenue per unit of traffic (€13–27k/yr at 15 restaurants); no booking
  infrastructure; restaurants get exactly what they actually lack — qualified tourist
  visibility; deepens moat (exclusive photos, menus, off-menu perks for our travellers).
- **Against:** it's B2B sales in another country (email/WhatsApp works, but it's a
  founder-time sink); **editorial-integrity risk** — paid placement inside an engine that
  claims to pick what fits the traveller must be labeled (Dutch/EU consumer law requires
  disclosing paid ranking anyway) and capped, or it corrodes the trust that makes the
  channel worth paying for.
- **ICE:** 8 × 6 × 6 = **288** → **stage 2, after click data exists**

## D. Concierge "request a table" (Wizard of Oz)

A form on the evening card: name, party size, time, dietary notes → relayed to the
restaurant (email/WhatsApp, `contact-notify`-style edge function) → restaurant confirms →
traveller gets a confirmation email. No availability engine; a human loop dressed as a
feature.

- **For:** tests the riskiest product assumption — *do travellers want to book inside the
  itinerary at all?* — for ~a week of build; creates the booking relationship in our name;
  natural upsell for option C partners.
- **Against:** manual ops with confirmation latency (a tourist wants certainty, not "we'll
  get back to you"); **first option that collects new PII** — and dietary notes can be
  health data under GDPR (explicit consent, minimization, retention — see 03); no-shows
  hurt restaurant relationships and we have no deposit mechanism.
- **ICE:** 7 × 5 × 5 = **175** → **stage 3, only after C proves restaurant pull**

## E. White-label an existing reservation stack, rev-share

Partner with an existing provider (approach Zenchef/SevenRooms/regional players) to embed
their widget under our brand, negotiating a referral share.

- **For:** real-time availability without building it; someone else runs support.
- **Against:** Aruba coverage of EU-centric providers is thin to nil; rev-share on a
  three-party deal at our volume is rounding error; we'd be selling *their* SaaS to Aruban
  restaurants — the hard part (supply acquisition) stays ours, the margin doesn't.
- **ICE:** 5 × 3 × 4 = **60** → **investigate only if D shows strong booking intent**

## F. Build the Zenchef-style platform ourselves

Two-sided: traveller-facing real-time booking + restaurant-facing table/availability
management, per-cover or SaaS fees, deposits for no-shows.

- **For:** owns the whole margin and the whole relationship; defensible if it wins;
  islands are small enough that one determined player *could* consolidate supply.
- **Against:** 6–12+ months solo build (availability engine, restaurant dashboard,
  payments/PCI via Stripe, no-show policy, a support desk restaurants will phone during
  Saturday service); classic two-sided cold start — restaurants join for diners we don't
  yet have, diners book where restaurants already are (OpenTable); it competes with the
  incumbent's core, not its gap; and it starves the actual product before its launch.
- **ICE:** 9 × 2 × 1 = **18** → **park, with written go-criteria (see 03)**

## Ranking

**B (324) → C (288) → A (200) → D (175) → E (60) → F (18).**

The ladder in 03 is exactly B → C → D, with E/F as gated future options. Note the pattern:
the options rank inversely to how much infrastructure they require — because our scarce
resource is founder time and traffic, not software.
