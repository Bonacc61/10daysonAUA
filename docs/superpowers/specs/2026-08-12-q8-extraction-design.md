# Q8 free text → flags — design

**Date:** 2026-08-12
**Status:** Draft — approved in conversation, awaiting spec review
**Supersedes:** the free-text half of `docs/superpowers/specs/2026-08-11-natural-language-edit-design.md`. That feature ships retired rather than enabled; see "Retiring the swap box".
**Scope:** Read the Q8 "Anything else we should know?" note with a model and switch on the Q8 pills it justifies. Adds `supabase/functions/q8-extract`, `src/lib/q8Extract.ts`, and a blur handler in `src/pages/Questionnaire.tsx`. **No engine change** — the output is the same `answers.flags` array a tap produces. Ships behind `VITE_Q8_EXTRACT`, default off.

## Problem

`src/data/notesFlags.ts` reads the Q8 box with **three regexes**: seasickness → `no-boats`, wheelchair/limited mobility → `mobility`, no-car phrasings → `no-car`. They are deliberately narrow, and the file says why — *"a false exclusion is worse than a miss"* — which is also why bare `baby` is not matched, since "Baby Beach" is a real place.

The consequence is that most of what people actually write there does nothing. *"My mum uses a cane and we've got a two-year-old"* maps to zero flags: the phrasing misses `mobility`'s pattern list, and `with-baby` has no pattern at all. The traveller answered the question honestly and the plan ignored them.

This is the highest-leverage free-text surface in the app and the cheapest to improve:

- **The box already exists.** No new affordance, nothing to learn, and people already type in it.
- **It runs once per trip, not once per card** — the effort/reward ratio is inverted from the swap box.
- **It shapes the whole plan**, because `effectiveFlags()` feeds `applyCatalogFlags()` before generation.
- **Every output already has a tested consumer.** Nothing new has to learn what a flag means.

## Goal

A traveller who describes a constraint in their own words gets the plan a traveller who ticked the equivalent pills would get — and can see and undo exactly what was understood.

## Approach — the pills are the explanation

On blur of the Q8 textarea, if the text changed and is non-empty, extract flags and **switch on the matching pills**. Those pills sit directly below the box the traveller just typed in.

```
"my mum uses a cane and we've got a toddler"
        │
        ▼  edge function: q8-extract   (Claude, structured output, closed enum)
{ flags: ['mobility', 'with-baby'] }
        │
        ▼  setAnswers({ ...answers, flags: [...existing, ...new] })
   Mobility considerations  ●     Travelling with a baby  ●
```

No new interface, and no separate "we understood…" strip to build or keep in sync. The explanation of what the AI did is the control the traveller is already looking at, and it is **reversible by one tap** — untick a pill you disagree with, exactly as you would any other. A mis-parse becomes visible and cheap instead of invisible and load-bearing.

**Rejected alternatives.** Extracting silently at submit (during the 3.5s loading screen `Questionnaire.tsx:70` already fakes) is cheaper and shapes the trip with no way to see or correct it. A separate chip strip duplicates what the pills already say.

### The vocabulary

The existing Q8 pill ids, and nothing else. A value outside this set is a schema violation, not a new capability.

| Group | Flags |
|---|---|
| Prefer to skip | `no-boats`, `intense-hikes`, `no-early-mornings`, `avoid-crowds` |
| Good to know | `mobility`, `no-car`, `with-baby` |
| Celebrating | `honeymoon`, `birthday`, `work-trip` |

**`influencer` is deliberately excluded.** It is the only flag that *widens* the catalog rather than narrowing it — it lifts an exclusion and adds a scoring bonus — and it is an identity claim rather than a constraint. Inferring "you are an influencer" from prose is a different act from inferring "you cannot walk far", and it should stay a deliberate tap.

**Occasion flags are mutually exclusive**, per `OCCASION_SET` in `Questionnaire.tsx`. The merge applies the same rule the pill toggle does: a new occasion replaces any existing one; it never stacks.

**Known gap, pre-existing:** `avoid-crowds` is acted on nowhere in the engine — no filter reads it. Setting it from prose achieves parity with the pill, which also does nothing. Worth fixing, out of scope here, recorded in `docs/ROADMAP.md`.

### The regexes keep running

`flagsFromNotes()` is unchanged and unconditional. `effectiveFlags()` already computes ticked pills ∪ regex-derived flags, and extraction only makes more pills ticked — so the union happens where it always did.

This is what makes the dark period safe. `VITE_Q8_EXTRACT` will be **off** from the moment this merges until the sub-processor decision is made, and during that time the three regexes are the only thing reading the box. With the flag off, behaviour is byte-identical to today.

It also means the model can only ever **add** a flag, never remove one a regex set. That is the intended asymmetry: an over-narrow plan is recoverable with a tap, a boat trip sold to someone who wrote "I get seasick" is not.

## The edge function — `supabase/functions/q8-extract`

JWT verification ON (anon key required), matching every other function here.

**Request:** `{ text: string }` — max 100 characters, the cap the textarea already enforces. Nothing else is sent: no name, no email, no account, no itinerary, not even the group type.

**Response:** `{ flags: string[] }`, values constrained to the enum above by structured output.

**Model:** `claude-opus-5`, `effort: low`. This is closed-vocabulary classification of ≤100 characters.

**Rate limited** by reusing `edit_requests` with `feature: 'q8'` — the discriminator column added in `20260812090000_item_embeddings.sql`. Fails closed without `RATE_LIMIT_SALT`, and fails closed if the count query errors.

**Never logs `text`.** The extracted flags may be logged; the sentence may not.

### System prompt shape

The instruction is to be **conservative in the same direction the regexes are**: set a flag only when the traveller has stated the constraint, not when it might apply. "We're going with the kids" is not `with-baby`; "our two-year-old" is. An empty array is a correct and common answer.

## Privacy

**This is a smaller step than the swap box, and the reason is worth stating.** `specialNotes` is *already* stored — in `10doa:answers`, in the `trips` row for signed-in users, and it already feeds `hashAnswers()` so it already changes which plan you get. It is already stripped from public share snapshots (`shares.ts:27`).

So this adds a **transfer**, not a new stored artifact. Nothing new is written anywhere: the output lands in `answers.flags`, an array that already exists and already persists.

Still required before the flag flips: the Privacy Policy's "AI features" section names the swap box and search. It must name this box instead of the swap box, since that one is being retired.

## Retiring the swap box

`VITE_NL_EDIT` is never flipped. Removed: the free-text row in `SwapReasons.tsx`, `src/lib/edits.ts`, the `itinerary-edit` edge function, and the NL wiring in `Itinerary.tsx`.

**Kept:** `src/data/editConstraint.ts` and its 30 tests. The five chips run through `constrainByEdit` now, and that consolidation — one implementation of "narrow the pool" instead of two — is worth keeping on its own merits. `edit_requests` and its `feature` column stay; `search` and `q8-extract` both use them.

Rationale: the swap box asks a traveller to compose a sentence to change **one card**, when a chip does most of that job in one tap. High effort, low frequency, on an already-dense card. Q8 is the same idea with the effort/reward ratio the right way round.

## Failure

Silent. No flags added, the regexes still ran, the traveller sees nothing — there is nothing useful to tell them, because the box works either way and they never asked for a network request. No spinner, no error text, no blocked "Continue" button.

The one visible consequence of a failure is that pills do not light up, which is indistinguishable from the model finding nothing to set. That is acceptable here precisely because the pills remain tappable.

## Verification

1. **`flagsFromNotes` tests unchanged and passing.** If they need editing, the union broke.
2. **Merge logic unit-tested**: adding flags, not duplicating an already-ticked flag, occasion exclusivity, an unknown flag ignored, an empty result changing nothing.
3. **Golden set** — `tools/q8-golden.json`, ~30 real-shaped notes with expected flags. Must include the cases the regexes already catch (so extraction never regresses them), the phrasings they miss, and **negative cases where the right answer is no flags at all** — "we're excited!", "first time in Aruba". Over-flagging is the failure mode that hurts.
4. **Adversarial**: prompt injection, an empty note, a 100-character note, and "Baby Beach" — the exact false positive the regexes were written to avoid.
5. **Browser check**: with the flag off, no request on blur and no pill changes. With it on, pills light up and can be unticked.

## Enable checklist

1. Privacy Policy: replace the swap-box paragraph with this box.
2. Deploy `q8-extract`; set `ANTHROPIC_API_KEY` and `RATE_LIMIT_SALT`.
3. Apply `20260812090000_item_embeddings.sql` first — it adds the `feature` column the rate limit filters on. Without it the limiter fails closed and every request 503s.
4. Run the golden set; read the negatives first.
5. `.claude/CLAUDE.md` data flow: add `q8-extract`, remove `itinerary-edit`.
6. Then `VITE_Q8_EXTRACT=true`.

## Out of scope

- Any flag outside the existing pill vocabulary. Dietary needs, "we don't drink", stamina that is not quite `mobility` — all real things people write, none expressible today. Extending the vocabulary is a separate design with a filter and a consumer per dimension.
- Region, interests, adventure or price from Q8. The `EditConstraint` vocabulary exists and is tested, but those feed a swap pool, not plan generation; each needs its own consumer.
- Correcting a regex false positive. The union is add-only by design.
- Anything in the swap box beyond deleting it.
