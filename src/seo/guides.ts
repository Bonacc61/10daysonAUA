// Editorial guides: content/guides/<slug>.md in, a parsed Guide out.
//
// The hubs from the spec (docs/superpowers/specs/2026-09-10-seo-geo-strategy-design.md,
// "The hubs"). They carry the judgement, target the higher-volume queries, and
// link DOWN to the data pages — so they sit above /things-to-do/ in the crawl
// path, not beside it.
//
// `marked` is a devDependency and it is used ONLY here and from tools/. Nothing
// in the app's import graph reaches this file (src/seo/* is imported by
// tools/build-seo.ts and by tests, never by a component), so marked never
// enters the shipped bundle. Do not import this module from src/components or
// src/pages.
//
// Why a real parser rather than a few regexes: the first guide contains an
// 8-row table, blockquotes, nested inline emphasis inside links, and horizontal
// rules. A bespoke parser does not fail on those — it silently emits wrong
// HTML, which is the worst failure mode for a page nobody re-reads after the
// build.

import { Marked, Renderer, type Tokens } from 'marked';

export type GuideStatus = 'published' | 'draft';

/** One extracted question/answer pair, for FAQPage JSON-LD. */
export type Faq = { q: string; a: string };

export type Guide = {
  slug: string;
  title: string;
  description: string;
  date: string;
  status: GuideStatus;
  /** Viator product ids / curated ids the guide claims to reference. */
  products: string[];
  curated: string[];
  /** The markdown body, rendered. Excludes the leading H1. */
  bodyHtml: string;
  faqs: Faq[];
};

/**
 * A markdown table is the classic mobile overflow: eight columns of prose on a
 * 360px screen push the whole document sideways. Wrapping it here rather than
 * in CSS means the scroll container exists in the markup, so `overflow-x: auto`
 * has something to apply to — a <table> cannot scroll itself.
 */
const md = new Marked({
  renderer: {
    table(this: Renderer, token: Tokens.Table): string {
      return `<div class="seo-scroll">${Renderer.prototype.table.call(this, token)}</div>`;
    },
  },
});

const REQUIRED = ['title', 'description', 'date', 'status'] as const;
const LISTS = ['products', 'curated'] as const;
const KNOWN = new Set<string>([...REQUIRED, ...LISTS]);
const STATUSES: readonly string[] = ['published', 'draft'];

/** Frontmatter must be the very first thing in the file, fenced by ---. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/**
 * Strict on purpose.
 *
 * The alternative — defaulting a missing field — emits a page with an empty
 * <title> or, far worse, treats an unrecognised `status` as publishable. An
 * unreviewed guide reaching a live site is the failure this whole pipeline is
 * built to prevent, so every ambiguity here is an error rather than a guess.
 */
export function parseGuide(slug: string, source: string): Guide {
  const where = `content/guides/${slug}.md`;

  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`guides: slug "${slug}" is outside [a-z0-9-] — it becomes a URL path segment and a shell word in deploy.yml.`);
  }

  const fm = FRONTMATTER.exec(source);
  if (!fm) {
    throw new Error(`guides: ${where} has no --- frontmatter block at the top of the file.`);
  }

  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let openList: string | null = null;

  for (const raw of fm[1].split(/\r?\n/)) {
    if (!raw.trim()) continue;
    // A whole-line comment, anywhere in the block — including between list
    // items, where it must not close the open list. These files are edited by
    // hand and the lists below are opaque Viator product codes; forbidding an
    // annotation on them would be strict in exactly the wrong place.
    if (/^[ \t]*#/.test(raw)) continue;

    const item = /^[ \t]+-[ \t]+(.+?)[ \t]*$/.exec(raw);
    if (item) {
      if (!openList) {
        throw new Error(`guides: ${where} has the list item "${item[1]}" before any key that opens a list.`);
      }
      lists[openList].push(unquote(stripTrailingComment(item[1])));
      continue;
    }

    const pair = /^([A-Za-z][A-Za-z0-9_]*):[ \t]*(.*)$/.exec(raw);
    if (!pair) {
      throw new Error(`guides: ${where} has a frontmatter line this parser does not understand: ${raw.trim()}`);
    }
    const [, key, value] = pair;
    if (!KNOWN.has(key)) {
      throw new Error(
        `guides: ${where} sets unknown frontmatter key "${key}". Known keys: ${[...KNOWN].join(', ')}. ` +
          'A typo here silently drops the field it meant to set.',
      );
    }
    if (key in scalars || key in lists) {
      throw new Error(`guides: ${where} sets "${key}" twice.`);
    }
    if (value.trim() === '') {
      lists[key] = [];
      openList = key;
    } else {
      // Deliberately NOT stripTrailingComment(): a scalar here is free text.
      // `title: "Aruba on a budget: the #1 question"` is a legitimate title,
      // and truncating it at the hash would be a quiet, ugly bug that shows up
      // as a mysteriously short <title> weeks later. Trailing comments are a
      // list-item affordance only, because a list item is an opaque id.
      scalars[key] = unquote(value.trim());
      openList = null;
    }
  }

  for (const key of REQUIRED) {
    if (!scalars[key]) {
      throw new Error(`guides: ${where} is missing required frontmatter "${key}".`);
    }
  }
  for (const key of LISTS) {
    if (key in scalars) {
      throw new Error(`guides: ${where} gives "${key}" a scalar value; it must be a "- " list.`);
    }
  }
  if (!STATUSES.includes(scalars.status)) {
    throw new Error(
      `guides: ${where} has status "${scalars.status}" — expected one of ${STATUSES.join(', ')}. ` +
        'Refusing to guess whether an unrecognised status means publishable.',
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scalars.date)) {
    throw new Error(`guides: ${where} has date "${scalars.date}" — expected YYYY-MM-DD.`);
  }

  // The H1 is rendered from the frontmatter title, so the page has exactly one
  // and it is the one the <title>, the breadcrumb and the JSON-LD all agree on.
  const body = source.slice(fm[0].length).replace(/^\s*#[ \t]+[^\n]*\n?/, '');

  return {
    slug,
    title: scalars.title,
    description: scalars.description,
    date: scalars.date,
    status: scalars.status as GuideStatus,
    products: lists.products ?? [],
    curated: lists.curated ?? [],
    bodyHtml: md.parse(body, { async: false }),
    faqs: extractFaqs(body),
  };
}

/**
 * ` # ...` to end of line. Applied to LIST ITEMS ONLY — see the scalar branch
 * above for why. The leading space is required, so a value that simply starts
 * with a hash is left alone.
 */
function stripTrailingComment(s: string): string {
  const at = s.search(/[ \t]#/);
  return at < 0 ? s : s.slice(0, at).trim();
}

function unquote(s: string): string {
  const m = /^"([\s\S]*)"$/.exec(s) || /^'([\s\S]*)'$/.exec(s);
  return m ? m[1] : s;
}

/**
 * The question/answer pairs under the "Common questions" H2, for FAQPage.
 *
 * Two shapes are accepted because both are natural to write: an H3 question
 * followed by a paragraph, and a paragraph whose first thing is a bold
 * question (which is how the first guide is written). A bold run-in that is
 * not a question — the guide uses that device throughout for emphasis — is
 * skipped, which is what the trailing "?" test is for.
 *
 * Extraction only. The visible FAQ is whatever the markdown rendered; this
 * never rewrites the body.
 */
export function extractFaqs(body: string): Faq[] {
  const tokens = md.lexer(body);
  const start = tokens.findIndex(
    (t) => t.type === 'heading' && (t as Tokens.Heading).depth === 2 && /common questions/i.test((t as Tokens.Heading).text),
  );
  if (start < 0) return [];

  const out: Faq[] = [];
  let pending: string | null = null;

  for (const token of tokens.slice(start + 1)) {
    if (token.type === 'heading') {
      const h = token as Tokens.Heading;
      if (h.depth <= 2) break;            // the next section ends the FAQ
      pending = h.depth === 3 && h.text.trim().endsWith('?') ? plain(h.text) : null;
      continue;
    }
    if (token.type !== 'paragraph') continue;
    const para = (token as Tokens.Paragraph).raw;

    if (pending) {
      out.push({ q: pending, a: plain(para) });
      pending = null;
      continue;
    }
    const bold = /^\*\*([\s\S]+?)\*\*[ \t]*\r?\n?([\s\S]*)$/.exec(para.trim());
    if (bold && bold[1].trim().endsWith('?') && bold[2].trim()) {
      out.push({ q: plain(bold[1]), a: plain(bold[2]) });
    }
  }
  return out;
}

/**
 * Inline markdown reduced to the words. JSON-LD answers are read by machines
 * that want the sentence, not the link syntax around it.
 */
function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The result of trying to read one guide file: the guide, or the reason it was
 * skipped. Never both.
 */
export type GuideLoad = { guide: Guide } | { skipped: string };

/**
 * Read a guide, tolerating a broken DRAFT and never a broken published one.
 *
 * `npm run build` deploys the whole site on every push to main, and frontmatter
 * is parsed before the status gate can be consulted — so a half-written draft
 * that nobody intends to publish would otherwise take down an unrelated hotfix.
 * The asymmetry decides it: an invalid draft costs a warning nobody has to act
 * on today, a blocked build costs every deploy until someone finds it. Same
 * reasoning as the pid/mcid check in tools/build-seo.ts, which skips a
 * malformed Viator URL with a message rather than throwing.
 *
 * Published content is the other half of the bargain and is never softened: if
 * a file does not say it is a draft, a parse failure still fails the build.
 */
export function loadGuide(slug: string, source: string): GuideLoad {
  try {
    return { guide: parseGuide(slug, source) };
  } catch (err) {
    if (!looksLikeDraft(source)) throw err;
    return { skipped: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Crude on purpose: `status` lives INSIDE the frontmatter, so a file that will
 * not parse cannot be asked whether it is a draft. A regex over the raw text is
 * the only thing left, and it is deliberately lenient — `status: draft  # still
 * editing` counts — because every direction it errs in is the safe one. A false
 * positive skips a page that was never going to publish; a false negative fails
 * the build, which is the behaviour we already have.
 */
function looksLikeDraft(source: string): boolean {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  // No fence at all means no frontmatter to scope to — look at the head of the
  // file rather than the whole of it, so the word cannot be picked up out of
  // the prose a thousand lines down.
  return /^status:[ \t]*['"]?draft\b/m.test(block ? block[1] : source.slice(0, 1000));
}
