# Consent withdrawal + privacy-policy accuracy — design

**Date:** 2026-07-31
**Status:** Approved, ready for planning

## Problem

The `.claude/CLAUDE.md` post-launch checklist lists the cookie consent banner as
"not yet implemented, blocked task". That is stale — commit `f0f3500`
("feat: OG tags, cookie consent banner, GDPR-gated analytics") shipped it, and the
gating works. Exploring it to confirm surfaced three real defects the checklist
never named.

**1. The privacy policy contradicts the app.** `src/pages/Privacy.tsx` states:

- `:50` — "No advertising trackers. **No third-party analytics.**"
- `:77` — "a single session cookie to keep you logged in. **No tracking or marketing
  cookies of our own.**"

Both are false once a visitor clicks Accept. PostHog *is* third-party analytics and
sets its own cookies under the default `localStorage+cookie` persistence. PostHog is
absent from the "Third parties" list (Supabase / TransIP / Viator only), and the data
table has no analytics row — so consent as a legal basis is documented nowhere. This
is an Art. 13 transparency failure, made worse by the banner reading "We use analytics
to improve the app" while linking to a policy that denies it.

**2. Consent cannot be withdrawn.** GDPR Art. 7(3) requires withdrawal to be as easy
as giving. `CookieBanner.tsx:15` initialises `visible` from whether the consent key is
`null`, so once any choice is recorded the banner never returns, and no
cookie-settings control exists anywhere in the app.

**3. Declining mid-session does not stop tracking.** `CookieBanner.tsx:25-28` —
`decline()` writes `localStorage` and hides the banner, nothing more. If PostHog
already initialised this session, it stays `__loaded` and keeps capturing pageviews
and page-leaves until a reload. Any withdrawal control built on the current
`decline()` would be cosmetic: the user would be told they had opted out while
collection continued.

## Key facts that shape the design

- **The consent gate itself is sound.** `main.tsx:10` calls `initAnalytics()` only when
  `10doa:analytics-consent === 'true'`. Verified in `node_modules/posthog-js`: `capture()`
  is guarded on `this.__loaded && this.persistence && ...`, so the five unguarded
  `capture()` call sites (`Landing.tsx:399`, `Itinerary.tsx:153/204/277`,
  `Dashboard.tsx:739`) genuinely no-op when the user has never accepted. **No fix
  needed there** — defect 3 is strictly about revoking *after* init.
- **What PostHog receives today**, from `lib/analytics.ts` and its call sites:
  pageviews and page-leaves (`capture_pageview`/`capture_pageleave: true`);
  `contact_message_sent`; `itinerary_shared` (with `via: 'email'` from the dashboard);
  `itinerary_saved` (`trigger: 'auto' | 'manual'`); `account_created`; and the Supabase
  user UUID via `identifyUser()` for signed-in users only
  (`person_profiles: 'identified_only'`). **`autocapture: false`** — form field values
  are never captured. Host is `eu.i.posthog.com`, so data stays in the EU.
- **Consent has no owner.** The key is read three ways: raw `localStorage` in
  `main.tsx:10`, private `readConsent`/`writeConsent` in `CookieBanner.tsx:6-12`, and
  nowhere else can ask. A footer control would be a fourth reader.
- **`Footer` is rendered by 7 pages** — `Landing`, `Explore`, `Itinerary`, `Dashboard`,
  `Privacy`, `Terms`, `SurpriseMe` — none of which care about consent.
- **No DOM test stack.** No `jsdom`, no testing-library; the 10 existing suites are
  pure-logic node tests. Component tests would mean adding a test stack.
- **`opt_out_capturing()` does not delete existing cookies.** It stops capture and
  records the opt-out; cookies already set persist until expiry. There is no clean
  "delete all PostHog cookies" API.

## Decisions

- **Scope:** both the policy rewrite and the withdrawal control, plus the mid-session
  revocation fix that makes withdrawal real.
- **Withdrawal UI: a footer "Cookie settings" link that reopens the existing banner.**
  Withdrawal is then the identical two-button control that granted consent — the
  cleanest answer to Art. 7(3), since it is literally the same control. Rejected: a
  toggle on the Privacy page (asymmetric — granted by banner, withdrawn via a buried
  page; needs new toggle UI), and doing both (two entry points over one `localStorage`
  key, more to keep in sync for little gain).
- **Reach the banner by CustomEvent, not prop-drilling.** Threading an
  `onCookieSettings` prop through 7 uninterested pages to deliver one button is worse
  than a small window event. Footer's signature stays unchanged; the 7 call sites are
  untouched.
- **Retention: 12 months.** GDPR names no period — Art. 5(1)(e) requires only that data
  be kept no longer than necessary for the stated purpose. 12 months covers exactly one
  seasonal cycle, which is the minimum that lets high season be compared to high season
  on a travel site, so it is justifiable against the purpose. It also matches the
  contact-form retention already in the policy, keeping one retention story. The
  PostHog paid default of 7 years is retention by inertia and is not defensible for
  product analytics.
- **The policy must not over-claim on cookie deletion.** It says we *stop collecting*,
  not that we *remove existing cookies* — see the `opt_out_capturing()` fact above.
  Over-claiming would recreate the exact class of defect this work fixes.

## Design

### `src/lib/analytics.ts` — one owner for the consent key

Four exports, so nothing else reads `10doa:analytics-consent` directly:

- `hasConsent()` — `true` only when the key is `'true'`.
- `hasDecided()` — whether any choice is recorded. The banner needs `null`
  ("never asked") distinguished from `'false'` ("declined"); `hasConsent()` alone
  collapses them.
- `optIn()` — write `'true'`, then start collection (see the init/re-opt-in rule below).
- `optOut()` — write `'false'`; **then, only if PostHog actually initialised this
  session**, call `posthog.opt_out_capturing()` and `posthog.reset()`. This is the fix
  for defect 3 and must be safe to call when PostHog never initialised.

**Tracking whether PostHog initialised.** Do not read `posthog.__loaded` — it is an
internal. `initAnalytics()` sets a module-level `initialised` boolean, and only after
it has genuinely initialised (it already returns early when `VITE_POSTHOG_KEY` is
absent, so the flag must not be set on that path). `optIn()` and `optOut()` branch on
that flag.

**Accept → decline → accept within one session.** The reopenable banner makes this
reachable, and `posthog.init()` must not run twice. So `optIn()` calls
`initAnalytics()` when `initialised` is `false`, and `posthog.opt_in_capturing()` when
it is `true` — the latter reverses the `opt_out_capturing()` that `optOut()` applied.

Also add `requestConsentReopen()`, which dispatches a `window` CustomEvent
(`10doa:consent-reopen`). It lives here because this module already owns consent.

`main.tsx:10` switches from raw `localStorage` to `hasConsent()`. Behaviour unchanged.

### `src/components/CookieBanner.tsx` — controlled

Visibility moves up to `App.tsx`. The component takes `open` / `onClose` alongside the
existing `onPrivacy`, drops its private `readConsent`/`writeConsent`, and its handlers
call `optIn()` / `optOut()`. When reopened by someone who already accepted, both
buttons stay live so either choice is one click.

### `src/App.tsx` — owns banner state

`const [consentOpen, setConsentOpen] = useState(() => !hasDecided())` — identical
first-visit behaviour to today. An effect subscribes to `10doa:consent-reopen` and
opens the banner; it must remove the listener on unmount.

### `src/components/Footer.tsx` — the control

A third button beside Privacy Policy / Terms (`:80-92`), matching their existing style,
calling `requestConsentReopen()`. No prop changes.

### `src/pages/Privacy.tsx` — stop contradicting the app

- `:50` — drop "No third-party analytics." Replace with text saying analytics run only
  with consent and are never used for advertising. Keep the advertising-trackers claim,
  which is true.
- **Data table** — add a row: *Usage analytics · Understand which features get used ·
  **Consent** · 12 months*. The only row whose basis is consent, which is what makes
  the banner meaningful.
- **Third parties** — add PostHog: EU cloud (`eu.i.posthog.com`), no data leaves the EU,
  link to their privacy policy.
- **Cookies `:77`** — replace "No tracking or marketing cookies of our own" with an
  accurate description of the analytics cookies set *after* consent, and point at
  **Cookie settings** in the footer to withdraw. State that withdrawal stops further
  collection, without claiming existing cookies are deleted.
- State positively that autocapture is off, so form fields are never captured.
- Bump "Last updated".

## Testing

Tests sit at the layer carrying the risk — the consent helpers — against a stubbed
`localStorage`, in the pure-logic node style of the existing suites:

- `hasDecided()` returns `false` when the key is absent, `true` for both `'true'` and
  `'false'`. This is the null-vs-`'false'` distinction the banner depends on.
- `hasConsent()` is `true` only for `'true'`.
- `optIn()` / `optOut()` write the expected values.
- `optOut()` does not throw when PostHog never initialised.
- `optIn()` after `optOut()` re-opts-in rather than re-initialising (assert via a
  stubbed posthog module that `init` is called once and `opt_in_capturing` thereafter).

Adding `jsdom` + testing-library to cover the banner and footer wiring is scope creep
for this change; that wiring gets manual verification instead:

1. Fresh profile → banner appears → Decline → no PostHog network calls.
2. Accept → PostHog initialises → footer **Cookie settings** → Decline → capture stops
   **without a reload** (defect 3).
3. Reload after declining → banner does not reappear, PostHog does not initialise.

## Out of scope

- **Focus management on banner reopen.** The banner is a non-modal bottom bar and does
  not trap focus today. Worth a later a11y pass — it carries `role="dialog"` without
  `aria-modal` or focus handling, which is arguably the wrong role — but changing it is
  a separate concern from consent lawfulness.
- **The uncommitted Q8 conditional-flags work** in `src/App.tsx` and
  `src/pages/Questionnaire.tsx`. Left untouched in the working tree.
- The remaining CLAUDE.md checklist items (`feedback_events` retention cron, shortlist
  event tracking, vendor dashboard, in-app account deletion).

## Pre-ship blocker

**PostHog must be configured to a 12-month retention rule before this ships.** Writing
"12 months" into the policy is only true if PostHog enforces it — the same trap that
produced defect 1. Retention on PostHog Cloud is a project/plan-level setting and
could not be verified from the codebase. If the plan cannot enforce 12 months, state
the period it does enforce instead of aspirational text.

## Follow-up

`.claude/CLAUDE.md` is stale: items 1 (OG meta tags) and 2 (cookie consent banner) are
done. Update the checklist as part of this work so the next session does not re-derive
this.
