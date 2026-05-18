# 10 days on Aruba — Claude Code build

React + TypeScript + Vite rebuild of the playful Aruba trip planner. Mirrors the
look and feel of `landingpage-v3.html` / `landingpage-v4.html` (kept here for
reference) but as a proper deployable app.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build for production

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

## Deploy

Any static host works (Vercel, Netlify, Cloudflare Pages, GitHub Pages). The
build output is just static files in `dist/`. No backend required for the
current feature set.

Example — **Vercel**:
1. Push this folder to GitHub.
2. Import the repo on vercel.com; it auto-detects Vite.
3. Build command: `npm run build` · Output dir: `dist`.

Example — **Netlify**:
1. Drag-and-drop `dist/` onto netlify.com after running `npm run build`, or
2. Connect the repo and set build command / output dir as above.

## Project layout

```
.
├── index.html              Vite entry HTML
├── package.json
├── vite.config.ts
├── tsconfig*.json
├── public/
│   └── parrot.png          Hero mascot
├── src/
│   ├── main.tsx            React entry
│   ├── App.tsx             Page router (landing | explore | itinerary)
│   ├── index.css           Design tokens + reusable classes (chunky cards, buttons, slider)
│   ├── components/
│   │   ├── Nav.tsx
│   │   ├── Footer.tsx
│   │   └── Icons.tsx       Inline Lucide-style SVG icons (replaces lucide-react dep)
│   ├── pages/
│   │   ├── Landing.tsx
│   │   ├── Explore.tsx
│   │   └── Itinerary.tsx
│   └── data/
│       └── activities.ts   Activity dataset, sample itinerary, FAQ, GTK cards
├── landingpage-v3.html     Frozen v3 design snapshot (reference)
└── landingpage-v4.html     Single-file React+Babel preview (reference)
```

## Design tokens

CSS variables in `src/index.css`:

- `--yellow: #FFD23F`, `--yellow-bg: #EAB308`
- `--red: #E63946`, `--coral: #FF6B47`, `--green: #22C55E`, `--blue: #3B82F6`
- `--ink: #1A1A1A`, `--cream: #FFFBF0`, `--sand-50/100/200/500/700/900`

Fonts loaded in `index.html`: **Caprasimo** (display) + **Inter** (sans).

## Page state

Page switching is a simple `useState` in `App.tsx`. To add routing later
(deep-linking, browser back/forward), wire in `react-router-dom` and replace
the conditional render.
