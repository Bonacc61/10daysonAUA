import type { MatchTag, SlotEntry } from '../types';

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
  matched_by: MatchTag[];
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

export type GoodToKnowCard = {
  icon: 'wind' | 'sun' | 'dollar' | 'card' | 'car' | 'shield' | 'cloud' | 'msg';
  accent: string;
  title: string;
  body: string;
};

export const ACTIVITIES: Activity[] = [
  { id: 'eagle-beach-morning', title: 'Eagle Beach Sunrise Session', category: 'Beaches', image: 'https://images.pexels.com/photos/1450340/pexels-photo-1450340.jpeg?auto=compress&cs=tinysrgb&w=800', description: "Consistently voted one of the Caribbean's top beaches. Wide, powdery sand — uncrowded before 9am. Find a spot under a divi-divi tree.", localsSay: '"Skip the hotel beach. Eagle Beach before breakfast is one of those mornings you\'ll remember for years." — Rosario', cost: 'Free', duration: '2–3 hrs', timeOfDay: 'Morning', fitReason: 'Quiet start for day 1', location: 'Eagle Beach, Noord', rating: 4.9, reviewCount: 2847, matched_by: [] },
  { id: 'baby-beach-snorkel', title: 'Baby Beach & Snorkel Lagoon', category: 'Beaches', image: 'https://images.pexels.com/photos/1430676/pexels-photo-1430676.jpeg?auto=compress&cs=tinysrgb&w=800', description: "Aruba's best-kept secret on the southern tip. Shallow, calm lagoon — a natural nursery for tropical fish and ideal for beginning snorkelers.", localsSay: '"Drive past the refinery and keep going. Bath-warm and crystal clear." — Miguel', cost: 'Free + $10 rental', duration: '3–4 hrs', timeOfDay: 'Morning', fitReason: 'Calm water, family-friendly', location: 'Seroe Colorado, San Nicolas', rating: 4.8, reviewCount: 1623, matched_by: [] },
  { id: 'arikok-hiking', title: 'Arikok National Park Guided Hike', category: 'Activities', image: 'https://images.pexels.com/photos/618833/pexels-photo-618833.jpeg?auto=compress&cs=tinysrgb&w=800', description: '20% of the island. Limestone cliffs, natural pools, ancient cave paintings, and the dramatic northeast coast.', localsSay: '"Most tourists never leave Palm Beach. Arikok shows you what Aruba actually is." — Danilo', cost: '$11 + $45 tour', duration: '3–5 hrs', timeOfDay: 'Morning', fitReason: 'Nature & adventure', location: 'Arikok National Park', rating: 4.7, reviewCount: 934, matched_by: [] },
  { id: 'california-lighthouse-sunset', title: 'California Lighthouse Sunset', category: 'Beaches', image: 'https://images.pexels.com/photos/1252500/pexels-photo-1252500.jpeg?auto=compress&cs=tinysrgb&w=800', description: "Northernmost point of the island, perfect golden-hour cliffside views. Tonight's sunset is at 6:42pm — arrive 30 min early.", localsSay: '"This is the spot for any first-night couple." — Jana', cost: 'Free', duration: '1–2 hrs', timeOfDay: 'Evening', fitReason: "Locals' first-night spot", location: 'Hudishibana, Noord', rating: 4.7, reviewCount: 1289, matched_by: [] },
  { id: 'flamingo-renaissance', title: 'Flamingo Beach Day Pass', category: 'Activities', image: 'https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=800', description: 'Private island with the famous wild flamingos. Day passes are limited and book out weeks ahead in peak season.', localsSay: '"Worth the early ferry — the flamingos are most active before 10am." — Lara', cost: '$99 day pass', duration: 'Full day', timeOfDay: 'Morning', fitReason: 'Truly unique experience', location: 'Renaissance Island', rating: 4.6, reviewCount: 3102, matched_by: [] },
  { id: 'boca-catalina-snorkel', title: 'Snorkeling at Boca Catalina', category: 'Watersports', image: 'https://images.pexels.com/photos/1671325/pexels-photo-1671325.jpeg?auto=compress&cs=tinysrgb&w=800', description: 'Shallow rocky cove with exceptional clarity. Sea turtles feed here regularly.', localsSay: '"Stay back and let the turtles come to you." — Carlos', cost: '$65 guided', duration: '2–3 hrs', timeOfDay: 'Morning', fitReason: 'Matched to your skill level', location: 'Boca Catalina, Palm Beach', rating: 4.7, reviewCount: 1245, matched_by: [] },
  { id: 'antilla-wreck-dive', title: 'Antilla Shipwreck Dive', category: 'Watersports', image: 'https://images.pexels.com/photos/1645028/pexels-photo-1645028.jpeg?auto=compress&cs=tinysrgb&w=800', description: '400-foot WWII German freighter scuttled in 1940. Upper sections sit in 60 feet — accessible to Open Water divers.', localsSay: '"World-class. Different every dive." — Ramon', cost: '$85 2-tank', duration: '3–4 hrs', timeOfDay: 'Morning', fitReason: 'Because you asked for wrecks', location: 'Off Malmok Beach', rating: 4.9, reviewCount: 876, matched_by: [] },
  { id: 'zeerovers-fresh-catch', title: 'Zeerovers Fish Fry', category: 'Food', image: 'https://images.pexels.com/photos/566345/pexels-photo-566345.jpeg?auto=compress&cs=tinysrgb&w=800', description: "Aruba's most authentic food experience — local fisherman's cooperative, fried fish by the pound, cash only.", localsSay: '"Order the wahoo." — Wilhelmina', cost: '$8–15 pp', duration: '1–2 hrs', timeOfDay: 'Afternoon', fitReason: 'Most authentic local food', location: 'Savaneta', rating: 4.8, reviewCount: 2103, matched_by: [] },
  { id: 'gasparito-restaurant', title: 'Dinner at Gasparito', category: 'Food', image: 'https://images.pexels.com/photos/1267320/pexels-photo-1267320.jpeg?auto=compress&cs=tinysrgb&w=800', description: '17th-century cunucu house in Noord. Traditional Aruban cuisine and the famed keshi yena.', localsSay: '"My family\'s special-occasion spot." — Sofia', cost: '$35–60 pp', duration: '2–3 hrs', timeOfDay: 'Evening', fitReason: 'Authentic Aruban cuisine', location: 'Noord', rating: 4.7, reviewCount: 1567, matched_by: [] },
  { id: 'oranjestad-walking', title: 'Oranjestad Walking Tour', category: 'Tours', image: 'https://images.pexels.com/photos/1118448/pexels-photo-1118448.jpeg?auto=compress&cs=tinysrgb&w=800', description: 'Pastel Dutch-Colonial downtown — Fort Zoutman, the museum, fresh pan bati at the panaderia.', localsSay: '"Before 9am, the city belongs to us again." — Hendrik', cost: '$25 guided', duration: '2–3 hrs', timeOfDay: 'Afternoon', fitReason: 'Light pace, your style', location: 'Oranjestad', rating: 4.5, reviewCount: 743, matched_by: [] },
  { id: 'kitesurfing-lesson', title: "Kitesurfing at Fisherman's Huts", category: 'Watersports', image: 'https://images.pexels.com/photos/2179473/pexels-photo-2179473.jpeg?auto=compress&cs=tinysrgb&w=800', description: "Constant 15–25 knot trade winds, shallow flat water. Aruba is one of the world's top kite spots.", localsSay: '"Consistent wind 320+ days a year." — Sven', cost: '$120 lesson', duration: '2–3 hrs', timeOfDay: 'Afternoon', fitReason: 'World-class kite conditions', location: "Fisherman's Huts, Malmok", rating: 4.8, reviewCount: 654, matched_by: [] },
  { id: 'natural-pool-jeep', title: 'Conchi Natural Pool Jeep Tour', category: 'Tours', image: 'https://images.pexels.com/photos/1125883/pexels-photo-1125883.jpeg?auto=compress&cs=tinysrgb&w=800', description: 'Lava-ringed cove on the wild northeast coast, only reachable by 4WD or a 2-hour hike.', localsSay: '"Not easy to get to. That\'s the whole point." — Marco', cost: '$75 pp', duration: '3–5 hrs', timeOfDay: 'Morning', fitReason: 'Off-the-beaten-path adventure', location: 'Arikok', rating: 4.9, reviewCount: 1102, matched_by: [] },
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
      "California Lighthouse at sunset is the locals' classic intro evening.",
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
  { day: 2, title: 'Reef & Ruins',      color: '#3B82F6',
    morning:   [{ kind: 'activity', id: 'boca-catalina-snorkel' }],
    afternoon: [{ kind: 'activity', id: 'oranjestad-walking' }],
    evening:   [{ kind: 'activity', id: 'antilla-wreck-dive' }] },
  { day: 3, title: 'Wild Aruba',        color: '#22C55E',
    morning:   [{ kind: 'activity', id: 'arikok-hiking' }],
    afternoon: [{ kind: 'activity', id: 'natural-pool-jeep' }],
    evening:   [{ kind: 'activity', id: 'zeerovers-fresh-catch' }] },
  { day: 4, title: 'Beach & Flamingos', color: '#EAB308',
    morning:   [{ kind: 'activity', id: 'flamingo-renaissance' }],
    afternoon: [{ kind: 'activity', id: 'baby-beach-snorkel' }],
    evening:   [{ kind: 'activity', id: 'gasparito-restaurant' }] },
  { day: 5, title: 'Wind & Farewell',   color: '#E63946',
    morning:   [{ kind: 'activity', id: 'kitesurfing-lesson' }],
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

export const GTK_CARDS: GoodToKnowCard[] = [
  { icon: 'wind',   accent: '#3B82F6', title: 'Wind',     body: 'Constant trade winds, 15–25 mph. Pleasant on a hot beach, brutal on a bad-hair day. Eagle and Arashi are more sheltered in afternoons.' },
  { icon: 'sun',    accent: '#EF4444', title: 'Sun',      body: 'Below the hurricane belt + desert island = you burn fast. Reef-safe sunscreen is required in Arikok and most beaches.' },
  { icon: 'dollar', accent: '#22C55E', title: 'Tipping',  body: 'Not expected by taxis, appreciated for great service. Restaurants often include 15% service charge — check the bill.' },
  { icon: 'card',   accent: '#EAB308', title: 'Currency', body: 'USD accepted everywhere. Florin is the local currency. Cards work universally; carry small USD for tips and markets.' },
  { icon: 'car',    accent: '#EF4444', title: 'Driving',  body: 'Right-hand side. Tourist-area roads are fine. North coast and Arikok need 4×4 — taking a regular rental off-road voids insurance.' },
  { icon: 'shield', accent: '#3B82F6', title: 'Safety',   body: "Among the safest in the Caribbean. Don't leave valuables in a rental car — leave the glove box visibly open." },
  { icon: 'cloud',  accent: '#22C55E', title: 'Weather',  body: 'Below the hurricane belt, year-round destination. Mid-January through May is driest.' },
  { icon: 'msg',    accent: '#EAB308', title: 'Language', body: 'Everyone speaks English. Locals love when you try "bon dia" (good morning) and "danki" (thanks) in Papiamento.' },
];

export const activityById = (id: string | null): Activity | undefined =>
  id ? ACTIVITIES.find((a) => a.id === id) : undefined;
