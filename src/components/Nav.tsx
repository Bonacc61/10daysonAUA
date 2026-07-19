import { useState, useRef, useEffect } from 'react';
import type { PageId } from '../App';
import { useAuth } from '../lib/auth';

type Props = {
  page: PageId;
  setPage: (p: PageId) => void;
  onLogin: () => void;
  canSeeItinerary: boolean;
};

const MOBILE_NAV: { id: PageId; label: string }[] = [
  { id: 'landing',    label: 'How it works' },
  { id: 'explore',    label: 'Explore' },
  { id: 'itinerary',  label: 'Itinerary' },
  { id: 'map',        label: 'Map' },
];

export default function Nav({ page, setPage, onLogin, canSeeItinerary }: Props) {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const link = (id: PageId, label: string) => (
    <button
      key={id}
      onClick={() => setPage(id)}
      className="nav-link-text"
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 14,
        fontWeight: page === id ? 700 : 500,
        color: page === id ? 'var(--red)' : 'var(--ink)',
        borderBottom: page === id ? '2px solid var(--red)' : '2px solid transparent',
        padding: '6px 2px',
      }}
    >
      {label}
    </button>
  );

  // Mobile tab carousel
  const mobileIdx = MOBILE_NAV.findIndex(n => n.id === page);
  const activeMobile = mobileIdx >= 0 ? mobileIdx : 1; // default to Explore
  const prevMobile = MOBILE_NAV[(activeMobile - 1 + MOBILE_NAV.length) % MOBILE_NAV.length];
  const nextMobile = MOBILE_NAV[(activeMobile + 1) % MOBILE_NAV.length];

  return (
    <div className="bleed" style={{ background: 'var(--cream)', borderBottom: '2px solid var(--ink)' }}>
      <div
        className="container-1280 nav-row"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 36px' }}
      >
        <button
          onClick={() => setPage('landing')}
          aria-label="10 days on Aruba — home"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
        >
          <img
            className="nav-logo"
            /* ?v= cache-buster: iOS Safari caches images by URL very aggressively,
               so it kept serving the old logo. Bump this token whenever the file
               at public/logo-horizontal.png is replaced to force a fresh fetch. */
            src="/logo-horizontal.png?v=20260621"
            alt="10 days on Aruba"
            style={{ height: 38, width: 'auto', display: 'block' }}
          />
        </button>

        {/* Desktop links */}
        <div className="nav-links-desktop" style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          {link('landing', 'How it works')}
          {link('explore', 'Explore')}
          {link('itinerary', 'Itinerary')}
          {link('map', 'Map')}
          {user ? (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                className="nav-login"
                onClick={() => setMenuOpen((o) => !o)}
                title={`Signed in as ${user.email}`}
              >
                My Aruba ▾
              </button>
              {menuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                  background: 'var(--cream)', border: '2px solid var(--ink)',
                  borderRadius: 8, minWidth: 160, zIndex: 200,
                  boxShadow: '3px 3px 0 var(--ink)',
                  overflow: 'hidden',
                }}>
                  <button
                    onClick={() => { setMenuOpen(false); setPage('dashboard'); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 16px', background: 'transparent', border: 'none',
                      cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 600,
                      color: 'var(--ink)', borderBottom: '1px solid var(--ink)',
                    }}
                  >
                    My Aruba
                  </button>
                  <button
                    onClick={async () => { setMenuOpen(false); await signOut(); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 16px', background: 'transparent', border: 'none',
                      cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500,
                      color: 'var(--red)',
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="nav-login" onClick={onLogin}>
              Log in
            </button>
          )}
        </div>

        {/* Mobile: ‹ Page › carousel + login */}
        <div className="nav-mobile-row" style={{ display: 'none', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setPage(prevMobile.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink)', padding: '0 2px', lineHeight: 1 }}
            aria-label={`Go to ${prevMobile.label}`}
          >‹</button>
          <button
            onClick={() => setPage(MOBILE_NAV[activeMobile].id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 700, color: 'var(--red)', borderBottom: '2px solid var(--red)', padding: '4px 2px', minWidth: 80, textAlign: 'center' }}
          >
            {MOBILE_NAV[activeMobile].label}
          </button>
          <button
            onClick={() => setPage(nextMobile.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink)', padding: '0 2px', lineHeight: 1 }}
            aria-label={`Go to ${nextMobile.label}`}
          >›</button>
          {user ? (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button className="nav-login" onClick={() => setMenuOpen(o => !o)}>My Aruba ▾</button>
              {menuOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: 'var(--cream)', border: '2px solid var(--ink)', borderRadius: 8, minWidth: 140, zIndex: 200, boxShadow: '3px 3px 0 var(--ink)', overflow: 'hidden' }}>
                  <button onClick={() => { setMenuOpen(false); setPage('dashboard'); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 600, color: 'var(--ink)', borderBottom: '1px solid var(--ink)' }}>My Aruba</button>
                  <button onClick={async () => { setMenuOpen(false); await signOut(); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--red)' }}>Sign out</button>
                </div>
              )}
            </div>
          ) : (
            <button className="nav-login" onClick={onLogin}>Log in</button>
          )}
        </div>
      </div>
    </div>
  );
}
