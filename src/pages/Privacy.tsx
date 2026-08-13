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
          <p style={{ fontSize: 13, color: 'var(--ink)', opacity: 0.45, margin: '0 0 48px' }}>Last updated: August 2026</p>

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
                  ['Text you type into an AI feature', 'To turn what you asked for into a change to your plan, or into search results', 'Contract', 'Not stored — see “AI features” below'],
                  ['Your IP address, hashed (AI features only)', 'Rate-limiting, so nobody can run up our costs', 'Legitimate interest', '24 hours'],
                  ['A scrambled fingerprint of a search phrase, and its numeric form (only if you use search-by-meaning)', 'So a repeat search costs nothing and is not sent abroad again', 'Legitimate interest', '30 days'],
                  ['Which activities you swap, add, remove or move, against a random id stored in your browser', 'To learn which suggestions actually work and improve the matching for everyone', 'Legitimate interest', '24 months'],
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
            <p style={{ fontSize: 14, margin: '10px 0 0', opacity: 0.6 }}>
              That last row is the only thing we watch you do, and it is deliberately thin: the id is
              random, belongs to a browser rather than a person, and is never joined to your account.
              When you tell us <em>why</em> you swapped something we record which of the fixed reasons
              you picked &mdash; never anything you typed in your own words.
            </p>
          </Section>

          <Section title="Third parties">
            <ul style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
              <li><strong>Supabase</strong> — EU-based database &amp; authentication provider. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>supabase.com/privacy</a></li>
              <li><strong>TransIP</strong> — Netherlands-based hosting &amp; email provider. <a href="https://www.transip.nl/legal-and-security/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>transip.nl/legal-and-security</a></li>
              <li><strong>Viator</strong> — activity booking affiliate links. Their <a href="https://www.viator.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>privacy policy</a> applies if you click through and book.</li>
              <li><strong>Anthropic</strong> — reads a free-text request and turns it into a change to your itinerary. United States. <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>anthropic.com/legal/privacy</a></li>
              <li><strong>OpenAI</strong> — converts text into the numeric form used to spot duplicate activities and to search by meaning. United States. <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)' }}>openai.com/policies/privacy-policy</a></li>
            </ul>
          </Section>

          <Section title="AI features">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              Two places on this site can send what you type to an outside company to be interpreted: the box that
              asks what you&rsquo;d rather do when swapping an activity, and &mdash; if you deliberately ask for it
              &mdash; search-by-meaning. Ordinary searching does not send anything anywhere: typing in the search box
              matches against words we already hold, on your own device. Nothing is sent unless you ask for one of
              those two things, and everything else on the site works without them.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              <strong>What we send:</strong> the words you typed. For a swap we also send the activity you&rsquo;re
              replacing (its title, price and area) and the broad answers from your questionnaire &mdash; things like
              &ldquo;mid-range&rdquo; or &ldquo;travelling as a couple&rdquo;.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              <strong>What we never send:</strong> your name, your email, your account, your saved itinerary, or the
              &ldquo;anything we should know?&rdquo; note from the questionnaire.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              <strong>We don&rsquo;t keep what you wrote.</strong> The words you type are never written to our database
              and never written to our logs, for either feature. We record only that a request happened, against a
              one-way scrambled version of your IP address, so nobody can flood the feature and run up our bill.
              Those records are deleted after 24 hours.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              <strong>Search keeps one thing, and we&rsquo;d rather explain it than gloss it.</strong> If you use
              search-by-meaning, we store a scrambled fingerprint of the phrase together with the list of numbers it
              was turned into, for 30 days. That is what lets a repeat search &mdash; and people search for the same
              handful of things &mdash; skip the outside company entirely.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              The phrase itself is never stored, and the fingerprint is scrambled with a secret only our server knows,
              so it cannot simply be looked up. We still won&rsquo;t claim either of those things is impossible to
              work backwards &mdash; and the list of numbers is the easier of the two, because it is built from the
              meaning of what you wrote rather than its spelling. What we can tell you is what it is not attached to:
              not your account, and not stored against your IP address. After 30 days it is deleted. Nothing you type
              into the swap box is stored at all, ever.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              <strong>These companies are in the United States</strong>, so using these features means your words leave
              the EU. Both state that data sent through their business APIs is not used to train their models.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              Please don&rsquo;t type anything sensitive into these boxes. You never need to &mdash; &ldquo;somewhere quieter&rdquo;
              works as well as an explanation of why.
            </p>
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
