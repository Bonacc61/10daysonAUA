import { useState, useMemo, useEffect, useRef } from 'react';
import RMap, { Marker, Popup, Source, Layer, NavigationControl, type MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useCatalog } from '../data/useCatalog';
import { generatePlan } from '../data/itineraryGenerator';
import { pinFor, type Pin } from '../data/itemCoords';
import { layoutMarkers, tetherLines } from '../data/markerLayout';
import { LUNCHSPOTS } from '../data/lunchspots';
import { viatorLink } from '../data/exploreItems';
import type { Answers, PageId } from '../App';
import { dayHues } from '../data/dayHues';
import { planLegs, splitLeg } from '../data/routeLegs';
import { distanceKm } from '../data/coordValidate';
import type { SlotEntry, MatchTag, Slot, ViatorItem } from '../types';
import { resolveSlotEntry, type Catalog } from '../data/activitySource';
import { answersToTags } from '../data/answerTags';

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';
const ARUBA_CENTER = { longitude: -70.0164, latitude: 12.5211, zoom: 11.5 };


type Coord = { lng: number; lat: number };
type DayEntry = { key: string; slot: string; title: string; image: string | null; coord: Coord | null; pin: Pin | null; price: string | null; duration: string | null; url: string | null };

// Local ('activity'-kind) entries are usually catalog activities, but curated
// lunch spots (added by the "Suggest lunch spot" button or the en-route
// suggestion) live outside the catalog in LUNCHSPOTS — check both so their cards
// (image/title/cost) resolve instead of falling back to the raw id.
function localActivity(id: string, catalog: Catalog) {
  return catalog.activities.find(a => a.id === id) ?? LUNCHSPOTS.find(l => l.id === id);
}

// Where an activity happens, from the pin registry (src/data/itemCoords.ts).
// Returns null — never a fallback — for an item with no researched coordinate.
// Such an activity draws no marker; it owns a stretch of the day's route instead,
// so it stays visible without the map claiming a point nobody verified.
// The item a stored card ACTUALLY renders as. The plan stores only ids, and the
// live catalog moves under them — product codes churn, and we drop whole classes
// of product (transfers, party buses, retail) at ingest. `resolveSlotEntry` is
// the display chokepoint that heals that: a stored id no longer in the catalog
// re-faces to the best-fitting item in the same group, which is why a card whose
// product has gone still shows something sensible in the itinerary.
//
// The map used to look the stored id up in `catalog.items` directly, so it saw
// none of that. A saved plan holding a since-removed product rendered on the
// itinerary as (say) "Luxury Four-Course Caribbean Dinner Cruise Experience"
// with its photo, and on the map as a photo-less, price-less pin whose title had
// quietly fallen back to the GROUP name. Same plan, same catalog, two answers.
//
// Resolving through the same function means the two surfaces agree by
// construction rather than by both being kept in step by hand.
function faceOf(entry: SlotEntry, catalog: Catalog, tags: Set<MatchTag>, slot?: Slot): ViatorItem | null {
  if (entry.kind === 'activity') return null;
  const resolved = resolveSlotEntry(entry, catalog, tags, slot);
  return resolved?.kind === 'group' ? resolved.bestSeller : null;
}

// Coordinates follow the RESOLVED item too — a pin for a product that is no
// longer in the plan is worse than no pin.
function pinForEntry(entry: SlotEntry, catalog: Catalog, tags: Set<MatchTag>, slot?: Slot): Pin | null {
  if (entry.kind === 'activity') return pinFor(entry.id) ?? null;
  const face = faceOf(entry, catalog, tags, slot);
  return (face ? pinFor(face.id) : null) ?? pinFor(entry.bestSellerId) ?? null;
}

function imageFor(entry: SlotEntry, catalog: Catalog, tags: Set<MatchTag>, slot?: Slot): string | null {
  if (entry.kind === 'activity') return localActivity(entry.id, catalog)?.image ?? null;
  return faceOf(entry, catalog, tags, slot)?.image_url ?? null;
}

function priceFor(entry: SlotEntry, catalog: Catalog, tags: Set<MatchTag>, slot?: Slot): string | null {
  if (entry.kind === 'activity') return localActivity(entry.id, catalog)?.cost ?? null;
  const item = faceOf(entry, catalog, tags, slot);
  return item?.price_usd ? `From $${Math.round(item.price_usd)}` : null;
}

function durationFor(entry: SlotEntry, catalog: Catalog, tags: Set<MatchTag>, slot?: Slot): string | null {
  if (entry.kind === 'activity') return localActivity(entry.id, catalog)?.duration ?? null;
  return faceOf(entry, catalog, tags, slot)?.duration ?? null;
}

function titleFor(entry: SlotEntry, catalog: Catalog, tags: Set<MatchTag>, slot?: Slot): string {
  if (entry.kind === 'activity') return localActivity(entry.id, catalog)?.title ?? entry.id;
  return faceOf(entry, catalog, tags, slot)?.title
    ?? catalog.groups.find(g => g.id === entry.groupId)?.name
    ?? entry.groupId;
}

function urlFor(entry: SlotEntry, catalog: Catalog, tags: Set<MatchTag>, slot?: Slot): string | null {
  const raw = entry.kind === 'activity'
    ? localActivity(entry.id, catalog)?.viator_item_url
    : faceOf(entry, catalog, tags, slot)?.viator_item_url;
  return raw ? viatorLink(raw) : null;
}

// The base style still renders highway route shields (1, 2, 1A, 8A) as
// numbered badges that read almost identically to our numbered stop markers.
// After style load we hide every shield / road-number / exit / junction layer,
// keeping road lines, place names, and the coastline. Minimal structural type so
// we don't need mapbox-gl's types here; the real map satisfies it.
type StyleMap = {
  getStyle: () => { layers?: { id: string }[] } | undefined;
  setLayoutProperty: (id: string, name: string, value: unknown) => void;
};
const SHIELD_LAYER_RE = /shield|road-number|road-exit|motorway-junction/i;
function hideRoadShields(map: StyleMap): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (SHIELD_LAYER_RE.test(layer.id)) {
      try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch { /* layer already absent */ }
    }
  }
}

type AnyPopup = { lng: number; lat: number; title: string; sub: string; price?: string | null; duration?: string | null; image?: string | null; url?: string | null; pin?: Pin | null; place?: string };
// Display labels only — the underlying variant order/indices (activePlanIdx) are
// unchanged. Three parallel adjectives; "Your trip"/"-leaning" dropped.
const PLAN_VARIANTS = [
  { label: 'Balanced',   description: 'Your personalised itinerary' },
  { label: 'Adventure',  description: 'Adrenaline-first, beaches second' },
  { label: 'Chill',      description: 'Slow mornings, easy afternoons' },
];

/** Cache key for a tether: the exact Directions request it stands for. */
const tetherKey = (coords: [number, number][]) =>
  coords.map(([lng, lat]) => `${lng},${lat}`).join(';');

type Props = { answers: Answers; canSeeItinerary: boolean; setPage: (p: PageId) => void };

export default function TripMap({ answers, canSeeItinerary, setPage }: Props) {
  const { catalog } = useCatalog();
  // Same tags the itinerary resolves with, so both surfaces pick the same face
  // for a card whose stored product has left the catalog.
  const tags = useMemo(() => answersToTags(answers), [answers]);
  const [popup, setPopup] = useState<AnyPopup | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [activePlanIdx, setActivePlanIdx] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef>(null);
  // Set on style load so the initial fitBounds runs once the map can accept it
  // (the effect early-returns while the map isn't ready).
  const [mapReady, setMapReady] = useState(false);

  // Generate 3 variant plans matching the Dashboard's itinerary variants. Always
  // generated — a logged-out / pre-quiz visitor gets a sample itinerary (from the
  // default answers) so the Map shows the same clean single-route view as everyone
  // else, rather than the old catalog-browse mode (legend + scattered pins). The
  // "answer 8 questions" CTAs still overlay for those visitors.
  const plans = useMemo(() => {
    const adventureAnswers = {
      ...answers,
      adventureLevel: Math.max(answers.adventureLevel, 75),
      interests: [...new Set([...answers.interests, 'adventure', 'nature-hiking'])],
    };
    const chillAnswers = {
      ...answers,
      adventureLevel: Math.min(answers.adventureLevel, 25),
      interests: [...new Set([
        ...answers.interests.filter(i => i !== 'adventure' && i !== 'nature-hiking'),
        'beach-chill', 'wellness-spa',
      ])],
    };
    return [
      generatePlan(answers,         catalog, { seed: 0 }),
      generatePlan(adventureAnswers, catalog, { seed: 0 }),
      generatePlan(chillAnswers,     catalog, { seed: 0 }),
    ];
  }, [answers, catalog]);

  const plan = plans?.[activePlanIdx] ?? null;

  const switchPlan = (idx: number) => {
    setActivePlanIdx(idx);
    setActiveDay(1);
    setPopup(null);
  };

  // Clamp activeDay when plan length is known
  const totalDays = plan?.length ?? 0;
  const safeDay = Math.min(Math.max(activeDay, 1), totalDays || 1);
  const planDay = plan?.[safeDay - 1] ?? null;

  // Build the entries for the active day with image + coord
  const dayEntries = useMemo((): DayEntry[] => {
    if (!planDay) return [];
    const slots: Array<[string, Slot, SlotEntry[]]> = [
      ['Morning', 'morning', planDay.morning],
      ['Afternoon', 'afternoon', planDay.afternoon],
      ['Evening', 'evening', planDay.evening],
    ];
    return slots.flatMap(([slot, slotId, entries]) =>
      entries.map((entry, i) => ({
        key: `${slot}-${i}`,
        slot,
        title: titleFor(entry, catalog, tags, slotId),
        image: imageFor(entry, catalog, tags, slotId),
        coord: pinForEntry(entry, catalog, tags, slotId)?.coord ?? null,
        pin: pinForEntry(entry, catalog, tags, slotId),
        price: priceFor(entry, catalog, tags, slotId),
        duration: durationFor(entry, catalog, tags, slotId),
        url: urlFor(entry, catalog, tags, slotId),
      }))
    );
  }, [planDay, catalog, tags]);

  // Located stops for the map: every entry that has a coordinate, numbered 1..N
  // in chronological (morning→afternoon→evening) order so the markers match the
  // card order. Stops that resolve to the SAME point (Viator items sharing a
  // group centroid) are fanned out on a small circle so all of them stay visible
  // instead of stacking into a single pin. Coordless entries are excluded here
  // (still listed in the photo strip below) — not silently dropped from the day.
  // Markers for the day: every activity's primary location plus the further
  // places a multi-stop activity visits, fanned apart where they share a point.
  // See src/data/markerLayout.ts — the layout is pure and tested there, because
  // the interesting cases (a stop landing on another activity's pin, stops not
  // consuming stop numbers) are exactly where this goes quietly wrong.
  const locatedEntries = useMemo(() => layoutMarkers(dayEntries), [dayEntries]);

  // The places each multi-stop activity visits, in order — one jeep safari's
  // three stops rather than three separate outings.
  const tethers = useMemo(() => tetherLines(locatedEntries), [locatedEntries]);

  // Road-snapped geometry for each tether, cached BY COORDINATE STRING.
  //
  // The first attempt keyed this on the activity index and cleared the whole map
  // at the top of the effect, copying the day route's stale-geometry guard. That
  // threw every result away: a re-render changed the `tethers` array identity,
  // the effect re-ran, its cleanup set `alive = false`, and the in-flight
  // response was dropped. Visible as duplicate Directions requests and a tether
  // that stayed a straight line through Arikok National Park while the day's
  // route curved along real roads.
  //
  // A coordinate-keyed cache cannot go stale the way that clearing was guarding
  // against, because the key IS the request: an entry is only ever reused for
  // the identical pair of points. So nothing is cleared, results merge in as
  // they arrive, and a re-render costs nothing.
  const [tetherGeo, setTetherGeo] = useState<Record<string, [number, number][]>>({});
  // Which keys have been requested. A REF, not state, and not an effect
  // dependency: putting the cache in the dependency array made every write
  // re-run the effect, and the cleanup then set `alive = false` on responses
  // still in flight — so the geometry arrived, was discarded, and the tether
  // stayed straight. There is also no cleanup flag at all now: a late response
  // writes a coordinate-keyed entry that is correct whenever it lands, so there
  // is nothing to cancel.
  const tetherAsked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!TOKEN) return;
    for (const t of tethers) {
      const key = tetherKey(t.coords);
      if (tetherAsked.current.has(key)) continue;
      tetherAsked.current.add(key);
      fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${key}?geometries=geojson&overview=full&access_token=${TOKEN}`)
        .then(r => r.json())
        .then((data: { routes?: Array<{ geometry?: { coordinates: [number, number][] } }> }) => {
          const line = data.routes?.[0]?.geometry?.coordinates;
          if (line?.length) setTetherGeo(prev => ({ ...prev, [key]: line }));
        })
        .catch(() => { tetherAsked.current.delete(key); });   // allow a retry
    }
  }, [tethers, TOKEN]);

  // Route waypoints come from TRUE coordinates — dayEntries, before the marker
  // displacement above — with consecutive duplicates dropped. Routing on the
  // displaced anchors drew a phantom ~175m zigzag between stops that are
  // actually at the same place.
  //
  // `owners` records which day activities each leg belongs to. An activity with
  // no coordinate owns the leg spanning it, so it reads as "this happens
  // somewhere along here" rather than vanishing from the map. See
  // docs/superpowers/specs/2026-08-03-map-pin-accuracy-design.md.
  const { waypoints, legOwners } = useMemo(() => planLegs(dayEntries), [dayEntries]);

  const straightCoords = useMemo((): [number, number][] =>
    waypoints.map(w => [w.coord.lng, w.coord.lat]),
    [waypoints],
  );

  // Road-snapped route, one geometry PER LEG. steps=true is what makes per-leg
  // geometry available: the top-level route geometry is a single polyline, which
  // cannot be split per activity. Falls back to straight legs on any failure.
  const [roadLegs, setRoadLegs] = useState<[number, number][][] | null>(null);
  useEffect(() => {
    // Clear FIRST, unconditionally. Without this the previous day's road geometry
    // is rendered against the new day's legOwners for the length of the fetch —
    // and forever if the fetch fails, since the catch below cannot distinguish a
    // stale array from a fresh one. Drawing another day's roads is the worst
    // failure available to a feature whose whole premise is not claiming
    // unverified geography.
    setRoadLegs(null);
    if (!TOKEN || straightCoords.length < 2) return;
    let alive = true;
    const coordStr = straightCoords.map(([lng, lat]) => `${lng},${lat}`).join(';');
    fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&steps=true&access_token=${TOKEN}`)
      .then(r => r.json())
      .then((data: { routes?: Array<{ legs?: Array<{ steps?: Array<{ geometry?: { coordinates: [number, number][] } }> }> }> }) => {
        if (!alive) return;
        const legs = data.routes?.[0]?.legs;
        if (!legs?.length) { setRoadLegs(null); return; }
        setRoadLegs(legs.map(leg =>
          (leg.steps ?? []).flatMap(st => st.geometry?.coordinates ?? [])));
      })
      .catch(() => { if (alive) setRoadLegs(null); });  // straight legs
    return () => { alive = false; };
  }, [straightCoords, TOKEN]);

  // Reset strip scroll when day changes
  useEffect(() => {
    stripRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, [safeDay]);

  // Frame all of the active day's located stops — on load (once mapReady flips)
  // and on every day change (locatedEntries changes). fitBounds on a single point
  // collapses to an empty box, so a lone stop uses setCenter + a fixed zoom.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const valid = locatedEntries.map(e => e.coord);
    if (valid.length === 0) return;
    if (valid.length === 1) {
      mapRef.current.flyTo({ center: [valid[0].lng, valid[0].lat], zoom: 13, duration: 800 });
      return;
    }
    const lngs = valid.map(c => c.lng);
    const lats = valid.map(c => c.lat);
    mapRef.current.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 80, maxZoom: 14, duration: 800 },
    );
  }, [locatedEntries, mapReady]);

  if (!TOKEN) {
    return (
      <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', padding: 24 }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 10px' }}>One step away</h2>
          <p style={{ color: '#666', marginBottom: 16 }}>Add <code style={{ background: '#ede8de', padding: '2px 6px', borderRadius: 4 }}>VITE_MAPBOX_TOKEN=pk.ey…</code> to <code>.env.production</code></p>
        </div>
      </div>
    );
  }

  const dayColor = planDay?.color ?? '#E63946';
  // One shade per ACTIVITY, darkest first, so a day's markers and route segments
  // are individually legible and the day reads in order — while still being
  // obviously one day. Indexed by position in dayEntries rather than by located
  // stop, so an activity with no coordinate still owns a hue and its stretch of
  // route is distinguishable. See src/data/dayHues.ts.
  const entryHues = dayHues(dayColor, dayEntries.length);
  const hueFor = (idx: number) => entryHues[idx] ?? dayColor;

  // One LineString per leg, coloured by the activity that owns it. A leg shared
  // by several coordless activities is split into equal parts so each keeps its
  // own hue instead of overplotting.
  const routeFeatures = legOwners.flatMap((owners, legIdx) => {
    const line = roadLegs?.[legIdx]?.length
      ? roadLegs[legIdx]
      : [straightCoords[legIdx], straightCoords[legIdx + 1]].filter(Boolean) as [number, number][];
    if (line.length < 2) return [];
    return splitLeg(line, owners.length).map((slice, i) => ({
      type: 'Feature' as const,
      properties: { color: hueFor(owners[i] ?? owners[0] ?? legIdx) },
      geometry: { type: 'LineString' as const, coordinates: slice },
    }));
  });

  const tetherFeatures = tethers.map(t => ({
    type: 'Feature' as const,
    properties: { color: hueFor(t.idx), tether: true },
    geometry: { type: 'LineString' as const, coordinates: tetherGeo[tetherKey(t.coords)] ?? t.coords },
  }));

  return (
    <div style={{ height: 'calc(100vh - 70px)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Map fills remaining space above the bottom panel */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <RMap
          ref={mapRef}
          mapboxAccessToken={TOKEN}
          initialViewState={ARUBA_CENTER}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/streets-v12"
          onLoad={() => {
            const m = mapRef.current?.getMap();
            if (m) {
              hideRoadShields(m as unknown as StyleMap);
            }
            setMapReady(true);
          }}
          onClick={() => setPopup(null)}
        >
          <NavigationControl position="top-right" />

          {/* Road-snapped route for the active day, one segment per activity.
              Discrete segments rather than a single gradient line, so a stretch
              can belong to a named activity — including one with no coordinate,
              which owns the leg spanning it and would otherwise be invisible. */}
          {planDay && routeFeatures.length > 0 && (
            <Source type="geojson" data={{ type: 'FeatureCollection', features: [...routeFeatures, ...tetherFeatures] }}>
              <Layer
                id="route-line"
                type="line"
                filter={['!', ['to-boolean', ['get', 'tether']]]}
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-width': 4, 'line-opacity': 0.9, 'line-color': ['get', 'color'] }}
              />
              {/* The stops of ONE activity, dashed, so a jeep safari's three pins
                  read as one tour. Shares the route's source deliberately: a
                  second <Source> was silently never updated by react-map-gl —
                  React handed it 1001 road points and the map kept the 2-point
                  straight line, which drew a tether through Arikok National Park.
                  One source that provably updates is worth more than two that
                  look tidier. */}
              <Layer
                id="tether-line"
                type="line"
                filter={['to-boolean', ['get', 'tether']]}
                layout={{ 'line-cap': 'round' }}
                paint={{ 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [2, 1.6] }}
              />
            </Source>
          )}

          {/* Photo pin markers for active day — every located stop, numbered to
              match the card order, de-stacked so shared coordinates stay visible */}
          {planDay && locatedEntries.map((e, i) => (
            <Marker key={e.key} longitude={e.coord.lng} latitude={e.coord.lat} anchor="bottom"
              onClick={ev => { ev.originalEvent.stopPropagation(); setPopup({ lng: e.coord.lng, lat: e.coord.lat, title: e.title, sub: e.slot, price: e.price, duration: e.duration, image: e.image, url: e.url, pin: e.pin, place: e.place }); }}>
              <PhotoPin image={e.image} color={hueFor(e.idx)} label={String(e.num)} secondary={!e.primary} />
            </Marker>
          ))}

          {/* Popup — styled as chunky card, no category header */}
          {popup && (
            <Popup longitude={popup.lng} latitude={popup.lat} closeOnClick={false} onClose={() => setPopup(null)} anchor="bottom" offset={16} maxWidth="220px" className="map-popup">
              <a
                href={popup.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => { if (!popup.url) e.preventDefault(); }}
                style={{ display: 'block', fontFamily: 'Inter,sans-serif', minWidth: 180, textDecoration: 'none', color: 'inherit', cursor: popup.url ? 'pointer' : 'default' }}
              >
                {popup.image && (
                  <div style={{ width: '100%', height: 110, overflow: 'hidden', background: '#e0dbd0' }}>
                    <img src={popup.image} alt={popup.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={ev => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                )}
                <div style={{ padding: '8px 10px 10px' }}>
                  <div style={{ fontSize: 10, color: '#888', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.4 }}>{popup.sub}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1a1a1a', marginBottom: 5, lineHeight: 1.3 }}>{popup.title}</div>
                  {(popup.price || popup.duration) && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: popup.url ? 6 : 0 }}>
                      {popup.price && <span style={{ fontSize: 11, color: '#E63946', fontWeight: 600 }}>{popup.price}</span>}
                      {popup.duration && <span style={{ fontSize: 11, color: '#888' }}>⏱ {popup.duration}</span>}
                    </div>
                  )}
                  <PickupBlock pin={popup.pin ?? null} />
                  {popup.url && (
                    <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>Tap to book on Viator →</div>
                  )}
                </div>
              </a>
            </Popup>
          )}
        </RMap>

        {/* No-itinerary CTA */}
        {!canSeeItinerary && (
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, background: 'rgba(255,251,240,0.97)', backdropFilter: 'blur(12px)', border: '2px solid #1a1a1a', borderRadius: 12, padding: '16px 18px', maxWidth: 240, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'Inter,sans-serif', marginBottom: 6 }}>Map your trip</div>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 12px', lineHeight: 1.5 }}>Answer 8 questions to see your day-by-day route mapped across Aruba.</p>
            <button onClick={() => setPage('questionnaire')} className="btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}>Start planning →</button>
          </div>
        )}
      </div>

      {/* ── Bottom panel: CTA when there is no itinerary to show yet ── */}
      {/* Gated on canSeeItinerary (qDone || user), NOT on user alone. Someone who
          finished the questionnaire without logging in has a plan — the Itinerary
          page shows it — but this panel used to tell them to "start the quiz"
          they had just completed, and the day switcher below stayed hidden, so
          the map was stuck on day 1 with no way to reach the rest of the trip. */}
      {!canSeeItinerary && (
        <div style={{ background: 'rgba(255,251,240,0.98)', backdropFilter: 'blur(12px)', borderTop: '2px solid var(--ink)', flexShrink: 0, padding: '20px 24px', textAlign: 'center' }}>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 12px', color: 'var(--ink)', lineHeight: 1.2 }}>
            Plan your Aruba trip
          </p>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 14px', fontFamily: 'Inter,sans-serif' }}>
            Answer 8 quick questions — see your personalised day-by-day route mapped across the island.
          </p>
          <button onClick={() => setPage('questionnaire')} className="btn-red" style={{ fontSize: 13 }}>
            Start the quiz →
          </button>
        </div>
      )}

      {/* ── Bottom panel: plan switcher + day nav + activity photo strip ── */}
      {canSeeItinerary && plan && planDay && (
        <div style={{ background: 'rgba(255,251,240,0.98)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }}>

          {/* Itinerary variant switcher — mirrors Dashboard ITINERARY_VARIANTS */}
          <div style={{ padding: '10px 16px 0' }}>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 4 }}>
              {PLAN_VARIANTS.map((v, i) => {
                const active = activePlanIdx === i;
                return (
                  <button
                    key={i}
                    onClick={() => switchPlan(i)}
                    style={{ padding: '5px 14px', borderRadius: 20, border: `1.5px solid ${active ? '#1a1a1a' : '#ddd'}`, background: active ? '#1a1a1a' : 'transparent', color: active ? '#fff' : '#888', fontSize: 12, fontWeight: 600, fontFamily: 'Inter,sans-serif', cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
            {/* Left-aligned so it reads as a subtitle for the whole control, not
                a caption under the centred middle option. */}
            <p style={{ textAlign: 'left', fontSize: 11, color: '#aaa', fontFamily: 'Inter,sans-serif', margin: 0 }}>
              {PLAN_VARIANTS[activePlanIdx].description}
            </p>
          </div>

          {/* Mobile: ‹ Day N of M · Title › arrows */}
          <div className="map-day-arrows" style={{ alignItems: 'center', padding: '8px 16px 4px', gap: 12 }}>
            <button
              onClick={() => setActiveDay(d => Math.max(1, d - 1))}
              disabled={safeDay <= 1}
              style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid #ccc', background: safeDay <= 1 ? '#f5f5f5' : '#fff', cursor: safeDay <= 1 ? 'default' : 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: safeDay <= 1 ? '#ccc' : '#1a1a1a', flexShrink: 0 }}
            >‹</button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: dayColor, border: '1.5px solid rgba(0,0,0,0.1)' }} />
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Inter,sans-serif', color: '#1a1a1a' }}>Day {safeDay}</span>
                <span style={{ fontSize: 13, color: '#888', fontFamily: 'Inter,sans-serif' }}>of {totalDays}</span>
                <span style={{ fontSize: 13, color: '#555', fontFamily: 'Inter,sans-serif' }}>· {planDay.title}</span>
              </div>
            </div>
            <button
              onClick={() => setActiveDay(d => Math.min(totalDays, d + 1))}
              disabled={safeDay >= totalDays}
              style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid #ccc', background: safeDay >= totalDays ? '#f5f5f5' : '#fff', cursor: safeDay >= totalDays ? 'default' : 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: safeDay >= totalDays ? '#ccc' : '#1a1a1a', flexShrink: 0 }}
            >›</button>
          </div>

          {/* Desktop: clickable dot timeline across all days */}
          <div className="map-day-timeline" style={{ alignItems: 'flex-end', gap: 0, padding: '10px 24px 6px', overflowX: 'auto', scrollbarWidth: 'none' }}>
            {plan.map((d, i) => {
              const active = safeDay === i + 1;
              return (
                <button
                  key={d.day}
                  onClick={() => { setActiveDay(i + 1); setPopup(null); }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 10px', flexShrink: 0 }}
                >
                  <span style={{ fontSize: 11, fontWeight: active ? 700 : 400, fontFamily: 'Inter,sans-serif', color: active ? '#1a1a1a' : '#aaa', whiteSpace: 'nowrap', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {active ? d.title : `D${i + 1}`}
                  </span>
                  <div style={{ width: active ? 14 : 9, height: active ? 14 : 9, borderRadius: '50%', background: d.color, border: active ? '2px solid #1a1a1a' : '1.5px solid transparent', boxShadow: active ? '0 0 0 2px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.15s' }} />
                </button>
              );
            })}
          </div>

          {/* Horizontal photo strip */}
          <div ref={stripRef} className="map-strip-outer">
            <div className="map-strip-inner">
            {dayEntries.length === 0 && (
              <div style={{ fontSize: 13, color: '#aaa', fontFamily: 'Inter,sans-serif', padding: '12px 0' }}>Free day — nothing scheduled.</div>
            )}
            {dayEntries.map(e => (
              <div
                key={e.key}
                style={{ flexShrink: 0, width: 120, cursor: 'pointer' }}
                onClick={() => e.coord && setPopup({ lng: e.coord.lng, lat: e.coord.lat, title: e.title, sub: e.slot, price: e.price, duration: e.duration, image: e.image, url: e.url, pin: e.pin })}
              >
                <div style={{ width: 120, height: 72, borderRadius: 10, overflow: 'hidden', background: '#e8e2d6', border: `2px solid ${dayColor}`, flexShrink: 0 }}>
                  {e.image
                    ? <img src={e.image} alt={e.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={ev => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
                    : <div style={{ width: '100%', height: '100%', background: dayColor, opacity: 0.2 }} />
                  }
                </div>
                <div style={{ fontSize: 10, color: '#999', fontFamily: 'Inter,sans-serif', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{e.slot}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', fontFamily: 'Inter,sans-serif', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 3 }}>{e.title}</div>
                {(e.price || e.duration) && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
                    {e.price && <span style={{ fontSize: 10, color: '#E63946', fontWeight: 600 }}>{e.price}</span>}
                    {e.price && e.duration && <span style={{ fontSize: 10, color: '#ccc' }}>·</span>}
                    {e.duration && <span style={{ fontSize: 10, color: '#888' }}>{e.duration}</span>}
                  </div>
                )}
                {e.url && (
                  <div style={{ marginTop: 4, fontSize: 10, color: '#1a1a1a', fontWeight: 700, textDecoration: 'underline', letterSpacing: 0.2 }}>Book →</div>
                )}
              </div>
            ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Where the traveller is collected, when that differs from where the activity
 * happens. The pin marks the destination; this says where to actually stand.
 *
 * Renders ONLY when a pickup is actually known. Where it is unknown the card's
 * existing "Tap to book on Viator →" line already points at the authoritative
 * source, and a second line saying the same thing is noise.
 *
 * Currently no pin carries a pickup, and that is the design working rather than
 * a gap: every departure point the review found became the PIN itself
 * (source: 'departure'), because for a sunset sail the departure point is where
 * the activity happens. A separate pickup only applies to a product where both a
 * destination and a different collection point are known, and Viator publishes
 * no usable data for that — the 2026-08-03 probe found only 3 of 24 meeting-point
 * refs carried coordinates, and those were hotels on a pickup round.
 * See docs/map/viator-location-probe.md.
 */
function PickupBlock({ pin }: { pin: Pin | null }) {
  const pickup = pin?.pickup;

  // No separate pickup record, but the pin itself IS the departure point — which
  // is the case for every sail and cruise, where the boat leaves from where the
  // pin sits. Name it, because "Pelican Pier" is the one thing a traveller
  // actually needs and the title never says it.
  if (!pickup && pin?.source === 'departure' && pin.place) {
    return (
      <div style={{ margin: '7px -10px 0', padding: '7px 10px 8px', background: '#f4f0e4', borderTop: '1px solid #e3ddcc' }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#8c8c8c', marginBottom: 3 }}>Departs from</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: '#3a352e', lineHeight: 1.35 }}>{pin.place}</div>
        {pin.approx && (
          <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 3, fontStyle: 'italic' }}>
            Approximate — check your booking for the exact spot
          </div>
        )}
      </div>
    );
  }

  // A destination pin whose place is worth naming — "Conchi (Natural Pool)"
  // tells the traveller more than the tour title usually does.
  if (!pickup && pin?.place && pin.source !== 'curated') {
    return (
      <div style={{ margin: '7px -10px 0', padding: '7px 10px 8px', background: '#f4f0e4', borderTop: '1px solid #e3ddcc' }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#8c8c8c', marginBottom: 3 }}>Where</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: '#3a352e', lineHeight: 1.35 }}>
          {pin.place}{(pin.stops?.length ?? 0) > 0 ? ` + ${pin.stops!.length} more stop${pin.stops!.length > 1 ? 's' : ''}` : ''}
        </div>
      </div>
    );
  }

  if (!pickup) return null;
  const wrap = { margin: '7px -10px 0', padding: '7px 10px 8px', background: '#f4f0e4', borderTop: '1px solid #e3ddcc' };
  const head = { fontSize: 9, fontWeight: 700 as const, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#8c8c8c', marginBottom: 3 };

  const m = pin ? Math.round(distanceKm(pickup.coord, pin.coord) * 1000) : 0;
  return (
    <div style={wrap}>
      <div style={head}>Pickup</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#3a352e', lineHeight: 1.35 }}>{pickup.name}</div>
      {pickup.time && <div style={{ fontSize: 10.5, color: '#8c8c8c', marginTop: 2 }}>{pickup.time}</div>}
      {m > 150 && (
        <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 3, fontStyle: 'italic' }}>
          {m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`} from the pin — the tour travels to the activity
        </div>
      )}
    </div>
  );
}

// Photo pin marker: circular photo above a coloured triangle tail.
//
// `secondary` marks a further place a multi-stop activity visits. It keeps the
// activity's number and hue but is drawn smaller with a dashed ring, and a
// dashed tether joins it to the primary — so "Arikok + Conchi + Baby Beach"
// reads as one jeep safari with three stops, not three separate outings.
function PhotoPin({ image, color, label, secondary = false }: { image: string | null; color: string; label: string; secondary?: boolean }) {
  const size = secondary ? 34 : 50;
  const ring = secondary ? 2.5 : 3;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.3))', opacity: secondary ? 0.9 : 1 }}>
      <div style={{ width: size, height: size, borderRadius: '50%', border: `${ring}px ${secondary ? 'dashed' : 'solid'} ${color}`, background: '#e0dbd0', overflow: 'hidden', position: 'relative' }}>
        {image
          ? <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={ev => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
          : <div style={{ width: '100%', height: '100%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: secondary ? 11 : 14, fontWeight: 700, fontFamily: 'Inter,sans-serif' }}>{label}</div>
        }
        {image && <div style={{ position: 'absolute', bottom: 2, right: 2, width: secondary ? 13 : 16, height: secondary ? 13 : 16, borderRadius: '50%', background: color, border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: secondary ? 8 : 9, fontWeight: 700, fontFamily: 'Inter,sans-serif' }}>{label}</div>}
      </div>
      <div style={{ width: 0, height: 0, borderLeft: `${secondary ? 5 : 7}px solid transparent`, borderRight: `${secondary ? 5 : 7}px solid transparent`, borderTop: `${secondary ? 7 : 9}px solid ${color}`, marginTop: -1 }} />
    </div>
  );
}
