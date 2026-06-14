import type { ViatorGroup } from '../types';

type Props = {
  group: ViatorGroup;
  // The specific tour URL the band should open. When absent the band renders as
  // a plain, non-clickable label — it must NEVER fall back to a category/browse
  // page (the old group.viator_group_url was the generic "things to do in Aruba"
  // thumbnail page, which is exactly what we don't want).
  href?: string;
  showChevron?: boolean;
};

// Dark green header band on the group card. Opens the suggested tour in a new
// tab when we have a real product URL; otherwise it's just a label. The card
// chrome must NOT mention "Viator" (per the no-viator-branding rule).
export default function GroupHeader({ group, href, showChevron = true }: Props) {
  const inner = (
    <>
      <div>
        <div className="chb-title">{group.name}</div>
        <div className="chb-subtitle">{group.tagline}</div>
      </div>
      {showChevron && href && <span aria-hidden className="chb-chev">›</span>}
    </>
  );

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
