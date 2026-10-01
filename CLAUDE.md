# Advanced Wikipedia Importer — agent notes

Imports Wikipedia articles into Obsidian as clean markdown. **Read
`README.md` first** for features + architecture.

- Self-contained Obsidian plugin: `plugin/` (TypeScript) bundles the
  shared CommonJS modules in `src/` via esbuild → `main.js` at repo root.
  Browser platform, no Node built-ins — the plugin runs on mobile too.
- Optional web GUI: `npm start` (Express via `server.js`, UI in
  `public/`), shares the same `src/` modules.
- Build: `npm run build` (tsc + esbuild). Test: `npm test` — parser,
  markdown assembly, and heuristics against fixtures for BOTH Wikipedia
  HTML shapes (Parsoid `<section>` wrappers + legacy flat markup).
- Gemini (optional, film detection + image naming): model name stays
  `gemini-flash-latest`, never a pinned version; on a model failure
  `src/gemini.js` discovers stable flash models via `models.list`. One
  REST caller for both sides, transport injected (plugin: `requestUrl`;
  server: `fetch` in `src/node-gemini.js`). Key goes in the
  `x-goog-api-key` header, never a URL. Every Gemini feature has an
  offline fallback in `src/fallback.js`.
- Key ring (`src/keyring.js`): plugin keys live in Obsidian's
  `app.secretStorage` (keychain), never `data.json`; settings hold only
  secret names + fingerprint state. Server reads `GEMINI_API_KEY`,
  `GEMINI_API_KEYS`, or `ENV_KEY_RING_PATH` (read only).
- Images (`src/images.js`): Wikimedia accepts only standard thumbnail
  widths and serves HTML redirects with status 200 — so every download
  gets sniffed by its bytes, and the extension comes from the bytes. SVG
  rasterizes via Wikimedia's PNG thumbs (setting `svgMode`, default png).
- Image naming: `YYYY MM DD Brief Description.ext`; movie posters:
  `YYYY MM DD Title (YYYY) Theatrical Release Poster.ext`.
- README/UI text keep E-Prime (no forms of "to be").
- Standalone Python path: `wikipedia_to_markdown.py` (legacy).

## Gemini API quirks (fleet-wide)

Before debugging a `429`, `503`, `404`, or "the model got slow", read
`mission-control/docs/API-QUIRKS.md`. It carries what has already gone wrong
with this surface, indexed by symptom: quota meters **per project, not per key**
(so a 13-key ring is not 13 budgets), the daily reset lands at **midnight
Pacific**, `-latest` aliases **degrade before they fail** (29s for a two-token
reply, which no error handler can see), and pinning a version rots
(`gemini-2.5-flash` now answers 404).

This repo keeps its own key handling and has **no model fallback or breaker** —
`E-Reader-Screenshot-Transcriber/gui/lib/` holds the reference implementation if
a run here ever needs one.
