# Roadmap

Open work for 10daysonaruba.com. Durable facts and invariants live in
`.claude/CLAUDE.md` — keep mutable state here so that file can stay trustworthy.

## Open

| # | Item | Notes |
|---|---|---|
| 1 | `feedback_events` retention cron (24 months) | Table exists (`supabase/migrations/20260523230000_feedback_events.sql`); no purge job yet. Contact submissions already purge at 12 months — mirror that pattern. GDPR: retention needs to match what the Privacy Policy claims. |
| 2 | Shortlist + explore event tracking (PostHog) | No `track()` calls on star/shortlist/explore paths today. Must go through `src/lib/analytics.ts`; new events need a legal basis documented in `src/pages/Privacy.tsx`. |
| 3 | Vendor dashboard | Read-only Supabase query page. RLS stays on — scope access with a policy, never a service-role key in the client. |
| 4 | In-app account deletion button | GDPR right to erasure. Needs to cover `trips`, `feedback_events`, `shared_itineraries`, and the auth user. |

## Matching engine — open items

Tracked in detail in `docs/matching-engine/development-log.md`:

- Embedding clustering **is live** (verified 2026-08-02: all live items carry an
  `experience_cluster_id`). Over-clustering was investigated and ranks third
  behind the pool rule and catalog size — see "What actually limits plan variety"
  in the dev log.
- **Catalog size is the real variety ceiling.** 74 of 161 distinct experiences
  have a member with 25+ reviews (champion pool ~83), so a 14-day trip (~36
  picks, cluster retired on first use, further narrowed per persona by slot,
  section, budget and geo) still cannot fill. Broader Viator taxonomy ingestion
  is the fix; no constant will do it.
- Same-day cross-slot: two items from one Viator group can land on the same day.
  `similarReason` consults `usedGroupIds` only for items with neither tags nor a
  cluster id, so two *tagged* items from one group are caught only if tag Jaccard
  clears the threshold.
- Tag sparsity: items with `tags: []` and no cluster id fall back to
  `usedGroupIds` + `lastUsedDay` only — no cluster or Jaccard dedup.
- `TAG_SIMILARITY_THRESHOLD = 0.35` set conservatively, never tuned against the
  live catalog.

## Shipped

- OG meta tags + og-image → `f0f3500`
- Cookie consent banner, GDPR-gated analytics → `f0f3500`
- Terms of Service page → `8e0ab08`
