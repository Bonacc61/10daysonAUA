# Restaurant monetization — brainstorm & recommendation

**Date:** 2026-08-24 · **Status:** brainstorm, no decision taken · **Question:** evenings are
filled with restaurants but earn nothing (no affiliate rail like Viator). Should we build a
Zenchef-style reservation infrastructure where restaurants pay for referrals from
10daysonaruba.com?

## TL;DR — sell demand, not software

Our asset is **aggregated, qualified dinner demand with context** (which night, party size,
dietary flags, area, budget — we know all of it from the questionnaire). Zenchef's asset is
**restaurant-side table-management software**. Those are different businesses. Building the
second to monetize the first is the expensive route to a market OpenTable already serves in
Aruba — and it puts a solo founder into two-sided-marketplace cold start, foreign B2B sales,
payments compliance, and a support desk, all before the Reddit launch has even proven the
demand side.

**Recommendation: a staged ladder that starts free and earns the right to build.**

1. **Now (days):** instrument outbound restaurant clicks (PostHog, consent-gated) and add
   "Reserve a table" deep links — OpenTable affiliate links where listed, the restaurant's
   own page/WhatsApp otherwise. Also lean on the rail we already have: Viator dinner
   cruises and food tours are commissionable evening inventory today.
2. **After launch (weeks):** take the click data to 5–10 restaurants and sell **featured
   placement + tracked referrals** (flat €75–150/mo or per-referral). This monetizes
   visibility without any booking infrastructure.
3. **If that works (months):** a concierge "request a table" flow — a form relayed to the
   restaurant, confirmation by email — as a Wizard-of-Oz test of whether travellers want
   to book *inside* the itinerary at all. This is the first step that collects new PII, so
   it carries a GDPR checklist.
4. **Zenchef-style infrastructure: parked**, with explicit go-criteria. Only worth
   revisiting if stages 1–3 prove restaurants will pay per booking *and* their existing
   tools fail them. It would effectively be a second company.

Each stage has a numeric go/kill gate — see [03-staged-roadmap.md](03-staged-roadmap.md).

## Files

| File | Contents |
|---|---|
| [01-market-and-unit-economics.md](01-market-and-unit-economics.md) | TAM/SAM/SOM, per-cover math, Five Forces, the peak-season problem |
| [02-options.md](02-options.md) | Six options A–F, build/partner/buy, ICE scoring |
| [03-staged-roadmap.md](03-staged-roadmap.md) | The ladder with gates, riskiest assumptions, GDPR checklist |

## The one number that frames everything

At realistic year-one traffic (~1,000 planned trips), pure per-cover affiliate economics pay
**€2–5k/yr**. Direct restaurant deals at €75–150/mo across 15 restaurants pay
**€13–27k/yr** on the same traffic. Neither justifies building reservation software; the
second justifies a sales effort. The math is in
[01-market-and-unit-economics.md](01-market-and-unit-economics.md).
