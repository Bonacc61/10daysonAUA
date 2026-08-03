import type { MatchTag, SlotEntry, Section, Region } from '../types';

export type Activity = {
  id: string;
  title: string;
  category: 'Beaches' | 'Activities' | 'Watersports' | 'Food' | 'Tours';
  image: string;
  description: string;
  localsSay: string;
  cost: string;
  duration: string;
  timeOfDay: 'Morning' | 'Afternoon' | 'Evening';
  fitReason: string;
  location: string;
  rating: number;
  reviewCount: number;
  adventure?: number;      // curated 0 (chill) … 100 (adrenaline); drives the Explore Vibe slider
  sections?: Section[];    // Explore taxonomy membership (editorial for local picks)
  matched_by: MatchTag[];
  // Set at runtime when a curated Viator product is matched to this local pick
  // (loadCatalog merges it in). Editorial title/blurb stay; rating/image/link
  // come from the matched product. Absent for purely-editorial picks.
  viator_item_url?: string;
  // Optional explicit region — used by lunch spots + region-aware suggestions.
  region?: Region;
  // True for activities that require a rental car (remote locations with no bus/taxi route).
  requires_car?: boolean;
  // Set on a hand-written local pick that duplicates a real-world experience which
  // Viator sells as a guided, bookable tour (e.g. the self-guided Arikok hike vs
  // Viator's guided Arikok/Natural-Pool tours). When the live catalog contains a
  // Viator item whose title matches this pattern, the generator drops this local
  // from the auto-fill pool and lets the bookable guided tour take the slot — it
  // stays browsable in Explore for DIY travellers. Absent for picks with no
  // Viator equivalent (beaches, free viewpoints, panaderias).
  viatorDupe?: RegExp;
};

export type Day = {
  day: number;
  title: string;
  color: string;
  // Each section is a list of planned entries (0+). Editable at runtime via
  // the itinerary plan; the seed below uses 0 or 1 entry per section.
  morning: SlotEntry[];
  afternoon: SlotEntry[];
  evening: SlotEntry[];
};

export type FAQItem = { q: string; a: string };

export type GtkSection = 'before' | 'first-day' | 'throughout';
export type GoodToKnowCard = {
  icon: 'wind' | 'sun' | 'dollar' | 'card' | 'car' | 'shield' | 'cloud' | 'msg' | 'doc' | 'drop' | 'wave' | 'bag';
  accent: string;
  title: string;
  body: string;
  section: GtkSection;   // which phase of the trip this tip belongs to
  note?: string;        // small "do this first" style flag (e.g. arrival steps)
  attribution?: string; // a local's signature, rendered handwritten-style
};

export const ACTIVITIES: Activity[] = [
  { id: 'eagle-beach-morning', title: 'Eagle Beach Sunrise Session', category: 'Beaches', image: '/Eagle Beach Sunrise.avif', description: "Consistently voted one of the Caribbean's top beaches. Wide, powdery sand — uncrowded before 9am. Find a spot under a divi-divi tree.", localsSay: '"Skip the hotel beach. Eagle Beach before breakfast is one of those mornings you\'ll remember for years." — Rosario', cost: 'Free', duration: '2–3 hrs', timeOfDay: 'Morning', fitReason: 'Quiet beach start', location: 'Eagle Beach, Noord', rating: 4.9, reviewCount: 2847, adventure: 8, sections: ['beaches'], matched_by: [] },
  { id: 'baby-beach-snorkel', title: 'Baby Beach & Snorkel Lagoon', requires_car: true, category: 'Beaches', image: '/Baby Beach.jpg', description: "Aruba's best-kept secret on the southern tip. Shallow, calm lagoon — a natural nursery for tropical fish and ideal for beginning snorkelers.", localsSay: '"Drive past the refinery and keep going. Bath-warm and crystal clear." — Miguel', cost: 'Free + $10 rental', duration: '3–4 hrs', timeOfDay: 'Morning', fitReason: 'Calm water, family-friendly', location: 'Seroe Colorado, San Nicolas', rating: 4.8, reviewCount: 1623, adventure: 18, sections: ['beaches'], matched_by: [] },
  { id: 'arikok-hiking', title: 'Arikok National Park Hike', requires_car: true, category: 'Activities', image: '/Arikok National Park Hike.jpg', description: '20% of the island. Limestone cliffs, natural pools, ancient cave paintings, and the dramatic northeast coast. Self-guided trails — no tour needed.', localsSay: '"Most tourists never leave Palm Beach. Arikok shows you what Aruba actually is." — Danilo', cost: '$11 entry', duration: '3–5 hrs', timeOfDay: 'Morning', fitReason: 'Nature & adventure', location: 'Arikok National Park', rating: 4.7, reviewCount: 934, adventure: 55, sections: ['adventures-outdoor'], matched_by: [], viatorDupe: /arikok|natural pool|conchi/i },
  { id: 'california-lighthouse-sunset', title: 'California Lighthouse Sunset', category: 'Beaches', image: '/California Lighthouse Sunset.jpg', description: "Northernmost point of the island, perfect golden-hour cliffside views. Tonight's sunset is at 6:42pm — arrive 30 min early.", localsSay: '"This is the spot for any first-night couple." — Jana', cost: 'Free', duration: '1–2 hrs', timeOfDay: 'Evening', fitReason: 'Classic first-night sunset', location: 'Hudishibana, Noord', rating: 4.7, reviewCount: 1289, adventure: 8, sections: ['beaches'], matched_by: [] },
  { id: 'flamingo-renaissance', title: 'Flamingo Beach Day Pass', category: 'Activities', image: '/Flamingo Beach Day Pass.webp', description: 'Private island with the famous wild flamingos. Day passes are limited and book out weeks ahead in peak season.', localsSay: '"Worth the early ferry — the flamingos are most active before 10am." — Lara', cost: '$99 day pass', duration: 'Full day', timeOfDay: 'Morning', fitReason: 'Truly unique experience', location: 'Renaissance Island', rating: 4.6, reviewCount: 3102, adventure: 12, sections: ['beaches'], matched_by: [] },
  { id: 'boca-catalina-snorkel', title: 'Catamaran Sail & Snorkel at Boca Catalina', category: 'Watersports', image: 'https://images.pexels.com/photos/1671325/pexels-photo-1671325.jpeg?auto=compress&cs=tinysrgb&w=800', description: 'Catamaran drops anchor at Boca Catalina — shallow rocky cove with exceptional clarity. Sea turtles feed here regularly.', localsSay: '"Stay back and let the turtles come to you." — Carlos', cost: '$65 pp', duration: '2–3 hrs', timeOfDay: 'Morning', fitReason: 'Matched to your skill level', location: 'Boca Catalina, Palm Beach', rating: 4.7, reviewCount: 1245, adventure: 32, sections: ['cruises-water'], matched_by: [] },
  { id: 'antilla-wreck-dive', title: 'Antilla Shipwreck Snorkel Cruise', category: 'Watersports', image: 'https://images.pexels.com/photos/1645028/pexels-photo-1645028.jpeg?auto=compress&cs=tinysrgb&w=800', description: "400-foot WWII German freighter — the Caribbean's largest sunken ship. Snorkel over the upper sections through coral-encrusted portals in 20–30 feet of crystal-clear water.", localsSay: '"You can see the whole wreck from the surface. Unreal." — Ramon', cost: '$60 pp', duration: '3–4 hrs', timeOfDay: 'Morning', fitReason: 'Because you asked for wrecks', location: 'Off Malmok Beach', rating: 4.9, reviewCount: 876, adventure: 60, sections: ['cruises-water'], matched_by: [] },
  { id: 'zeerovers-fresh-catch', title: 'Zeerovers Fish Fry', requires_car: true, category: 'Food', image: '/Zeerover.png', description: "Aruba's most authentic food experience — local fisherman's cooperative, fried fish by the pound, cash only.", localsSay: '"Order the wahoo." — Wilhelmina', cost: '$8–15 pp', duration: '1–2 hrs', timeOfDay: 'Afternoon', fitReason: 'Most authentic local food', location: 'Savaneta', rating: 4.8, reviewCount: 2103, adventure: 12, sections: ['food-drink'], matched_by: [] },
  { id: 'gasparito-restaurant', title: 'Dinner at Gasparito', category: 'Food', image: '/Dinner at Gasparito.jpg', description: '17th-century cunucu house in Noord. Traditional Aruban cuisine and the famed keshi yena.', localsSay: '"My family\'s special-occasion spot." — Sofia', cost: '$35–60 pp', duration: '2–3 hrs', timeOfDay: 'Evening', fitReason: 'Authentic Aruban cuisine', location: 'Noord', rating: 4.7, reviewCount: 1567, adventure: 8, sections: ['food-drink'], matched_by: [] },
  { id: 'oranjestad-walking', title: 'Oranjestad Walking Tour', category: 'Tours', image: 'https://images.pexels.com/photos/1118448/pexels-photo-1118448.jpeg?auto=compress&cs=tinysrgb&w=800', description: 'Pastel Dutch-Colonial downtown — Fort Zoutman, the museum, fresh pan bati at the panaderia.', localsSay: '"Before 9am, the city belongs to us again." — Hendrik', cost: '$25 guided', duration: '2–3 hrs', timeOfDay: 'Afternoon', fitReason: 'Light pace, your style', location: 'Oranjestad', rating: 4.5, reviewCount: 743, adventure: 20, sections: ['culture-history'], matched_by: [] },
  { id: 'kitesurfing-lesson', title: "Kitesurfing at Fisherman's Huts", category: 'Watersports', image: '/Kitesurfing Fishermans Huts.jpeg', description: "Constant 15–25 knot trade winds, shallow flat water. Aruba is one of the world's top kite spots.", localsSay: '"Consistent wind 320+ days a year." — Sven', cost: '$120 lesson', duration: '2–3 hrs', timeOfDay: 'Afternoon', fitReason: 'World-class kite conditions', location: "Fisherman's Huts, Malmok", rating: 4.8, reviewCount: 654, adventure: 85, sections: ['cruises-water'], matched_by: [] },
  { id: 'natural-pool-jeep', title: 'Natural Pool 4x4 & Snorkel Tour', category: 'Tours', image: 'https://images.pexels.com/photos/1125883/pexels-photo-1125883.jpeg?auto=compress&cs=tinysrgb&w=800', description: "Rugged 4x4 drive across Arikok's volcanic dunes to the lava-ringed Conchi natural pool — then snorkel in its sheltered cove.", localsSay: '"Not easy to get to. That\'s the whole point." — Marco', cost: '$75 pp', duration: '3–5 hrs', timeOfDay: 'Morning', fitReason: 'Off-the-beaten-path adventure', location: 'Arikok', rating: 4.9, reviewCount: 1102, adventure: 70, sections: ['adventures-outdoor'], matched_by: [] },
  { id: 'malmok-beach', title: 'Malmok Beach Snorkel', category: 'Beaches', image: '/Malmok Beach Snorkel.webp', description: "Calm, shallow water over a rocky bottom — Aruba's best shore-snorkel beach. Green turtles and reef fish right off the rocks, with the Antilla wreck just offshore.", localsSay: '"Get in before the catamarans arrive around 10 and the turtles are all yours." — Edsel', cost: 'Free + $10 rental', duration: '2–3 hrs', timeOfDay: 'Morning', fitReason: 'Best shore snorkeling', location: 'Malmok, Noord', rating: 4.7, reviewCount: 1118, adventure: 28, sections: ['beaches'], matched_by: [] },
  { id: 'tres-trapi', title: 'Tres Trapi Turtle Cove', category: 'Beaches', image: 'https://images.pexels.com/photos/1645028/pexels-photo-1645028.jpeg?auto=compress&cs=tinysrgb&w=800', description: '"Three steps" — concrete stairs drop you into a sheltered cove where green turtles graze the seagrass. Free shore entry, no boat needed, just south of Boca Catalina.', localsSay: '"Walk down the steps slowly, float, and wait. They surface for air right beside you." — Glennis', cost: 'Free + $10 rental', duration: '2–3 hrs', timeOfDay: 'Morning', fitReason: 'Free turtle snorkeling', location: 'Tres Trapi, Noord', rating: 4.8, reviewCount: 1452, adventure: 25, sections: ['beaches'], matched_by: [] },
  { id: 'manchebo-beach', title: 'Manchebo Beach Sunset', category: 'Beaches', image: '/Manchebo Beach Sunset.jpg', description: "Aruba's widest stretch of sand, far quieter than neighbouring Eagle. Acres of space, a handful of thatched palapas, and one of the island's best unobstructed sunsets.", localsSay: '"Eagle gets the crowds — walk five minutes south to Manchebo and it\'s just you and the sunset." — Yarzagaray', cost: 'Free', duration: '2–3 hrs', timeOfDay: 'Evening', fitReason: 'Widest sand, quiet sunset', location: 'Manchebo, Eagle Beach', rating: 4.7, reviewCount: 982, adventure: 6, sections: ['beaches'], matched_by: [] },
  { id: 'divi-beach', title: 'Druif (Divi) Beach', category: 'Beaches', image: '/Druif (Divi) Beach.webp', description: 'Soft white sand along the low-rise strip — calm, gently shelving water that suits families, and an easy barefoot stroll up to Eagle Beach.', localsSay: '"Druif is where locals bring the kids on a Sunday. Calm, shallow, no fuss." — Ruthlyn', cost: 'Free', duration: '2–3 hrs', timeOfDay: 'Afternoon', fitReason: 'Calm, family-friendly', location: 'Druif, Oranjestad', rating: 4.5, reviewCount: 638, adventure: 6, sections: ['beaches'], matched_by: [] },
  { id: 'mangel-halto', title: 'Mangel Halto Lagoon', requires_car: true, category: 'Beaches', image: '/Mangel Halto Lagoon.jpg', description: 'A mangrove-fringed lagoon on the calm south coast. Wade in from the dock or kayak the channels; just past the mangroves the reef drops into a wall of fish.', localsSay: '"Snorkel out through the cut in the reef — but only on a calm day, and always head back before the current turns." — Orlando', cost: 'Free + $10 rental', duration: '2–4 hrs', timeOfDay: 'Morning', fitReason: 'Mangrove lagoon snorkel', location: 'Pos Chiquito, Savaneta', rating: 4.7, reviewCount: 874, adventure: 25, sections: ['beaches'], matched_by: [] },
  { id: 'rodgers-beach', title: "Rodger's Beach", requires_car: true, category: 'Beaches', image: '/Rodgers Beach.png', description: 'A calm crescent right next to Baby Beach, framed by the old refinery hills. Glassy water, a local snack truck, and a fraction of the crowds.', localsSay: '"Everyone piles into Baby Beach. Rodger\'s, right next door, is where San Nicolas actually swims." — Ditmar', cost: 'Free', duration: '2–3 hrs', timeOfDay: 'Afternoon', fitReason: 'Calm, uncrowded south', location: 'Seroe Colorado, San Nicolas', rating: 4.6, reviewCount: 717, adventure: 8, sections: ['beaches'], matched_by: [] },
  { id: 'boca-grandi', title: 'Boca Grandi', requires_car: true, category: 'Beaches', image: '/Boca Grandi.png', description: 'Wild and windswept on the southeast coast — powerful surf and steady cross-shore wind make this a kitesurf and bodyboard beach, not a swimming one. Come for the drama, not the dip.', localsSay: '"Not for swimming — the current is no joke. But for wind, waves and an empty beach, nowhere beats it." — Shendrick', cost: 'Free', duration: '1–2 hrs', timeOfDay: 'Afternoon', fitReason: 'Wild surf & wind', location: 'Boca Grandi, San Nicolas', rating: 4.6, reviewCount: 543, adventure: 30, sections: ['beaches'], matched_by: [] },
  // The north-coast trio. `timeOfDay` is a HARD filter in matchPool (matcher.ts),
  // so these three are the only free beaches the generator can reach for their
  // slot — Arashi and Palm fill afternoons, which were the emptiest slot in the
  // plan, and Boca Catalina is a morning because the catamarans arrive by ten.
  { id: 'arashi-beach', title: 'Arashi Beach', category: 'Beaches', image: '/Arashi Beach.webp', description: "The island's northernmost swimming beach, tucked under the California Lighthouse where the high-rise strip finally runs out. Powder sand, thatched palapas that cost nothing, and water that stays flat when the trade winds have everywhere else churned up.", localsSay: '"The last beach before the lighthouse, and the calmest water on this side of the island. Snorkel the rocks at the north end." — needs a local sign-off', cost: 'Free', duration: '2–3 hrs', timeOfDay: 'Afternoon', fitReason: 'Calm water, free palapas', location: 'Arashi, Noord', rating: 4.7, reviewCount: 1180, adventure: 10, sections: ['beaches'], matched_by: [] },
  { id: 'boca-catalina-beach', title: 'Boca Catalina Beach', category: 'Beaches', image: '/Boca Catalina Beach.webp', description: 'A pocket of sand between two limestone ledges, with a buoyed swim area and reef fish a few strokes from shore — the shore-entry twin of the catamaran stop. Shade comes from one leaning mesquite, so it goes early.', localsSay: '"Come before ten. Once the catamarans drop anchor off the point, the quiet is over." — needs a local sign-off', cost: 'Free + $10 rental', duration: '2–3 hrs', timeOfDay: 'Morning', fitReason: 'Snorkel straight off the sand', location: 'Boca Catalina, Malmok', rating: 4.6, reviewCount: 690, adventure: 20, sections: ['beaches'], matched_by: [] },
  { id: 'palm-beach', title: 'Palm Beach', category: 'Beaches', image: '/Palm Beach afternoon.webp', description: 'Two miles of calm, shallow water in front of the high-rise hotels — paddleboards, jet skis, a pier to swim out to, and a bar within reach of every lounger. The busiest sand on Aruba, and the easiest afternoon you can have.', localsSay: '"The palapas belong to the hotels and go before breakfast. Walk north toward the fishing pier and the beach opens right up." — needs a local sign-off', cost: 'Free', duration: '2–3 hrs', timeOfDay: 'Afternoon', fitReason: 'Calm water, everything on tap', location: 'Palm Beach, Noord', rating: 4.6, reviewCount: 4200, adventure: 6, sections: ['beaches'], matched_by: [] },
];

/* ------------------------------------------------------------ *
 * Practical-info topics shown both in the Itinerary left rail   *
 * and as cards in the landing "Sample output" section.          *
 * ------------------------------------------------------------ */
export type InfoTopic = { title: string; body: string[] };

export const INFO_TOPICS: InfoTopic[] = [
  {
    title: 'Before arriving',
    body: [
      'Passport with 6+ months validity. No visa for US, EU, CA, UK, AU.',
      'Aruba runs US Pre-Customs at the airport — clear US customs here on your way home and skip the line stateside.',
      'Reef-safe sunscreen only in Arikok and most beaches. Standard sunscreen is restricted.',
      'Constant trade winds (15–25 kt). Pack a light layer for evenings.',
      'Tap water is safe — Aruba runs one of the largest desalination plants in the world.',
    ],
  },
  {
    title: 'Day of arrival',
    body: [
      'Beat the heat. Start at a beach before 10am — Eagle if you want quiet, Palm if you want a busier vibe.',
      'Lunch idea: Zeerovers (cash only, fried fresh fish) or any panaderia for a pastechi.',
      "Don't over-schedule day 1. Acclimate.",
      'California Lighthouse at sunset is the classic first-evening spot — touristy, but the clifftop views earn it.',
    ],
  },
  {
    title: 'Getting around',
    body: [
      'Rental car gives the most flexibility for the wild side of the island.',
      'Arubus L1 / L10 connect Palm Beach ↔ Oranjestad. Cheap, frequent, AC.',
      'Taxis are by-zone, not metered — confirm the fare before getting in.',
      'For Conchi / Arikok off-road: 4×4 required. Regular rentals void insurance off-road.',
    ],
  },
  {
    title: 'Medical assistance',
    body: [
      'Dial 911 for emergencies (same as the US).',
      'Horacio Oduber Hospital in Oranjestad is the main hospital. ER is 24/7.',
      'Botikas (pharmacies) are common. Bring prescriptions in original packaging.',
      'Travel insurance recommended — fees are paid up-front and reclaimed afterward.',
    ],
  },
  {
    title: "Nature: do's and don'ts",
    body: [
      "Don't touch coral or sea turtles. Locals will (rightly) call you out.",
      'Stay on marked trails in Arikok — flora is fragile and bites back.',
      "Don't feed iguanas. They swarm and lose fear of people.",
      'Carry your own trash. Bins are scarce on the wild side.',
      'Driving on dunes north of the California Lighthouse is prohibited.',
    ],
  },
  {
    title: 'Cash or card?',
    body: [
      'USD accepted everywhere. Florin (AWG) is the local currency.',
      'Cards work almost universally — Visa / Mastercard / Amex.',
      'Cash needed for Zeerovers, beach vendors, small panaderias, and tips.',
      'ATMs everywhere. Airport ATMs are convenient but lower per-transaction limits.',
    ],
  },
];

export const SAMPLE_ITINERARY: Day[] = [
  { day: 1, title: 'Arrive & Orient',   color: '#FF6B47',
    morning:   [{ kind: 'activity', id: 'eagle-beach-morning' }],
    afternoon: [],
    evening:   [{ kind: 'activity', id: 'california-lighthouse-sunset' }] },
  { day: 2, title: 'Reef & Local Bites', color: '#3B82F6',
    morning:   [{ kind: 'activity', id: 'malmok-beach' }],
    afternoon: [{ kind: 'activity', id: 'zeerovers-fresh-catch' }],
    evening:   [{ kind: 'activity', id: 'gasparito-restaurant' }] },
  { day: 3, title: 'Wild Aruba',         color: '#22C55E',
    morning:   [{ kind: 'activity', id: 'arikok-hiking' }],
    afternoon: [{ kind: 'activity', id: 'oranjestad-walking' }],
    evening:   [{ kind: 'activity', id: 'manchebo-beach' }] },
  { day: 4, title: 'Flamingos & Wind',   color: '#EAB308',
    morning:   [{ kind: 'activity', id: 'flamingo-renaissance' }],
    afternoon: [{ kind: 'activity', id: 'kitesurfing-lesson' }],
    evening:   [{ kind: 'activity', id: 'gasparito-restaurant' }] },
  { day: 5, title: 'Wind & Farewell',    color: '#E63946',
    morning:   [{ kind: 'activity', id: 'baby-beach-snorkel' }],
    afternoon: [],
    evening:   [{ kind: 'activity', id: 'california-lighthouse-sunset' }] },
];

export const CATEGORIES = ['All', 'Beaches', 'Activities', 'Watersports', 'Food', 'Tours'] as const;
export const BUDGET_FILTERS = ['Any', 'Free', 'Under $50', '$50–$100', '$100+'] as const;

export const FAQ_ITEMS: FAQItem[] = [
  { q: 'Is this actually built by Aruba locals?', a: 'Yes. The picks come from a working group of Arubans — chefs, dive masters, hotel staff, and a few r/Aruba moderators. The AI handles sequencing and timing; humans approve every recommendation that makes it into a plan.' },
  { q: 'Can I modify the itinerary the AI gives me?', a: 'Always. Swap a day, drop a stop, change the pace, add an extra rest day — nothing is locked.' },
  { q: 'What does it cost?', a: "The plan is free. If you book accommodation, activities, or rentals through our links, prices match what you'd see direct on the partner site. Some of those links are affiliate links — we may earn a small commission, at no extra cost to you, which keeps the planner free." },
  { q: 'Is this good for cruise ship passengers?', a: 'Yes — pick the "day trip" mode and we\'ll build a 6–8 hour itinerary from your terminal.' },
  { q: 'How current is the information?', a: 'Hours, prices, and seasonal closures are refreshed every 14 days. Weather-dependent picks are pulled live when you generate the plan.' },
];

// Ordered by trip phase (before → first-day → throughout); the landing page
// groups by `section` and renders them as a scroll-through timeline.
export const GTK_CARDS: GoodToKnowCard[] = [
  // ── Before you get here ──────────────────────────────────────────────
  { section: 'before', icon: 'doc',    accent: '#E63946', title: 'The ED-card & the $20 fee', note: 'Arrival form — do this first', body: "Every air arrival files a free ED-card at edcardaruba.aw within 7 days of landing, plus a one-time $20 sustainability fee (ages 8+, once per calendar year). Airlines check it before you board. Ignore any site charging $80+ to \"process\" it — they're middlemen. Cruise passengers are usually exempt." },
  { section: 'before', icon: 'cloud',  accent: '#3B82F6', title: 'Weather', body: "Year-round ~82°F and below the hurricane belt, so the season barely matters. Rain is short showers, mostly Oct–Dec; Jan–May is the driest stretch." },
  { section: 'before', icon: 'sun',    accent: '#EAB308', title: 'Sun', body: "A desert island just below the hurricane belt — you'll burn faster than you expect. Reef-safe sunscreen only: Aruba banned the oxybenzone kind, so check your bottle before you pack." },
  { section: 'before', icon: 'card',   accent: '#22C55E', title: 'Currency', body: "The florin is pegged to the dollar (~1.79), so USD works everywhere and cards are fine. Keep small USD bills for tips, taxis and local food stalls." },

  // ── Your first day ───────────────────────────────────────────────────
  { section: 'first-day', icon: 'car',  accent: '#8B5CF6', title: 'No Uber here', note: 'Taxis run the island', body: "Uber, Bolt and Lyft don't operate on Aruba — but you won't be stranded. Licensed taxis run fixed government rates, so there's no haggling; just round up for good service. Your hotel receptionist will call one for you in seconds. Allow 15–20 minutes for it to arrive. Agree on the fare before you get in for longer runs like the airport or San Nicolas." },
  { section: 'first-day', icon: 'car',  accent: '#FF6B47', title: 'Driving', attribution: 'your cab driver', body: "Right-hand side. Paved roads and Arikok's main route are fine in any car, but the Natural Pool and wild north coast need a real 4×4 — and taking a regular rental off-road voids your insurance. Donkeys, goats and iguanas legally have the right of way out in the cunucu, so slow down." },
  { section: 'first-day', icon: 'bag',  accent: '#00B4D8', title: 'Stock up like an Aruban', note: 'Beach kit sorted', body: "Before you hit the sand, swing by Bula Surf Shop (Harbour House, Weststraat 2, Oranjestad) for everything you forgot to pack — rubber slippers, boardshorts, tank tops, reef-safe sunscreen, a cold-keeping thermos and the island-favourite Dushi Yiu tees. It's the local one-stop for beach kit, so you skip the resort-boutique markup and blend right in." },
  { section: 'first-day', icon: 'wave', accent: '#E63946', title: 'Where to swim', attribution: 'the lifeguard, & we mean it', body: "Stick to the calm leeward (west) side — Palm, Eagle, Baby Beach. The windward north and east coasts look spectacular, but the currents and undertow are genuinely dangerous. Don't swim there, no matter how good the photo looks." },

  // ── Throughout your stay ─────────────────────────────────────────────
  { section: 'throughout', icon: 'drop',   accent: '#3B82F6', title: 'Tap water', body: "Drink it — Aruba's tap meets WHO standards, so locals never buy bottled. With no freshwater rivers, the island desalinates Caribbean seawater (distillation + reverse osmosis) into crystal-clear water. Bring a refillable bottle and skip the plastic." },
  { section: 'throughout', icon: 'wind',   accent: '#22C55E', title: 'Wind', body: "Steady trade winds, 15–25 mph: bliss on a hot beach, war on a bad-hair day — and why there are barely any mosquitoes. Eagle and Arashi stay calmest by afternoon." },
  { section: 'throughout', icon: 'dollar', accent: '#EAB308', title: 'Tipping', attribution: 'the r/Aruba crew', body: "Restaurants often pool a 10–15% service charge (check the bill) split house-wide, so an extra 5–10% to your server is kind. Taxis run fixed government rates, cash only — just round up." },
  { section: 'throughout', icon: 'msg',    accent: '#FF6B47', title: 'Language', attribution: 'danki! kom weer', body: "English is everywhere and Dutch is official, but the mother tongue is Papiamento. Try bon dia (good day), danki (thanks) and dushi (sweet/lovely)." },
];

export const activityById = (id: string | null): Activity | undefined =>
  id ? ACTIVITIES.find((a) => a.id === id) : undefined;
