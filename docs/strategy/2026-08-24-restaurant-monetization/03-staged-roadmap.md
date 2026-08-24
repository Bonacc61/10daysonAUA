# Staged roadmap — earn the right to build

Lean-startup framing: each stage tests the *next* riskiest assumption as cheaply as
possible, with a numeric gate. No stage starts before the previous stage's gate passes.

## Riskiest assumptions, in order

1. **Travellers act on our evening picks.** (If nobody clicks "reserve", nothing
   downstream matters.) Test: outbound click instrumentation. Cost: hours.
2. **There is enough traffic for restaurants to care.** Test: the Reddit launch itself.
3. **Restaurants will pay for our demand.** Test: 5–10 conversations armed with click
   data. Cost: founder time only.
4. **Travellers prefer booking inside the itinerary over the restaurant's own channel.**
   Test: concierge flow (Wizard of Oz). Cost: ~a week.
5. **Restaurants are underserved by their current booking tools.** Only if 1–4 all hold
   does the Zenchef question even become real.

## Stage 0 — instrument + free rails (this sprint, pre-Reddit)

- PostHog event on every outbound restaurant click (restaurant id and link kind — **no
  free text**, per house rules; day/slot deliberately deferred, see 04-stage0-status.md),
  consent-gated as always. Note: `VITE_POSTHOG_KEY` is
  currently empty in `.env.production` (roadmap items 2/18/20 share this blocker) — this
  is one more reason to turn collection on *before* the launch.
- "Reserve a table" links: OpenTable affiliate deep link where the restaurant is listed;
  otherwise the restaurant's own booking page or WhatsApp. Apply to OpenTable's affiliate
  program now — approval takes time.
- Audit evening-slot competition so commissionable Viator evening products (dinner
  cruises, food tours) appear where they genuinely fit — that rail already pays.

**Gate to stage 1:** sustained outbound restaurant clicks after launch — order of
≥50/week. Below that, the story to restaurants isn't credible yet; keep growing traffic.

## Stage 1 — direct deals (post-launch, weeks)

- Pick the 10 most-clicked curated restaurants. Pitch: "N travellers per week click
  through to you from our itineraries" — featured placement €75–150/mo, or per-referral.
- One-page agreement, normal invoicing. **Label paid placement in the UI** (EU consumer
  law requires disclosing paid ranking; the brand requires it more).
- Cap: paid status may break ties, never override fit — the engine's pick must stay
  defensible by `itinerary-trace`.

**Gate to stage 2:** ≥5 paying restaurants, or several saying "we'd rather pay per
booking" — that sentence is the demand signal for a booking flow.

## Stage 2 — concierge booking (months, only if pulled)

- Form on the evening card → edge function relays to restaurant (email/WhatsApp) →
  manual confirm → traveller notified. No availability engine.
- **GDPR checklist before a single field ships:**
  - New PII: name, contact, party size, date/time. Legal basis: performance of a
    contract (the traveller asks us to arrange the booking). Document in
    `src/pages/Privacy.tsx`.
  - **Dietary/allergy notes are potentially health data (art. 9).** Either don't collect
    them (link "mention allergies to the restaurant") or collect behind explicit consent
    with aggressive minimization. Prefer not collecting.
  - The restaurant is an independent controller receiving the data — say so in the
    privacy policy; keep a list of recipient restaurants.
  - Retention: booking requests purge after the trip date + a short window, mirroring the
    12-month contact-purge pattern (a new cron, same shape).
  - House rule holds: **never log traveller free text** — the relay email may carry it,
    logs and DB store only structured fields.

**Gate to stage 3:** ≥30% of evening slots on active itineraries generate a request, and
restaurants confirm reliably (<2h median in season).

## Stage 3 — infrastructure decision (probably never; explicitly gated)

Reopen the build-vs-white-label question (options E/F) only when **all** hold:

1. Concierge volume exceeds what manual relay can handle (~>50 requests/week).
2. ≥10 restaurants have said they'd pay per booking or replace/add a booking tool.
3. OpenTable demonstrably fails them (fees, no-shows, coverage) — i.e., a gap, not a
   frontal fight.
4. The core product no longer needs the majority of founder time.

If they hold, the honest framing is that this is a **second company** (Aruba/Caribbean
restaurant SaaS with 10daysonaruba as its captive demand channel) and deserves its own
plan, funding math, and probably a local partner for restaurant onboarding and support.
Until then: sell demand, not software.

## What would change this recommendation

- A traffic step-change (10–50× the year-one assumption) makes per-cover economics real
  and shortens every gate.
- An existing provider offering a genuinely good white-label + rev-share for the
  Caribbean would let stage 3 happen without the build (option E leapfrogs F).
- OpenTable coverage in Aruba collapsing or fees spiking would open the supply-side gap
  that option F needs.
