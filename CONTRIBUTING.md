# Contributing to Wikipedia Importer

Thanks for the interest! Issues and pull requests welcome.

## Ground rules

- **One parser, two doors.** The shared modules in `src/` (`parser.js`,
  `markdown.js`, `fallback.js`) serve both the Obsidian plugin bundle and
  the optional web dashboard. Any change to them needs a matching
  assertion in `test/run.mjs`, and the suite must stay green (`npm test`).
  Wikipedia serves two HTML shapes (Parsoid `<section>` wrappers and
  legacy flat markup) — changes must keep both fixtures passing.
- **The plugin stays self-contained.** No Node built-ins, no child
  processes, no required external services. The esbuild config targets
  the browser platform on purpose; if the build starts demanding a Node
  module, the design took a wrong turn.
- **Gemini stays optional.** Every AI-assisted feature needs a working
  heuristic fallback in `src/fallback.js`. The model name stays
  `gemini-flash-latest` — never pin a dated model version.
- README and UI text keep **E-Prime** (no forms of "to be").
- No direct `.style.` writes and no `!important` — use CSS classes in
  `styles.css` with Obsidian's CSS variables (custom properties via
  `style.setProperty` are fine for dynamic values).

## Workflow

```bash
npm install
npm run dev     # esbuild watch mode
npm run build   # typecheck + production bundle
npm test        # parser / markdown / heuristics suite
npm start       # optional web GUI at localhost:3000
```

Test in a real vault: copy `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/wikipedia-importer/` and reload Obsidian.

## Reporting bugs

Include the exact Wikipedia URL, your Obsidian version and platform, the
link mode in use, and whether a Gemini key was set. For parsing bugs, note
which section or table came out wrong — article revisions change, so a
permalink (from the article's "View history") helps enormously.

## Releases (maintainer)

Bump `version` in `manifest.json` and `package.json`, add the entry to
`versions.json`, then push a matching tag (e.g. `2.1.0`). GitHub Actions
builds, tests, attests, and publishes the release with `main.js`,
`manifest.json`, and `styles.css`.
