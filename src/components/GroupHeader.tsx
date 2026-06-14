import type { ViatorGroup } from '../types';

type Props = {
  group: ViatorGroup;
  // Where the header band links. Defaults to the group's browse URL, but the
  // cards pass the specific suggested tour's URL so the band opens that tour —
  // not Viator's generic "Things to do in Aruba" thumbnail page.
  href?: string;
  showChevron?: boolean;
};

// Dark green header band on the group card. Tappable — opens the suggested
// tour (or the group's browse URL if no specific href is given) in a new tab.
// The card chrome must NOT mention "Viator" (per the no-viator-branding rule);
// the outbound URL is enough.
export default function GroupHeader({ group, href, showChevron = true }: Props) {
  return (
    <a
      href={href ?? group.viator_group_url}
      target="_blank"
      rel="noopener noreferrer"
      className="card-header-band"
      aria-label={`View ${group.name} — ${group.tagline}`}
    >
      <div>
        <div className="chb-title">{group.name}</div>
        <div className="chb-subtitle">{group.tagline}</div>
      </div>
      {showChevron && <span aria-hidden className="chb-chev">›</span>}
    </a>
  );
}
