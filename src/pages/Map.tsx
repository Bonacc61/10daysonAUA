import { useState, useMemo, useEffect, useRef } from 'react';
import RMap, { Marker, Popup, Source, Layer, NavigationControl, type MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useCatalog } from '../data/useCatalog';
import { useAuth } from '../lib/auth';
import { generatePlan } from '../data/itineraryGenerator';
import { ACTIVITY_COORDS, GROUP_COORDS, VIATOR_ITEM_COORDS } from '../data/coords';
import { LUNCHSPOTS } from '../data/lunchspots';
import { viatorLink } from '../data/exploreItems';
import type { Answers, PageId } from '../App';
import type { SlotEntry } from '../types';
import type { Catalog } from '../data/activitySource';

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';
const ARUBA_CENTER = { longitude: -70.0164, latitude: 12.5211, zoom: 11.5 };


type Coord = { lng: number; lat: number };
type DayEntry = { key: string; slot: string; title: string; image: string | null; coord: Coord | null; price: string | null; duration: string | null; url: string | null };

// Local ('activity'-kind) entries are usually catalog activities, but curated
// lunch spots (added by the "Suggest lunch spot" button or the en-route
// suggestion) live outside the catalog in LUNCHSPOTS — check both so their cards
// (image/title/cost) resolve instead of falling back to the raw id.
function localActivity(id: string, catalog: Catalog) {
  return catalog.activities.find(a => a.id === id) ?? LUNCHSPOTS.find(l => l.id === id);
}

function coordFor(entry: SlotEntry): Coord | null {
  if (entry.kind === 'activity') return ACTIVITY_COORDS[entry.id] ?? null;
  return VIATOR_ITEM_COORDS[entry.bestSellerId] ?? GROUP_COORDS[entry.groupId] ?? null;
}

function imageFor(entry: SlotEntry, catalog: Catalog): string | null {
  if (entry.kind === 'activity') return localActivity(entry.id, catalog)?.image ?? null;
  return catalog.items.find(i => i.id === entry.bestSellerId)?.image_url ?? null;
}

function priceFor(entry: SlotEntry, catalog: Catalog): string | null {
  if (entry.kind === 'activity') return localActivity(entry.id, catalog)?.cost ?? null;
  const item = catalog.items.find(i => i.id === entry.bestSellerId);
  return item?.price_usd ? `From $${Math.round(item.price_usd)}` : null;
}

function durationFor(entry: SlotEntry, catalog: Catalog): string | null {
  if (entry.kind === 'activity') return localActivity(entry.id, catalog)?.duration ?? null;
  return catalog.items.find(i => i.id === entry.bestSellerId)?.duration ?? null;
}

function titleFor(entry: SlotEntry, catalog: Catalog): string {
  if (entry.kind === 'activity') return localActivity(entry.id, catalog)?.title ?? entry.id;
  return catalog.items.find(i => i.id === entry.bestSellerId)?.title
    ?? catalog.groups.find(g => g.id === entry.groupId)?.name
    ?? entry.groupId;
}

function urlFor(entry: SlotEntry, catalog: Catalog): string | null {
  const raw = entry.kind === 'activity'
    ? localActivity(entry.id, catalog)?.viator_item_url
    : catalog.items.find(i => i.id === entry.bestSellerId)?.viator_item_url;
  return raw ? viatorLink(raw) : null;
}

// The light base style still renders highway route shields (1, 2, 1A, 8A) as
// numbered badges that read almost identically to our numbered stop markers.
// After style load we hide every shield / road-number / exit / junction layer,
// keeping road lines, place names, and the coastline. Minimal structural type so
// we don't need mapbox-gl's types here; the real map satisfies it.
type ShieldMap = {
  getStyle: () => { layers?: { id: string }[] } | undefined;
  setLayoutProperty: (id: string, name: string, value: unknown) => void;
};
const SHIELD_LAYER_RE = /shield|road-number|road-exit|motorway-junction/i;
function hideRoadShields(map: ShieldMap): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (SHIELD_LAYER_RE.test(layer.id)) {
      try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch { /* layer already absent */ }
    }
  }
}

type AnyPopup = { lng: number; lat: number; title: string; sub: string; price?: string | null; duration?: string | null; image?: string | null; url?: string | null };
// Display labels only — the underlying variant order/indices (activePlanIdx) are
// unchanged. Three parallel adjectives; "Your trip"/"-leaning" dropped.
const PLAN_VARIANTS = [
  { label: 'Balanced',   description: 'Your personalised itinerary' },
  { label: 'Adventure',  description: 'Adrenaline-first, beaches second' },
  { label: 'Chill',      description: 'Slow mornings, easy afternoons' },
];

type Props = { answers: Answers; canSeeItinerary: boolean; setPage: (p: PageId) => void };

export default function TripMap({ answers, canSeeItinerary, setPage }: Props) {
  const { catalog } = useCatalog();
  const { user } = useAuth();
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
    const slots: Array<[string, SlotEntry[]]> = [
      ['Morning', planDay.morning],
      ['Afternoon', planDay.afternoon],
      ['Evening', planDay.evening],
    ];
    return slots.flatMap(([slot, entries]) =>
      entries.map((entry, i) => ({
        key: `${slot}-${i}`,
        slot,
        title: titleFor(entry, catalog),
        image: imageFor(entry, catalog),
        coord: coordFor(entry),
        price: priceFor(entry, catalog),
        duration: durationFor(entry, catalog),
        url: urlFor(entry, catalog),
      }))
    );
  }, [planDay, catalog]);

  // Located stops for the map: every entry that has a coordinate, numbered 1..N
  // in chronological (morning→afternoon→evening) order so the markers match the
  // card order. Stops that resolve to the SAME point (Viator items sharing a
  // group centroid) are fanned out on a small circle so all of them stay visible
  // instead of stacking into a single pin. Coordless entries are excluded here
  // (still listed in the photo strip below) — not silently dropped from the day.
  const locatedEntries = useMemo(() => {
    const located = dayEntries.filter((e): e is typeof e & { coord: Coord } => !!e.coord);
    const buckets = new Map<string, number>();
    for (const e of located) {
      const k = `${e.coord.lng.toFixed(5)},${e.coord.lat.toFixed(5)}`;
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return located.map((e, i) => {
      const k = `${e.coord.lng.toFixed(5)},${e.coord.lat.toFixed(5)}`;
      const total = buckets.get(k)!;
      let coord = e.coord;
      if (total > 1) {
        const pos = seen.get(k) ?? 0;
        seen.set(k, pos + 1);
        const angle = (2 * Math.PI * pos) / total;
        const R = 0.0016; // ~180m — enough to separate pins at our zoom levels
        coord = { lng: coord.lng + R * Math.cos(angle), lat: coord.lat + R * Math.sin(angle) };
      }
      return { ...e, coord, num: i + 1 };
    });
  }, [dayEntries]);

  // Straight-line waypoints for the active day (used as fallback + for Directions API)
  const straightCoords = useMemo((): [number, number][] =>
    locatedEntries.map(e => [e.coord.lng, e.coord.lat]),
    [locatedEntries],
  );

  // Road-snapped route from Mapbox Directions API
  const [roadCoords, setRoadCoords] = useState<[number, number][] | null>(null);
  useEffect(() => {
    if (!TOKEN || straightCoords.length < 2) { setRoadCoords(null); return; }
    let alive = true;
    const coordStr = straightCoords.map(([lng, lat]) => `${lng},${lat}`).join(';');
    fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&access_token=${TOKEN}`)
      .then(r => r.json())
      .then((data: { routes?: Array<{ geometry: { coordinates: [number, number][] } }> }) => {
        if (alive) setRoadCoords(data.routes?.[0]?.geometry?.coordinates ?? null);
      })
      .catch(() => { /* fall back to straight */ });
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

  const routeCoords = roadCoords ?? straightCoords;
  const dayColor = planDay?.color ?? '#E63946';

  return (
    <div style={{ height: 'calc(100vh - 70px)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Map fills remaining space above the bottom panel */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <RMap
          ref={mapRef}
          mapboxAccessToken={TOKEN}
          initialViewState={ARUBA_CENTER}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/light-v11"
          onLoad={() => {
            const m = mapRef.current?.getMap();
            if (m) hideRoadShields(m as unknown as ShieldMap);
            setMapReady(true);
          }}
          onClick={() => setPopup(null)}
        >
          <NavigationControl position="top-right" />

          {/* Road-snapped route for the active day */}
          {planDay && routeCoords.length >= 2 && (
            <Source type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords } }}>
              <Layer id="route-line" type="line" paint={{ 'line-color': dayColor, 'line-width': 4, 'line-opacity': 0.9 }} />
            </Source>
          )}

          {/* Photo pin markers for active day — every located stop, numbered to
              match the card order, de-stacked so shared coordinates stay visible */}
          {planDay && locatedEntries.map(e => (
            <Marker key={e.key} longitude={e.coord.lng} latitude={e.coord.lat} anchor="bottom"
              onClick={ev => { ev.originalEvent.stopPropagation(); setPopup({ lng: e.coord.lng, lat: e.coord.lat, title: e.title, sub: e.slot, price: e.price, duration: e.duration, image: e.image, url: e.url }); }}>
              <PhotoPin image={e.image} color={dayColor} label={String(e.num)} />
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

      {/* ── Bottom panel: CTA when logged out ── */}
      {!user && (
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
      {user && plan && planDay && (
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
                onClick={() => e.coord && setPopup({ lng: e.coord.lng, lat: e.coord.lat, title: e.title, sub: e.slot, price: e.price, duration: e.duration, image: e.image, url: e.url })}
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

// Photo pin marker: circular photo above a coloured triangle tail.
function PhotoPin({ image, color, label }: { image: string | null; color: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.3))' }}>
      <div style={{ width: 50, height: 50, borderRadius: '50%', border: `3px solid ${color}`, background: '#e0dbd0', overflow: 'hidden', position: 'relative' }}>
        {image
          ? <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={ev => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
          : <div style={{ width: '100%', height: '100%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: 'Inter,sans-serif' }}>{label}</div>
        }
        {/* Number badge overlay — only when photo fills the circle, so label isn't shown twice */}
        {image && <div style={{ position: 'absolute', bottom: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: color, border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700, fontFamily: 'Inter,sans-serif' }}>{label}</div>}
      </div>
      {/* Triangle tail */}
      <div style={{ width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: `9px solid ${color}`, marginTop: -1 }} />
    </div>
  );
}
