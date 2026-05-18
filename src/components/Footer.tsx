export default function Footer() {
  return (
    <div className="bleed" style={{ background: 'var(--ink)', color: 'var(--cream)', textAlign: 'center' }}>
      <div className="container-1280 footer-content" style={{ padding: '28px 36px' }}>
        <img
          src="/logo-horizontal-dark.png"
          alt="10 days on Aruba"
          style={{ height: 30, width: 'auto', display: 'inline-block', verticalAlign: 'middle' }}
        />
        <div style={{ fontSize: 12, color: '#888', marginTop: 10 }}>Made on the island. ♥</div>
      </div>
    </div>
  );
}
