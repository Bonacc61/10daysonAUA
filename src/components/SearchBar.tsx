import { Search, X } from './Icons';
import type { SearchBox } from '../lib/useSearchBox';

/**
 * The search box, drawn once and used on Explore and on My Aruba >
 * Personalized. Behaviour lives in useSearchBox + searchEntries; this file is
 * only what it looks like.
 *
 * The icons are anchored to the INPUT, not to the outer wrapper. They are
 * positioned at top:50%, so any sibling the wrapper gains — the
 * search-by-meaning button below — would drag them down past the input's bottom
 * border. That is exactly what happened when the button replaced the one-line
 * hint, which is why the relative wrapper hugs the input alone.
 */
export default function SearchBar({
  box, placeholder, addedByMeaning, style,
}: {
  box: SearchBox;
  placeholder: string;
  /**
   * How many entries search-by-meaning actually added to what the caller is
   * showing — from searchEntries, never `semantic.ids.length`. The surface knows
   * its own pool; this component must not guess at it.
   */
  addedByMeaning: number;
  style?: React.CSSProperties;
}) {
  const { query, setQuery, clear, armed, pending, failed, answered, run } = box;
  return (
    <div style={{ maxWidth: 520, ...style }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--sand-500)' }}>
          <Search />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && armed) { e.preventDefault(); void run(); } }}
          placeholder={placeholder}
          aria-label={placeholder}
          style={{ width: '100%', padding: '14px 14px 14px 44px', border: '2px solid var(--ink)', borderRadius: 12, fontSize: 14, fontFamily: 'inherit', background: 'var(--cream)', outline: 'none' }}
        />
        {query && (
          <button onClick={clear} aria-label="Clear search" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X />
          </button>
        )}
      </div>
      {armed && (
        <div className="search-meaning-row">
          <button
            type="button"
            className="search-meaning-btn"
            onClick={() => void run()}
            disabled={pending || answered}
          >
            {pending ? 'Searching…' : 'Search by meaning'}
          </button>
          {/* Say what happened. Otherwise the button just greys out and nothing
              else changes, which reads as the feature ignoring you — and that is
              the guaranteed experience whenever the query matches nothing beyond
              the keyword hits. */}
          {(failed || answered) && (
            <span className="search-meaning-note">
              {failed
                ? "Couldn't search by meaning just now — keyword results still below."
                : addedByMeaning === 0
                  ? 'Nothing else matched what you meant.'
                  : `Added ${addedByMeaning} match${addedByMeaning === 1 ? '' : 'es'} by meaning.`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
