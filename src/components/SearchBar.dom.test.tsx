// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSearchBox } from '../lib/useSearchBox';
import SearchBar from './SearchBar';

/**
 * Renders the box both Explore and My Aruba > Personalized draw.
 *
 * The behaviour worth guarding is the ARMING rule: one word stays local and
 * free, two or more words is what earns a round trip to a US sub-processor. A
 * regression that armed on every keystroke would send a traveller's words
 * abroad while they were still typing, and nothing about the screen would look
 * different.
 */

vi.mock('../lib/semanticSearch', () => ({
  semanticSearchEnabled: () => true,
  searchByMeaning: vi.fn(async () => ({ ok: true, ids: ['a1', 'a2'] })),
}));

// `addedByMeaning` is what the CALLER's blend actually added, not what the
// search function ranked — the surface owns that number because only it knows
// the pool the ids were resolved against. The harness stands in for a surface
// where 2 of the mocked 2 ids landed.
function Harness({ added = 2 }: { added?: number }) {
  const box = useSearchBox();
  return <SearchBar box={box} addedByMeaning={added} placeholder="Search beaches, activities, food…" />;
}

const type = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search beaches, activities, food…'), { target: { value } });

beforeEach(() => render(<Harness />));
afterEach(() => { document.body.innerHTML = ''; });

describe('SearchBar', () => {
  it('offers no search-by-meaning for a single word', () => {
    type('snorkel');
    expect(screen.queryByText('Search by meaning')).not.toBeInTheDocument();
  });

  it('arms search-by-meaning once the query is two words', () => {
    type('quiet snorkel');
    expect(screen.getByText('Search by meaning')).toBeInTheDocument();
  });

  it('reports how many matches it added, rather than just greying out', async () => {
    type('quiet snorkel spot');
    fireEvent.click(screen.getByText('Search by meaning'));
    expect(await screen.findByText('Added 2 matches by meaning.')).toBeInTheDocument();
  });

  it('says nothing else matched when the caller\'s pool took none of the ids', async () => {
    // The search function ranked 2 ids; this surface could place neither. The
    // box must not claim additions the traveller cannot see.
    document.body.innerHTML = '';
    render(<Harness added={0} />);
    type('quiet snorkel spot');
    fireEvent.click(screen.getAllByText('Search by meaning')[0]);
    expect(await screen.findByText('Nothing else matched what you meant.')).toBeInTheDocument();
  });

  it('clears the query, and with it the armed state', () => {
    type('quiet snorkel');
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.getByPlaceholderText('Search beaches, activities, food…')).toHaveValue('');
    expect(screen.queryByText('Search by meaning')).not.toBeInTheDocument();
  });
});
