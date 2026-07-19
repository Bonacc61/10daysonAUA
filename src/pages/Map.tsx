import { useState, useMemo } from 'react';
import RMap, { Marker, Popup, Source, Layer, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useCatalog } from '../data/useCatalog';
import { generatePlan } from '../data/itineraryGenerator';
import { ACTIVITY_COORDS, GROUP_COORDS } from '../data/coords';
import { ACTIVITIES } from '../data/activities';
import type { Answers, PageId } from '../App';
import type { SlotEntry } from '../types';

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';

const ARUBA_CENTER = { longitude: -70.0164, latitude: 12.5211, zoom: 11.5 };

type Coord = { lng: number; lat: number };

function coordFor(entry: SlotEntry): Coord | null {
  if (entry.kind === 'activity') return ACTIVITY_COORDS[entry.id] ?? null;
  return GROUP_COORDS[entry.groupId] ?? null;
}

type MarkerInfo = {
  lng: number; lat: number;
  color: string; label: string;
  dayIndex: number;
  title: string; subtitle: string;
};

type RouteSource = {
  id: string; color: string; dayIndex: number;
  coordinates: [number, number][];
};

type Props = {
  answers: Answers;
  canSeeItinerary: boolean;
  setPage: (p: PageId) => void;
};

export default function TripMap({ answers, canSeeItinerary, setPage }: Props) {
  const { catalog } = useCatalog();
  const [popup, setPopup] = useState<MarkerInfo | null>(null);
  const [activeDay, setActiveDay] = useState<number | null>(null); // 1-based day number

  const plan = useMemo(
    () => (canSeeItinerary ? generatePlan(answers, catalog) : null),
    [answers, catalog, canSeeItinerary],
  );

  const { markers, routes } = useMemo(() => {
    if (!plan) return { markers: [] as MarkerInfo[], routes: [] as RouteSource[] };

    const markers: MarkerInfo[] = [];
    const routes: RouteSource[] = [];

    plan.forEach((day, dayIdx) => {
      const slots = [...day.morning, ...day.afternoon, ...day.evening];
      const coords: [number, number][] = [];
      let slotNum = 0;

      slots.forEach((entry) => {
        const c = coordFor(entry);
        if (!c) return;
        slotNum++;

        let title = '';
        let sub = '';
        if (entry.kind === 'activity') {
          const act = catalog.activities.find(a => a.id === entry.id);
          title = act?.title ?? entry.id;
          sub = act?.category ?? '';
        } else {
          const grp = catalog.groups.find(g => g.id === entry.groupId);
          title = grp?.name ?? entry.groupId;
          sub = 'Guided activity';
        }

        markers.push({
          lng: c.lng, lat: c.lat,
          color: day.color,
          label: String(slotNum),
          dayIndex: dayIdx,
          title,
          subtitle: `Day ${day.day} · ${sub}`,
        });
        coords.push([c.lng, c.lat]);
      });

      if (coords.length >= 2) {
        routes.push({ id: `route-${dayIdx}`, color: day.color, dayIndex: dayIdx, coordinates: coords });
      }
    });

    return { markers, routes };
  }, [plan, catalog]);

  const dayNum = activeDay;
  const visibleMarkers = dayNum ? markers.filter(m => m.dayIndex + 1 === dayNum) : markers;
  const visibleRoutes  = dayNum ? routes.filter(r => r.dayIndex + 1 === dayNum)  : routes;

  if (!TOKEN) {
    return (
      <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', padding: 24 }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>🗺️</div>
          <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 10px' }}>One step away</h2>
          <p style={{ color: '#666', marginBottom: 16, lineHeight: 1.6 }}>
            Add your free Mapbox public token to <code style={{ background: '#ede8de', padding: '2px 6px', borderRadius: 4 }}>.env.production</code>:
          </p>
          <code style={{ display: 'block', background: '#f4f0e8', padding: '12px 16px', borderRadius: 8, fontSize: 13, textAlign: 'left', border: '1px solid #ddd5c0' }}>
            VITE_MAPBOX_TOKEN=pk.ey…
          </code>
          <p style={{ color: '#999', fontSize: 13, marginTop: 10 }}>
            Get a free token at mapbox.com → Account → Tokens
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: 'calc(100vh - 70px)', position: 'relative', overflow: 'hidden' }}>
      <RMap
        mapboxAccessToken={TOKEN}
        initialViewState={ARUBA_CENTER}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        onClick={() => setPopup(null)}
      >
        <NavigationControl position="top-right" />

        {/* Dashed route lines */}
        {visibleRoutes.map(r => (
          <Source
            key={r.id}
            type="geojson"
            data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.coordinates } }}
          >
            <Layer
              id={`${r.id}-line`}
              type="line"
              paint={{ 'line-color': r.color, 'line-width': 3, 'line-opacity': 0.9, 'line-dasharray': [3, 1.5] }}
            />
          </Source>
        ))}

        {/* Itinerary markers */}
        {visibleMarkers.map((m, i) => (
          <Marker
            key={i}
            longitude={m.lng}
            latitude={m.lat}
            anchor="center"
            onClick={e => { e.originalEvent.stopPropagation(); setPopup(m); }}
          >
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: m.color, border: '2.5px solid #fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 11, fontWeight: 700,
              fontFamily: 'Inter, sans-serif', cursor: 'pointer',
            }}>
              {m.label}
            </div>
          </Marker>
        ))}

        {/* Popup */}
        {popup && (
          <Popup
            longitude={popup.lng}
            latitude={popup.lat}
            closeOnClick={false}
            onClose={() => setPopup(null)}
            anchor="bottom"
            offset={20}
          >
            <div style={{ padding: '2px 4px', minWidth: 160, fontFamily: 'Inter, sans-serif' }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{popup.subtitle}</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a1a' }}>{popup.title}</div>
            </div>
          </Popup>
        )}

        {/* Explore pins when no itinerary */}
        {!plan && ACTIVITIES.map(a => {
          const c = ACTIVITY_COORDS[a.id];
          if (!c) return null;
          return (
            <Marker key={a.id} longitude={c.lng} latitude={c.lat} anchor="center">
              <div style={{
                width: 11, height: 11, borderRadius: '50%',
                background: '#E63946', border: '2px solid #fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
              }} />
            </Marker>
          );
        })}
      </RMap>

      {/* Day legend */}
      {plan && plan.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 32, left: 16, zIndex: 10,
          background: 'rgba(255,251,240,0.97)', backdropFilter: 'blur(10px)',
          border: '2px solid #1a1a1a', borderRadius: 12,
          padding: '12px 14px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.22)',
          maxHeight: 'calc(100vh - 180px)', overflowY: 'auto',
          minWidth: 160,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#999', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, fontFamily: 'Inter, sans-serif' }}>
            Your trip
          </div>
          {plan.map((day, i) => (
            <button
              key={i}
              onClick={() => setActiveDay(activeDay === i + 1 ? null : i + 1)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: activeDay === i + 1 ? `${day.color}22` : 'transparent',
                border: 'none', cursor: 'pointer',
                padding: '5px 6px', borderRadius: 6,
                width: '100%', textAlign: 'left',
                opacity: activeDay && activeDay !== i + 1 ? 0.3 : 1,
                transition: 'opacity 0.2s, background 0.2s',
              }}
            >
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: day.color, flexShrink: 0,
                border: '1.5px solid rgba(0,0,0,0.12)',
              }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>
                Day {day.day}
              </span>
              <span style={{ fontSize: 11, color: '#888', fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                {day.title}
              </span>
            </button>
          ))}
          {activeDay && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e0d9cc' }}>
              <button
                onClick={() => setActiveDay(null)}
                style={{ fontSize: 11, color: '#E63946', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', padding: 0, width: '100%', textAlign: 'center' }}
              >
                Show all days
              </button>
            </div>
          )}
        </div>
      )}

      {/* No itinerary CTA */}
      {!canSeeItinerary && (
        <div style={{
          position: 'absolute', top: '38%', left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(255,251,240,0.97)', backdropFilter: 'blur(12px)',
          border: '2px solid #1a1a1a', borderRadius: 16,
          padding: '28px 32px', textAlign: 'center', zIndex: 10, maxWidth: 300,
          boxShadow: '0 4px 24px rgba(0,0,0,0.22)',
        }}>
          <h3 className="font-display" style={{ fontSize: 24, margin: '0 0 10px' }}>Map your trip</h3>
          <p style={{ fontSize: 14, color: '#666', margin: '0 0 18px', lineHeight: 1.5 }}>
            Answer 8 quick questions to see your day-by-day route mapped across Aruba.
          </p>
          <button onClick={() => setPage('questionnaire')} className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
            Start planning →
          </button>
        </div>
      )}
    </div>
  );
}
