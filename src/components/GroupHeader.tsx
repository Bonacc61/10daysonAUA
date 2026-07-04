import type { ViatorGroup } from '../types';

type Props = {
  group: ViatorGroup;
  href?: string;
  showChevron?: boolean;
  onNavigate?: () => void;
  pinned?: boolean;
};

export default function GroupHeader({ group, href, showChevron = true, onNavigate, pinned }: Props) {
  const inner = (
    <>
      <div>
        <div className="chb-title">{group.name}</div>
        <div className="chb-subtitle">{group.tagline}</div>
      </div>
      {pinned && <span className="itin-pinned-badge">★ Your pick</span>}
      {showChevron && (href || onNavigate) && <span aria-hidden className="chb-chev">›</span>}
    </>
  );

  if (onNavigate) {
    return (
      <button
        type="button"
        className="card-header-band"
        onClick={onNavigate}
        aria-label={`Explore ${group.name}`}
      >
        {inner}
      </button>
    );
  }

  if (!href) {
    return <div className="card-header-band">{inner}</div>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="card-header-band"
      aria-label={`View ${group.name} — ${group.tagline}`}
    >
      {inner}
    </a>
  );
}
