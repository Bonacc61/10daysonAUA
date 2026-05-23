import type { ViatorGroup } from '../types';

type Props = {
  group: ViatorGroup;
  showChevron?: boolean;
};

// Dark green header band on the group card. Tappable — opens the group's
// affiliate URL in a new tab. The card chrome must NOT mention "Viator"
// (per the no-viator-branding rule); the outbound URL is enough.
export default function GroupHeader({ group, showChevron = true }: Props) {
  return (
    <a
      href={group.viator_group_url}
      target="_blank"
      rel="noopener noreferrer"
      className="card-header-band"
      aria-label={`View more ${group.name} options — ${group.tagline}`}
    >
      <div>
        <div className="chb-title">{group.name}</div>
        <div className="chb-subtitle">{group.tagline}</div>
      </div>
      {showChevron && <span aria-hidden className="chb-chev">›</span>}
    </a>
  );
}
