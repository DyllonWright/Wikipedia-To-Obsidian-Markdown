// Test suite for the shared modules bundled into both the server and the
// Obsidian plugin: parser structure extraction, table flattening, markdown
// assembly, link modes, and the film-detection fallback.
import { createRequire } from "module";
import assert from "assert";

const require = createRequire(import.meta.url);
const { parseWikipediaArticle } = require("../src/parser.js");
const { applyLinkMode, assembleMarkdown, compressMarkdownSpacing } = require("../src/markdown.js");
const { generateFallbackAnalysis } = require("../src/fallback.js");

let passed = 0;
async function ok(name, fn) {
	try {
		await fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (err) {
		console.error(`  ✗ ${name}`);
		console.error(err);
		process.exitCode = 1;
	}
}

// --- fixture: a miniature Wikipedia article --------------------------------
const FIXTURE_URL = "https://en.wikipedia.org/wiki/Metropolis_(1927_film)";
const FIXTURE_HTML = `
<html><body>
<h1 id="firstHeading">Metropolis (1927 film)</h1>
<div id="mw-content-text"><div class="mw-parser-output">
  <table class="infobox">
    <tr><td><img src="//upload.wikimedia.org/poster.jpg" width="220" height="326" alt="Poster"/></td></tr>
    <tr class="infobox-caption"><td>Theatrical release poster</td></tr>
    <tr><th>Directed by</th><td><a href="/wiki/Fritz_Lang">Fritz Lang</a></td></tr>
  </table>
  <p><b>Metropolis</b> is a 1927 German expressionist film directed by
    <a href="/wiki/Fritz_Lang">Fritz Lang</a>.<sup class="reference"><a href="#cite_note-lang-1">[1]</a></sup></p>
  <div class="mw-heading mw-heading2"><h2 id="Plot">Plot</h2><span class="mw-editsection">[edit]</span></div>
  <p>In the year 2026, society splits in two.</p>
  <figure><img src="//upload.wikimedia.org/thumb/still.jpg/220px-still.jpg" width="220" height="120"/>
    <figcaption>A still from the film</figcaption></figure>
  <div class="mw-heading mw-heading2"><h2 id="Reception">Reception</h2></div>
  <table>
    <tr><th>Year</th><th colspan="2">Result</th></tr>
    <tr><td rowspan="2">1927</td><td>Premiere</td><td>Berlin</td></tr>
    <tr><td>Release</td><td>Germany</td></tr>
  </table>
  <div class="mw-heading mw-heading2"><h2 id="References">References</h2></div>
  <div class="reflist">
    <ol class="references">
      <li id="cite_note-lang-1">Lang, Fritz. <i>Metropolis</i>. UFA, 1927.</li>
    </ol>
  </div>
</div></div>
</body></html>`;

const parsed = parseWikipediaArticle(FIXTURE_HTML, FIXTURE_URL, {
	linkMode: "standard",
	omitReferences: false
});

// --- parser -----------------------------------------------------------------
await ok("extracts the article title", () => {
	assert.equal(parsed.title, "Metropolis (1927 film)");
});

await ok("splits sections at modern mw-heading wrappers", () => {
	const titles = parsed.sections.map((s) => s.title);
	assert.deepEqual(titles, ["Introduction", "Plot", "Reception", "References"]);
});

await ok("collects infobox and figure images with captions", () => {
	assert.equal(parsed.images.length, 2);
	assert.match(parsed.images[0].originalUrl, /^https:\/\/upload\.wikimedia\.org\/poster\.jpg$/);
	assert.equal(parsed.images[0].caption, "Theatrical release poster");
	assert.equal(parsed.images[1].caption, "A still from the film");
});

await ok("renders wiki links as standard markdown in parse phase", () => {
	const intro = parsed.sections[0];
	const p = intro.elements.find((el) => el.type === "p");
	assert.match(p.content, /\[Fritz Lang\]\(https:\/\/en\.wikipedia\.org\/wiki\/Fritz_Lang\)/);
});

await ok("footnote markers use the cite_note id", () => {
	const intro = parsed.sections[0];
	const p = intro.elements.find((el) => el.type === "p");
	assert.match(p.content, /\[\^lang-1\]/);
});

await ok("flattens colspan/rowspan tables into a stable grid", () => {
	const reception = parsed.sections.find((s) => s.title === "Reception");
	const table = reception.elements.find((el) => el.type === "table");
	const lines = table.content.trim().split("\n");
	// colspan continuations stay blank; rowspan values repeat so every row reads complete
	assert.equal(lines[0], "| Year | Result |   |");
	assert.equal(lines[1], "| --- | --- | --- |");
	assert.equal(lines[2], "| 1927 | Premiere | Berlin |");
	assert.equal(lines[3], "| 1927 | Release | Germany |");
});

await ok("captures the references block with ids", () => {
	const refs = parsed.sections.find((s) => s.title === "References");
	const block = refs.elements.find((el) => el.type === "references");
	assert.equal(block.content[0].id, "cite_note-lang-1");
	assert.match(block.content[0].text, /Lang, Fritz/);
});

// --- Parsoid read views (current Wikipedia HTML) ----------------------------
await ok("parses Parsoid HTML where nested <section> wrappers hold the content", () => {
	const parsoidHtml = `
<html><body>
<h1 id="firstHeading">Metropolis (1927 film)</h1>
<div id="mw-content-text"><div class="mw-parser-output">
  <section data-mw-section-id="0">
    <p><b>Metropolis</b> is a 1927 film by <a href="/wiki/Fritz_Lang">Fritz Lang</a>.</p>
  </section>
  <section data-mw-section-id="1">
    <div class="mw-heading mw-heading2"><h2 id="Plot">Plot</h2></div>
    <p>Society splits in two.</p>
    <section data-mw-section-id="2">
      <div class="mw-heading mw-heading3"><h3 id="Setting">Setting</h3></div>
      <p>The year 2026.</p>
    </section>
  </section>
</div></div>
</body></html>`;
	const p = parseWikipediaArticle(parsoidHtml, FIXTURE_URL, { linkMode: "standard" });
	assert.deepEqual(
		p.sections.map((s) => `${s.level}:${s.title}`),
		["1:Introduction", "2:Plot", "3:Setting"]
	);
	assert.equal(p.sections[2].elements[0].content, "The year 2026.");
});

// --- link modes ---------------------------------------------------------------
await ok("applyLinkMode converts to wikilinks, aliased when text differs", () => {
	assert.equal(
		applyLinkMode("[Fritz Lang](https://en.wikipedia.org/wiki/Fritz_Lang)", "wikilink"),
		"[[Fritz Lang]]"
	);
	assert.equal(
		applyLinkMode("[the director](https://en.wikipedia.org/wiki/Fritz_Lang)", "wikilink"),
		"[[Fritz Lang|the director]]"
	);
});

await ok("applyLinkMode escapes pipes inside tables", () => {
	assert.equal(
		applyLinkMode("[the director](https://en.wikipedia.org/wiki/Fritz_Lang)", "wikilink", true),
		"[[Fritz Lang\\|the director]]"
	);
});

await ok("applyLinkMode supports comment and plain modes", () => {
	assert.equal(
		applyLinkMode("[Fritz Lang](https://en.wikipedia.org/wiki/Fritz_Lang)", "comment"),
		"Fritz Lang%%[Link](https://en.wikipedia.org/wiki/Fritz_Lang)%%"
	);
	assert.equal(
		applyLinkMode("[Fritz Lang](https://en.wikipedia.org/wiki/Fritz_Lang)", "plain"),
		"Fritz Lang"
	);
});

// --- markdown assembly ----------------------------------------------------------
await ok("assembleMarkdown includes intro always, filters unselected sections", () => {
	const md = assembleMarkdown(
		parsed.title, FIXTURE_URL, parsed.sections,
		["Plot"], "wikilink", false
	);
	assert.match(md, /^# \[Metropolis \(1927 film\)\]/);
	assert.match(md, /## Plot/);
	assert.doesNotMatch(md, /## Reception/);
	assert.match(md, /\[\[Fritz Lang\]\]/);
});

await ok("assembleMarkdown omits references when asked", () => {
	const md = assembleMarkdown(
		parsed.title, FIXTURE_URL, parsed.sections,
		parsed.sections.map((s) => s.id), "standard", true
	);
	assert.doesNotMatch(md, /## References/);
	const md2 = assembleMarkdown(
		parsed.title, FIXTURE_URL, parsed.sections,
		parsed.sections.map((s) => s.id), "standard", false
	);
	assert.match(md2, /\[\^lang-1\]: Lang, Fritz/);
});

await ok("compressMarkdownSpacing collapses blank runs and heading gaps", () => {
	assert.equal(compressMarkdownSpacing("a\n\n\n\nb"), "a\n\nb\n");
	assert.equal(compressMarkdownSpacing("## A\n\n### B\n"), "## A\n### B\n");
});

// --- film-detection fallback ------------------------------------------------------
await ok("detects a film from the lead text and names the poster", () => {
	const analysis = generateFallbackAnalysis(
		"Metropolis (1927 film)",
		"Metropolis is a 1927 German expressionist film directed by Fritz Lang.",
		[{ originalUrl: "https://x/poster.jpg", caption: "" },
		 { originalUrl: "https://x/still.jpg", caption: "A still from the film" }],
		"2026 07 11"
	);
	assert.equal(analysis.isMovie, true);
	assert.equal(analysis.movieTitle, "Metropolis");
	assert.equal(analysis.releaseYear, "1927");
	assert.equal(analysis.imageSuggestions[0].isPoster, true);
	assert.equal(
		analysis.imageSuggestions[0].suggestedName,
		"2026 07 11 Metropolis (1927) Theatrical Release Poster"
	);
	assert.equal(analysis.imageSuggestions[1].isPoster, false);
	assert.match(analysis.imageSuggestions[1].suggestedName, /^2026 07 11 A still from the film$/);
});

await ok("treats a non-film article as ordinary", () => {
	const analysis = generateFallbackAnalysis(
		"General semantics",
		"General semantics is a school of thought founded by Alfred Korzybski.",
		[{ originalUrl: "https://x/portrait.jpg", caption: "Korzybski in 1946" }],
		"2026 07 11"
	);
	assert.equal(analysis.isMovie, false);
	assert.equal(analysis.imageSuggestions[0].isPoster, false);
});

await ok("empty vault date leaves no leading whitespace", () => {
	const analysis = generateFallbackAnalysis(
		"General semantics",
		"A school of thought.",
		[{ originalUrl: "https://x/a.jpg", caption: "Portrait" }],
		""
	);
	assert.equal(analysis.imageSuggestions[0].suggestedName, "Portrait");
});

// --- server module wiring -----------------------------------------------------------
await ok("server-side gemini module still exposes analyzeMetadataAndImages", () => {
	const gemini = require("../src/gemini.js");
	assert.equal(typeof gemini.analyzeMetadataAndImages, "function");
});

if (process.exitCode) {
	console.error("\nFAILED");
} else {
	console.log(`\n${passed} assertions passed`);
}
