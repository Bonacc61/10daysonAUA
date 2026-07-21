import type { Activity } from './activities';
import type { CardEntry, Region } from '../types';

// Curated lunch spots, surfaced via the afternoon "Suggest lunchspot" button.
// Deliberately kept OUT of the main ACTIVITIES catalog (so they never show up in
// Explore or the swap pool) — resolveSlotEntry resolves them by id, so once
// added to a day they render as ordinary activity cards.
function spot(
  id: string, title: string, location: string, region: Region,
  description: string, cost: string, image: string,
): Activity {
  return {
    id, title, category: 'Food', image,
    description, localsSay: '"A local lunch favorite."',
    cost, duration: '1–2 hrs', timeOfDay: 'Afternoon',
    fitReason: 'Lunch near your plans', location,
    rating: 4.6, reviewCount: 0, adventure: 8,
    sections: ['food-drink'], matched_by: [], region,
  };
}

export const LUNCHSPOTS: Activity[] = [
  spot('lunch-pikas-corner', "Pika's Corner", 'Palm Beach', 'palm-beach', 'Casual local snack bar near the high-rise strip — pastechi, pan bati and cold drinks.', '$8–15 pp', "/Pika's Corner.jpg"),
  spot('lunch-pastechi-house', 'Pastechi House', 'Oranjestad', 'oranjestad', "Aruba's beloved pastechi stop — flaky fried turnovers with savory fillings.", '$6–12 pp', 'https://images.pexels.com/photos/1267320/pexels-photo-1267320.jpeg?auto=compress&cs=tinysrgb&w=800'),
  spot('lunch-zeerover', 'Zeerover', 'Savaneta', 'savaneta', "No-frills fishermen's spot — fresh catch fried by the pound, cash only.", '$10–18 pp', '/Zeerover.png'),
  spot('lunch-hadicurari', 'Hadicurari', 'Noord', 'noord', 'Beachfront eatery by the fishing pier — fresh seafood with your toes in the sand.', '$15–30 pp', '/Hadicurari.jpg'),
  spot('lunch-don-jacinto', 'Don Jacinto', 'Oranjestad', 'oranjestad', 'Authentic Aruban home cooking in a cozy downtown setting.', '$12–22 pp', '/Don Jacinto Aruba.jpg'),
  spot('lunch-las-cafeteros', 'Las Cafeteros', 'Tanki Leendert', 'oranjestad', 'Colombian-Aruban arepas, empanadas and strong coffee.', '$8–16 pp', '/Los Cafeteros Aruba.jpg'),
  spot('lunch-oniels', "O'Niels Caribbean Kitchen", 'San Nicolaas', 'san-nicolas', 'Hearty Caribbean plates in the colorful art town of San Nicolas.', '$10–20 pp', "/O'Niel Caribbean Kitchen.jpeg"),
  spot('lunch-willems-pancakes', 'Willems Pancakes', 'Noord', 'noord', 'Dutch pancakes, sweet and savory — a relaxed family favorite.', '$10–18 pp', '/Willems Pancakes.jpg'),
  spot('lunch-lindas-pancakes', "Linda's Dutch Pancakes", 'Noord', 'noord', 'Classic Dutch pannenkoeken with dozens of toppings.', '$10–18 pp', "/Linda's Dutch Pancakes.png"),
  spot('lunch-bingo', 'Bingo!', 'Noord', 'noord', 'Laid-back spot for burgers, bowls and fresh smoothies.', '$8–16 pp', 'https://images.pexels.com/photos/1267320/pexels-photo-1267320.jpeg?auto=compress&cs=tinysrgb&w=800'),
];

// Best-effort map from a free-text location to one of the lunch-spot regions.
// Only the four regions that actually have lunch spots need rules; anything else
// returns undefined and the suggester falls back to any spot.
const LOCATION_REGION: [RegExp, Region][] = [
  [/palm beach|malmok|fisherman|boca catalina|hudishibana/i, 'palm-beach'],
  [/san nicol/i, 'san-nicolas'],
  [/oranjestad|tanki/i, 'oranjestad'],
  [/noord/i, 'noord'],
];

export function regionFromLocation(loc: string): Region | undefined {
  for (const [re, region] of LOCATION_REGION) if (re.test(loc)) return region;
  return undefined;
}

// The region of a planned card — group region directly, or an activity's
// explicit region (lunch spots) falling back to its location text.
export function cardRegion(entry: CardEntry): Region | undefined {
  if (entry.kind === 'group') return entry.bestSeller.region ?? entry.group.region;
  return entry.activity.region ?? regionFromLocation(entry.activity.location);
}

// Pick a lunch spot near the previous card's region. Prefers a region match and
// an as-yet-unused spot; falls back to any unused, then any. null only if empty.
export function isLunchspot(id: string): boolean {
  return LUNCHSPOTS.some((l) => l.id === id);
}

export function suggestLunchspot(prevRegion: Region | undefined, usedIds: Set<string>): Activity | null {
  const fresh = LUNCHSPOTS.filter((l) => !usedIds.has(l.id));
  const pool = fresh.length ? fresh : LUNCHSPOTS;
  const matches = prevRegion ? pool.filter((l) => l.region === prevRegion) : [];
  const candidates = matches.length ? matches : pool;
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
