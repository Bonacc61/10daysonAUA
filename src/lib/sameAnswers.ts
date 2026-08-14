import type { Answers } from '../App';

/**
 * Are these the same questionnaire answers?
 *
 * NOT `JSON.stringify(a) === JSON.stringify(b)`, which is what this replaced.
 * `trips.answers` is a Postgres `jsonb` column, and jsonb does not preserve key
 * order — it stores keys sorted by length, then bytewise. So a saved row comes
 * back as
 *
 *   {"days":10,"flags":[],"budget":…,"lodging":…,"groupType":…,"adventureLevel":50}
 *
 * where the client sent
 *
 *   {"days":10,"groupType":…,"budget":…,"adventureLevel":50,…,"flags":[]}
 *
 * Identical values, different text. The stringify comparison was therefore TRUE
 * for every round-tripped row — it could never report "these match" — so the
 * saved plan was discarded and regenerated on every load, and the row's identity
 * was never adopted.
 *
 * Compares by value over the union of keys, so a field added to `Answers` later
 * is included without anyone remembering to come back here.
 */
export function sameAnswers(a: Answers, b: Answers): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = (a as unknown as Record<string, unknown>)[k];
    const bv = (b as unknown as Record<string, unknown>)[k];
    if (Array.isArray(av) || Array.isArray(bv)) {
      // `interests` and `flags`. Order is meaningful in neither, but the
      // questionnaire writes them in a fixed order, so a plain element-wise
      // compare is enough and does not pretend to a sort that is not there.
      if (!Array.isArray(av) || !Array.isArray(bv)) return false;
      if (av.length !== bv.length) return false;
      if (av.some((x, i) => x !== bv[i])) return false;
      continue;
    }
    // An absent key and an explicitly-undefined one are the same answer; a
    // round trip through JSON drops undefined entirely.
    if ((av ?? undefined) !== (bv ?? undefined)) return false;
  }
  return true;
}
