import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// tools/build-seo.ts and supabase/functions/collect/normalise.ts each
// independently allowlist the analytics `ref` value on every SEO page's
// planner link — one governs what build-seo.ts is willing to EMIT, the other
// what the edge function is willing to STORE. Nothing imports one pattern
// into the other, so a change to either is invisible at runtime: the beacon
// sends whatever build-seo.ts allowed, collect() nulls whatever
// normalise.ts doesn't, and nothing errors anywhere. That silent coupling is
// exactly how the original bug shipped (40 of 58 refs exceeded the 32-char
// limit through a full review). This file fails loudly the moment the two
// literal patterns stop agreeing with each other — a code comment alone
// cannot do that.
const EXPECTED_PATTERN_SOURCE = '^[a-z0-9-]{1,32}$';

/**
 * Reads `file` as plain text and pulls out the `/^..$/` regex literal that
 * appears shortly after `anchor`. Deliberately text-based rather than
 * importing the module: `tools/build-seo.ts` runs a full (side-effecting)
 * build as soon as it is imported, and this check must stay offline and
 * side-effect free.
 */
function extractRegexLiteral(file: string, anchor: string): string {
  const src = readFileSync(file, 'utf8');
  const idx = src.indexOf(anchor);
  if (idx === -1) {
    throw new Error(`extractRegexLiteral: could not find "${anchor}" in ${file} — has it moved or been renamed?`);
  }
  const window = src.slice(idx, idx + 400);
  const m = window.match(/\/(\^.*?\$)\//);
  if (!m) {
    throw new Error(`extractRegexLiteral: no /^...$/ regex literal found near "${anchor}" in ${file}`);
  }
  return m[1];
}

describe('the collect allowlist and the build-seo ref pattern cannot silently drift apart', () => {
  it('normalise.ts campaign() still allowlists exactly ^[a-z0-9-]{1,32}$', () => {
    const pattern = extractRegexLiteral(
      'supabase/functions/collect/normalise.ts',
      'export function campaign(raw: unknown): string | null {',
    );
    expect(pattern).toBe(EXPECTED_PATTERN_SOURCE);
  });

  it('build-seo.ts enforces the identical pattern before it will emit a ref', () => {
    const pattern = extractRegexLiteral('tools/build-seo.ts', 'const REF_PATTERN');
    expect(pattern).toBe(EXPECTED_PATTERN_SOURCE);
  });
});
