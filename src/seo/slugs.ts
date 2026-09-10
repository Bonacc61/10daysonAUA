// URL slugs, from a committed registry rather than derived at build time.
//
// The invariant: a URL, once published, is never reused for different content
// and never moves. Viator retitles products without telling us; deriving the
// slug from the title would silently 404 an indexed page and throw away every
// link pointing at it. The registry is the authority; titles are not.

export function slugify(title: string): string {
  const s = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // fold accents, keep the letter
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'activity';
}

export function slugFor(id: string, registry: Record<string, string>): string | null {
  return registry[id] ?? null;
}

/**
 * Registry after adding any new ids. Existing entries are never rewritten, and
 * ids missing from the catalog are never dropped — a vanished product keeps its
 * URL, drops out of the sitemap, and its page points at a live alternative.
 */
export function proposeRegistry(
  entries: { id: string; title: string }[],
  existing: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...existing };
  const taken = new Set(Object.values(out));
  for (const { id, title } of entries) {
    if (out[id]) continue;
    const base = slugify(title);
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    out[id] = slug;
    taken.add(slug);
  }
  return out;
}

/** Directory-style so Apache serves <slug>/index.html as a real file. */
export function urlFor(slug: string, kind: 'things-to-do' | 'guides'): string {
  return `/${kind}/${slug}/`;
}

/**
 * The ids in `proposed` that `existing` did not already hold — the URLs a run
 * has just invented.
 *
 * Separated from proposeRegistry so the build can refuse to mint in CI, where
 * nothing can commit the result. See tools/build-seo.ts for why that matters.
 */
export function mintedIds(
  existing: Record<string, string>,
  proposed: Record<string, string>,
): string[] {
  return Object.keys(proposed).filter((id) => !(id in existing));
}
