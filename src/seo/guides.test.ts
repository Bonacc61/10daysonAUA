import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parseGuide, extractFaqs, loadGuide } from './guides';

// A hand-written fixture rather than the real guide: every expected value below
// is written out here, so nothing is derived from the module under test. The
// real guide is exercised separately at the bottom, where the only claims made
// about it are ones its file text supports.
const FIXTURE = `---
title: "Snorkeling: free vs paid"
description: "When the free beach beats the boat."
date: 2026-09-10
status: published
products:
  - 119085P1
  - 8936P1
curated:
  - tres-trapi
---

# Snorkeling: free vs paid

**The short version: you do not need to book anything.** Walk down the steps.

> "Get in before the catamarans arrive." — Edsel

| Trip | Rating | Five-star |
|---|---|---|
| Arusun | 4.8★ | **90%** |
| Dolphin | 4.8★ | 85% |

---

## Common questions

**Do I need a boat to see turtles?**
No. [Tres Trapi](/things-to-do/tres-trapi-turtle-cove/) has them from shore.

**Not a question, just emphasis.** This paragraph must not become an FAQ entry.

---

*Free spots: [Malmok](/things-to-do/malmok-beach-snorkel/)*
`;

const guide = () => parseGuide('snorkeling-free-vs-paid', FIXTURE);

describe('frontmatter', () => {
  it('reads every field, with the lists as lists', () => {
    const g = guide();
    expect(g.slug).toBe('snorkeling-free-vs-paid');
    expect(g.title).toBe('Snorkeling: free vs paid');
    expect(g.description).toBe('When the free beach beats the boat.');
    expect(g.date).toBe('2026-09-10');
    expect(g.status).toBe('published');
    expect(g.products).toEqual(['119085P1', '8936P1']);
    expect(g.curated).toEqual(['tres-trapi']);
  });

  // A missing field must fail LOUDLY. The alternative is a page with an empty
  // <title>, or — far worse — a missing `status` read as publishable.
  const REQUIRED = ['title', 'description', 'date', 'status'];

  it.each(REQUIRED)('throws when "%s" is missing, naming the field', (field) => {
    const without = FIXTURE.split('\n')
      .filter((l) => !l.startsWith(`${field}:`))
      .join('\n');
    expect(without, `the fixture never had a ${field}: line — this case tests nothing`).not.toBe(FIXTURE);
    expect(() => parseGuide('x', without)).toThrow(new RegExp(`missing required frontmatter "${field}"`));
  });

  it('covers every field the parser requires', () => {
    // Non-vacuity floor: if the list above is ever emptied, it.each runs zero
    // cases and the suite still goes green.
    expect(REQUIRED).toHaveLength(4);
  });

  it('refuses a status it does not recognise rather than guessing', () => {
    const odd = FIXTURE.replace('status: published', 'status: ready-ish');
    expect(() => parseGuide('x', odd)).toThrow(/status "ready-ish"/);
  });

  it('refuses an unknown key, because a typo silently drops the field it meant', () => {
    const typo = FIXTURE.replace('products:', 'product:');
    expect(() => parseGuide('x', typo)).toThrow(/unknown frontmatter key "product"/);
  });

  it('refuses a file with no frontmatter at all', () => {
    expect(() => parseGuide('x', '# Just a heading\n\nSome prose.\n')).toThrow(/no --- frontmatter/);
  });

  it('refuses a date that is not YYYY-MM-DD', () => {
    expect(() => parseGuide('x', FIXTURE.replace('date: 2026-09-10', 'date: Sept 2026'))).toThrow(/expected YYYY-MM-DD/);
  });

  it('refuses a slug that would not be safe as a URL segment or a shell word', () => {
    expect(() => parseGuide('snorkel; rm -rf /', FIXTURE)).toThrow(/outside \[a-z0-9-\]/);
  });
});

describe('comments in the frontmatter', () => {
  // The lists are opaque Viator product codes. An editor who cannot write down
  // what 472918P1 is has to look it up every time, so annotation is a feature
  // rather than sloppiness the parser should punish.
  const ANNOTATED = `---
# Registry ids, not slugs.
title: "Snorkeling: free vs paid"
description: "When the free beach beats the boat."
date: 2026-09-10
status: published
products:
  - 472918P1      # Award-Winning Private Turtle Snorkeling — 5.0★, 212
  # a comment between two items must not close the list
  - 8936P1  # Arusun Catamaran Sail with Snorkeling
curated:
  - tres-trapi
---

Body.
`;

  it('skips whole-line comments and strips trailing ones off list items', () => {
    const g = parseGuide('annotated', ANNOTATED);
    expect(g.products).toEqual(['472918P1', '8936P1']);
    expect(g.curated).toEqual(['tres-trapi']);
    expect(g.title).toBe('Snorkeling: free vs paid');
  });

  // The other half of the rule, and the one with teeth: a scalar is free text.
  // Truncating a title at a hash would be a quiet bug that surfaces weeks later
  // as a mysteriously short <title>.
  it('leaves a # inside a scalar alone', () => {
    const withHash = ANNOTATED
      .replace('title: "Snorkeling: free vs paid"', 'title: "Aruba on a budget: the #1 question"')
      .replace('description: "When the free beach beats the boat."', 'description: "Costs, tips # and traps."');
    const g = parseGuide('hashy', withHash);
    expect(g.title).toBe('Aruba on a budget: the #1 question');
    expect(g.description).toBe('Costs, tips # and traps.');
  });

  it('still rejects a line that is neither a comment, a pair nor a list item', () => {
    const broken = ANNOTATED.replace('status: published', 'status: published\nthis is not yaml');
    expect(() => parseGuide('x', broken)).toThrow(/does not understand/);
  });
});

describe('loadGuide — a broken DRAFT must not take the build down', () => {
  const VALID = `---
title: "T"
description: "D"
date: 2026-09-10
status: draft
---

Body.
`;

  it('returns the guide when the file parses', () => {
    const loaded = loadGuide('ok', VALID);
    expect('guide' in loaded && loaded.guide.title).toBe('T');
  });

  it('skips a draft whose frontmatter is broken, and says why', () => {
    const noTitle = VALID.replace('title: "T"\n', '');
    const loaded = loadGuide('broken-draft', noTitle);
    expect('skipped' in loaded).toBe(true);
    expect('skipped' in loaded && loaded.skipped).toMatch(/missing required frontmatter "title"/);
  });

  it('still throws when the same breakage is not marked draft', () => {
    const published = VALID.replace('status: draft', 'status: published').replace('title: "T"\n', '');
    expect(() => loadGuide('broken-published', published)).toThrow(/missing required frontmatter "title"/);
  });

  it('throws for a file with no status line at all — absence is not a draft', () => {
    const noStatus = VALID.replace('status: draft\n', '');
    expect(() => loadGuide('no-status', noStatus)).toThrow(/missing required frontmatter "status"/);
  });

  it('reads the draft marker through a trailing comment, erring towards skipping', () => {
    const commented = VALID.replace('status: draft', 'status: draft   # still editing').replace('title: "T"\n', '');
    expect('skipped' in loadGuide('x', commented)).toBe(true);
  });

  it('does not mistake the word draft in the body for the status', () => {
    const body = VALID.replace('status: draft', 'status: published')
      .replace('title: "T"\n', '')
      .replace('Body.', 'This guide is not a status: draft of anything.');
    expect(() => loadGuide('x', body)).toThrow();
  });
});

describe('markdown rendering', () => {
  it('renders the table as a real table, with the cell emphasis intact', () => {
    const html = guide().bodyHtml;
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Five-star</th>');
    expect(html).toContain('<td>Arusun</td>');
    // Nested inline formatting inside a cell — the thing a hand-rolled parser
    // gets wrong silently.
    expect(html).toContain('<td><strong>90%</strong></td>');
  });

  it('wraps the table in a scroll container, so 360px has something to scroll', () => {
    const html = guide().bodyHtml;
    expect(html).toContain('<div class="seo-scroll"><table>');
    expect(html).toContain('</table>\n</div>');
  });

  it('renders blockquotes, emphasis, links and rules', () => {
    const html = guide().bodyHtml;
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<strong>The short version: you do not need to book anything.</strong>');
    expect(html).toContain('<a href="/things-to-do/tres-trapi-turtle-cove/">Tres Trapi</a>');
    expect(html).toContain('<em>Free spots');
    expect(html).toContain('<hr>');
  });

  it('drops the body H1 — the page renders one, from the frontmatter title', () => {
    expect(guide().bodyHtml).not.toContain('<h1>');
    expect(guide().bodyHtml).toContain('<h2>Common questions</h2>');
  });
});

describe('FAQ extraction', () => {
  it('pulls the bold-question paragraphs out of Common questions', () => {
    expect(guide().faqs).toEqual([
      {
        q: 'Do I need a boat to see turtles?',
        a: 'No. Tres Trapi has them from shore.',
      },
    ]);
  });

  it('also reads the H3 question / paragraph answer shape', () => {
    const faqs = extractFaqs('## Common questions\n\n### How long is the drive?\n\nAbout twenty minutes.\n');
    expect(faqs).toEqual([{ q: 'How long is the drive?', a: 'About twenty minutes.' }]);
  });

  it('stops at the next section, so later prose is not swept in', () => {
    const faqs = extractFaqs(
      '## Common questions\n\n**Is it free?**\nYes.\n\n## Our pick\n\n**Is this a question?**\nNo, it is a heading section.\n',
    );
    expect(faqs).toEqual([{ q: 'Is it free?', a: 'Yes.' }]);
  });

  it('finds nothing when the guide has no Common questions section', () => {
    expect(extractFaqs('## Our pick\n\n**Go early?**\nYes.\n')).toEqual([]);
  });
});

// The committed drafts. Claims made here are only ones the files themselves
// support, so this cannot go stale in a way that hides a regression.
describe('content/guides on disk', () => {
  const files = readdirSync('content/guides').filter((f) => f.endsWith('.md'));

  it('has guides to parse at all', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // Stricter than the generator on purpose. The BUILD tolerates a draft that
  // does not parse, because a work-in-progress guide must never block a deploy
  // — but a broken guide that has been COMMITTED is still something someone
  // should be told about, and a test failure is the cheap way to say it.
  it.each(files)('%s parses, and its status is one the gate understands', (file) => {
    const g = parseGuide(file.replace(/\.md$/, ''), readFileSync(`content/guides/${file}`, 'utf8'));
    expect(['published', 'draft']).toContain(g.status);
    expect(g.title.length).toBeGreaterThan(0);
  });

  it('the snorkeling guide is still an unreviewed draft', () => {
    // Not a style assertion: this file is the owner's unedited writing, and the
    // pipeline exists to keep unreviewed writing off a live site. If someone
    // flips it to published, that must be a deliberate act that turns this
    // test red first.
    const g = parseGuide(
      'snorkeling-free-vs-paid',
      readFileSync('content/guides/snorkeling-free-vs-paid.md', 'utf8'),
    );
    expect(g.status).toBe('draft');
  });
});
