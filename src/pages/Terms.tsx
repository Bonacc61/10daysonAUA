import type { PageId } from '../App';
import Footer from '../components/Footer';

type Props = { setPage: (p: PageId) => void };

export default function Terms({ setPage }: Props) {
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
          <h1 className="font-display" style={{ fontSize: 40, margin: '0 0 6px' }}>Terms of Service</h1>
          <p style={{ fontSize: 13, color: 'var(--ink)', opacity: 0.45, margin: '0 0 48px' }}>Last updated: July 2026</p>

          <p style={{ fontSize: 15, lineHeight: 1.7, margin: '0 0 32px' }}>
            Welcome to <strong>10daysonaruba.com</strong> ("the site", "we", "us"). By using the site you agree to these terms.
            If you don't agree, please don't use the site.
          </p>

          <Section title="What this site is">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              10daysonaruba.com is an itinerary-planning tool that helps you discover and organise activities
              for a trip to Aruba. We are not a travel agent, tour operator, or booking platform.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              When you click a "Book on Viator" link, you leave our site and enter Viator's platform.
              Any booking, payment, or contract is solely between you and Viator (or the operator they represent).
              We have no involvement in, and no liability for, those transactions.
            </p>
          </Section>

          <Section title="Affiliate links">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              Some links on this site are affiliate links. If you book an activity through them, we may earn
              a small commission from Viator at no extra cost to you.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              Our recommendations are based on editorial judgement — we only feature things we'd genuinely
              send a friend to. Commission does not influence which activities appear or how they are ranked.
            </p>
          </Section>

          <Section title="Your account">
            <ul style={{ fontSize: 14, lineHeight: 1.9, paddingLeft: 20, margin: 0 }}>
              <li>You must be at least 16 years old to create an account.</li>
              <li>You are responsible for keeping your password secure and for all activity under your account.</li>
              <li>You may delete your account at any time by emailing{' '}
                <a href="mailto:hello@10daysonaruba.com" style={{ color: 'var(--red)' }}>hello@10daysonaruba.com</a>.
                Deletion permanently removes all your data from our servers within 30 days.
              </li>
            </ul>
          </Section>

          <Section title="Acceptable use">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 10px' }}>You may not:</p>
            <ul style={{ fontSize: 14, lineHeight: 1.9, paddingLeft: 20, margin: 0 }}>
              <li>Scrape, copy, or redistribute our content in bulk without written permission.</li>
              <li>Attempt to access accounts or data that are not yours.</li>
              <li>Use the site in any way that violates Dutch law or the laws of your country.</li>
              <li>Transmit malware, spam, or any harmful code.</li>
            </ul>
          </Section>

          <Section title="Accuracy of information">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              Activity descriptions, prices, opening hours, and availability are provided for planning
              purposes and may not reflect current conditions. Always confirm details directly with
              the operator before travelling.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              We make no warranty — express or implied — about the accuracy, completeness, or fitness
              for a particular purpose of any information on this site.
            </p>
          </Section>

          <Section title="Limitation of liability">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              To the fullest extent permitted by Dutch law, 10daysonaruba.com shall not be liable for
              any indirect, incidental, or consequential loss arising from your use of the site or
              from activities booked through affiliate links. Our total liability to you for any
              direct claim shall not exceed €50.
            </p>
          </Section>

          <Section title="Intellectual property">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              All editorial content, copy, and code on this site is our property or used with permission.
              Activity photos from Viator are provided under their partner programme and remain the
              property of their respective owners. You may not reproduce site content without our
              prior written consent.
            </p>
          </Section>

          <Section title="Changes to these terms">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              We may update these terms from time to time. The "Last updated" date at the top of this
              page will change when we do. Continued use of the site after an update constitutes
              acceptance of the revised terms.
            </p>
          </Section>

          <Section title="Governing law">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              These terms are governed by the laws of the Netherlands. Any disputes shall be subject
              to the exclusive jurisdiction of the courts of Amsterdam, unless mandatory consumer
              protection law in your country of residence requires otherwise.
            </p>
          </Section>

          <Section title="Contact">
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              Questions about these terms?{' '}
              <a href="mailto:hello@10daysonaruba.com" style={{ color: 'var(--red)' }}>hello@10daysonaruba.com</a>
            </p>
          </Section>

          <p style={{ fontSize: 13, color: 'var(--ink)', opacity: 0.4, marginTop: 48 }}>
            See also our{' '}
            <button
              onClick={() => setPage('privacy')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--red)', fontFamily: 'inherit', padding: 0, textDecoration: 'underline' }}
            >
              Privacy Policy
            </button>.
          </p>
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
