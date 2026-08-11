import type { EditConstraint } from '../data/editConstraint';

// Free text → EditConstraint, via the itinerary-edit edge function.
//
// Gated on VITE_NL_EDIT. With the flag unset this module's `enabled` is false,
// the input never renders, and nothing here is ever called — which is how the
// feature ships merged but dark while the Privacy Policy entry and the
// sub-processor question are settled. The traveller's sentence is personal data
// the moment they describe who they are travelling with, so the switch is a
// legal decision, not a technical one.
//
// Unlike logEvent (fire-and-forget telemetry), this one is in front of a person
// who is waiting, so failures are returned rather than swallowed — the caller
// falls back to the chips and says so.

const FN_URL = import.meta.env.VITE_ITINERARY_EDIT_FN_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const MAX_EDIT_TEXT = 200;  // mirrors the edge function's cap

export const nlEditEnabled: boolean =
  import.meta.env.VITE_NL_EDIT === 'true' && Boolean(FN_URL) && Boolean(ANON);

export type EditRequest = {
  text: string;
  current: { title: string; priceUsd: number; region?: string; kind: string };
  tags: string[];
};

export type EditResult =
  | { ok: true; constraint: EditConstraint }
  | { ok: false };

export async function parseEdit(req: EditRequest): Promise<EditResult> {
  if (!nlEditEnabled) return { ok: false };
  const text = req.text.trim().slice(0, MAX_EDIT_TEXT);
  if (!text) return { ok: false };

  try {
    const r = await fetch(FN_URL!, {
      method: 'POST',
      headers: {
        apikey: ANON!,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...req, text }),
    });
    if (!r.ok) return { ok: false };
    const body = await r.json();
    // The edge function validates against the schema; this is a shape guard,
    // not a trust boundary — a malformed body must not throw into the UI.
    if (!body?.constraint || typeof body.constraint !== 'object') return { ok: false };
    return { ok: true, constraint: body.constraint as EditConstraint };
  } catch {
    return { ok: false };
  }
}
