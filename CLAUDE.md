# Wikipedia Importer — agent notes

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
