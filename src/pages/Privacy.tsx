import type { PageId } from '../App';
import Footer from '../components/Footer';

type Props = { setPage: (p: PageId) => void };

export default function Privacy({ setPage }: Props) {
  return (
    <>
      <div className="bleed" style={{ background: 'var(--cream)', minHeight: '80vh' }}>
        <div className="container-1280" style={{ padding: '56px 36px 80px', maxWidth: 720 }}>
          <button
            onClick={() => setPage('landing')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink)', opacity: 0.5, padding: 0, marginBottom: 32, fontFamily: 'inherit' }}
          >
            ← Back
          </button>
          <h1 className="font-display" style={{ fontSize: 40, margin: '0 0 6px' }}>Privacy Policy</h1>
          <p style={{ fontSize: 13, color: 'var(--ink)', opacity: 0.45, margin: '0 0 48px' }}>Last updated: July 2026</p>

          <p style={{ fontSize: 15, margin: '0 0 32px' }}>
            <strong>Controller:</strong> 10daysonaruba.com —{' '}
            <a href="mailto:hello@10daysonaruba.com" style={{ color: 'var(--red)' }}>hello@10daysonaruba.com</a>
          </p>

          <Section title="Data we collect">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  {['What', 'Why', 'Legal basis', 'Kept for'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--ink)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Email + password', 'Let you save and return to your itinerary', 'Contract', 'Until you delete your account'],
                  ['Itinerary + questionnaire answers', 'Core service', 'Contract', 'Until you delete your account'],
                  ['Name, email, message (contact form)', 'To reply to you', 'Legitimate interest', '12 months'],
                  ['Shared itinerary snapshot', 'Powers your share link', 'Legitimate interest', 'Until you delete it or your account'],
                ].map(([what, why, basis, kept]) => (
                  <tr key={what} style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>{what}</td>
                    <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>{why}</td>
                    <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>{basis}</td>
                    <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>{kept}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 14, margin: '16px 0 0', opacity: 0.6 }}>No advertising trackers. No third-party analytics.</p>
          </Section>

          <Section title="Third parties">
            <ul style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
              <li><strong>Supabase</strong> — EU-based database &amp; authentication provider. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>supabase.com/privacy</a></li>
              <li><strong>TransIP</strong> — Netherlands-based hosting &amp; email provider. <a href="https://www.transip.nl/legal-and-security/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>transip.nl/legal-and-security</a></li>
              <li><strong>Viator</strong> — activity booking affiliate links. Their <a href="https://www.viator.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>privacy policy</a> applies if you click through and book.</li>
            </ul>
          </Section>

          <Section title="Your rights (GDPR)">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              You have the right to access, correct, delete, restrict, or port your data.
              Email <a href="mailto:hello@10daysonaruba.com" style={{ color: 'var(--red)' }}>hello@10daysonaruba.com</a> and we will respond within 30 days.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              Deleting your account permanently removes all associated data.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              You may also lodge a complaint with the Dutch Data Protection Authority at{' '}
              <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>autoriteitpersoonsgegevens.nl</a>.
            </p>
          </Section>

          <Section title="Cookies">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              On this site we use a single session cookie to keep you logged in. No tracking or marketing cookies of our own.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              Our activity recommendations link to <strong>Viator</strong>, an affiliate partner. If you click through to Viator, they set their own cookies &mdash; including an affiliate cookie (a ~30-day window) used to attribute bookings &mdash; governed by{' '}
              <a href="https://www.viator.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>Viator&rsquo;s Privacy &amp; Cookies Statement</a>.
            </p>
          </Section>
        </div>
      </div>
      <Footer setPage={setPage} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h2 className="font-display" style={{ fontSize: 22, margin: '0 0 16px' }}>{title}</h2>
      {children}
    </div>
  );
}
