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
  `gemini-flash-latest`, never a pinned version. Plugin calls REST via
  `requestUrl`; server uses the SDK with a key in `.env` (gitignored).
  Every Gemini feature has an offline fallback in `src/fallback.js`.
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
