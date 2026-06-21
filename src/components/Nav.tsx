import type { PageId } from '../App';
import { useAuth } from '../lib/auth';

type Props = {
  page: PageId;
  setPage: (p: PageId) => void;
  onLogin: () => void;
};

export default function Nav({ page, setPage, onLogin }: Props) {
  const { user } = useAuth();

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
            src="/logo-horizontal.png"
            alt="10 days on Aruba"
            style={{ height: 38, width: 'auto', display: 'block' }}
          />
        </button>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          {link('landing', 'How it works')}
          {link('explore', 'Explore')}
          {link('itinerary', 'Itinerary')}
          <a
            className="nav-reddit"
            href="#faq"
            onClick={(e) => {
              e.preventDefault();
              setPage('landing');
              setTimeout(() => document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' }), 50);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 14px',
              background: 'var(--cream)',
              border: '2px solid var(--ink)',
              borderRadius: 999,
              boxShadow: '3px 3px 0 var(--ink)',
              textDecoration: 'none',
              color: 'var(--ink)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', background: '#FF4500', color: 'white', fontWeight: 700, fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>r</span>
            <span className="nav-reddit-text">Reddit FAQ</span>
          </a>
          <button
            className="nav-login"
            onClick={() => (user ? setPage('itinerary') : onLogin())}
            title={user ? `Signed in as ${user.email}` : undefined}
          >
            {user ? 'My trip' : 'Log in'}
          </button>
        </div>
      </div>
    </div>
  );
}
