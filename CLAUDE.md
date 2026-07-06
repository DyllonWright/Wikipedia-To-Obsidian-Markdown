# Wikipedia → Obsidian Importer — agent notes

Converts Wikipedia articles to clean Obsidian markdown: scraper/parser
backend, glassmorphic web GUI, and a companion Obsidian plugin
(`obsidian-plugin/`). **Read `README.md` first** for features + setup.

- Run GUI/server: `npm start` (or `npm run dev` for watch mode) —
  Express via `server.js`.
- Standalone Python path: `wikipedia_to_markdown.py`.
- Gemini integration (film detection, image naming) needs an API key
  in `.env` (gitignored).
- Image naming: `YYYY MM DD Brief Description.ext`; movie posters:
  `YYYY MM DD Title (YYYY) Theatrical Release Poster.ext`.
