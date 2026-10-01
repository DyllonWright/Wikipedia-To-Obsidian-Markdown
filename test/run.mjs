// Test suite for the shared modules bundled into both the server and the
// Obsidian plugin: parser structure extraction, table flattening, markdown
// assembly, link modes, and the film-detection fallback.
import { createRequire } from "module";
import assert from "assert";

const require = createRequire(import.meta.url);
const { parseWikipediaArticle } = require("../src/parser.js");
const { applyLinkMode, assembleMarkdown, compressMarkdownSpacing } = require("../src/markdown.js");
const { generateFallbackAnalysis, sanitizeFileName } = require("../src/fallback.js");

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
	// cite_note-lang-1 becomes footnote 1 on both ends.
	assert.match(md2, /Fritz Lang\]\([^)]+\)\.\[\^1\]/);
	assert.match(md2, /^\[\^1\]: Lang, Fritz/m);
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

await ok("sanitizeFileName blocks path escapes and link-breaking characters", () => {
	assert.equal(sanitizeFileName("../../etc/passwd"), "etc-passwd");
	assert.equal(sanitizeFileName("2026 10 01 A [b] #c ^d: e?"), "2026 10 01 A -b- -c -d- e");
	assert.equal(sanitizeFileName("   ...   "), "");
});

await ok("fallback names keep non-ASCII letters and cut at a word", () => {
	const analysis = generateFallbackAnalysis(
		"Bardo Thodol",
		"A text.",
		[{ originalUrl: "https://x/a.jpg", caption: "Bardo. Vision des divinités sereines" },
		 { originalUrl: "https://x/b.jpg", caption: "Centuries old Zhi-Khro mandala, a part of the Bardo Thodol's collection, a text known in the West" }],
		"2026 10 01"
	);
	assert.equal(analysis.imageSuggestions[0].suggestedName, "2026 10 01 Bardo");
	assert.ok(analysis.imageSuggestions[1].suggestedName.length <= 72);
	assert.doesNotMatch(analysis.imageSuggestions[1].suggestedName, /\s\S{1,2}$/);
});

// --- current Wikipedia HTML (2026): the Bardo Thodol / Jacob's Ladder regressions ---
const CURRENT_URL = "https://en.wikipedia.org/wiki/Bardo_Thodol";
const CURRENT_HTML = `
<html><body>
<h1 id="firstHeading">Bardo Thodol</h1>
<div id="mw-content-text"><div class="mw-parser-output">
<section data-mw-section-id="0">
  <div class="hatnote">For the film, see elsewhere.</div>
  <table class="infobox"><tbody>
    <tr><td colspan="2" class="infobox-subheader">Bardo Thodol</td></tr>
    <tr><td colspan="2" class="infobox-image"><span typeof="mw:File"><a href="./File:BardoThodolChenmo.jpg" class="mw-file-description"><img src="//thumb.wikimedia.org/wikipedia/commons/thumb/e/e3/BardoThodolChenmo.jpg/330px-BardoThodolChenmo.jpg?utm_source=en.wikipedia.org&amp;utm_content=thumbnail" width="262" height="225" data-file-width="497"/></a></span><div class="infobox-caption">Manuscript of the Bardo Thodol.</div></td></tr>
    <tr><td colspan="2" class="infobox-full-data"><table class="infobox-subbox"><tbody>
      <tr><th colspan="2">Transcriptions</th></tr>
      <tr><th><a href="./Wylie_transliteration">Wylie</a></th><td>bar do thos grol</td></tr>
    </tbody></table></td></tr>
    <tr><th>Produced by</th><td><div class="plainlist"><ul><li><a href="./Alan_Marshall_(producer)">Alan Marshall</a></li><li><a href="./Mario_Kassar">Mario Kassar</a></li></ul></div></td></tr>
  </tbody></table>
  <table class="sidebar"><tr><td>Part of a series on <a href="./Category:Tibetan_Buddhism">a series</a></td></tr></table>
  <p>The <b><i>Bardo Thodol</i></b> is a <a href="./Terma_(religion)">terma text</a> about the <a href="./Bardo">bardo</a>,<sup class="reference"><a href="./Bardo_Thodol#cite_note-FOOTNOTESogyal2002%5Bhttps://archive.org/x%5D-38">[38]</a></sup> pronounced <a href="./Help:IPA/Tibetan">[pʰaː.tʰo]</a>.</p>
</section>
<section data-mw-section-id="1">
  <div class="mw-heading mw-heading2"><h2 id="Images">Images</h2></div>
  <figure typeof="mw:File/Thumb"><a href="./File:Tibetian_Wheel.svg" class="mw-file-description"><img src="//thumb.wikimedia.org/wikipedia/commons/thumb/f/fc/Tibetian_Wheel.svg/250px-Tibetian_Wheel.svg.png?utm_source=x" width="250" height="250" data-file-width="300"/></a><figcaption>Dharma wheel</figcaption></figure>
  <blockquote><p>Quoted line.</p></blockquote>
  <div class="refbegin"><ul><li>Coleman, Graham (2005).</li></ul></div>
</section>
<section data-mw-section-id="2">
  <div class="mw-heading mw-heading2"><h2 id="References">References</h2></div>
  <section data-mw-section-id="3">
    <div class="mw-heading mw-heading3"><h3 id="Works_cited">Works cited</h3></div>
    <table class="box-ISBN metadata ambox"><tr><td>Lacks ISBNs</td></tr></table>
  </section>
  <section data-mw-section-id="4">
    <div class="mw-heading mw-heading3"><h3 id="Citations">Citations</h3></div>
    <div class="mw-references-wrap"><ol class="mw-references references">
      <li id="cite_note-FOOTNOTESogyal2002[https://archive.org/x]-38"><span class="mw-cite-backlink">↑</span> <span class="reference-text">Sogyal 2002, p. 13.</span></li>
    </ol></div>
  </section>
</section>
</div></div>
</body></html>`;

const current = parseWikipediaArticle(CURRENT_HTML, CURRENT_URL, { linkMode: "standard" });
const currentMd = assembleMarkdown(
	current.title, CURRENT_URL, current.sections, current.sections.map((s) => s.id), "wikilink", false
);

await ok("image URLs lose the thumb host and utm query; one file, one entry", () => {
	assert.equal(current.images.length, 2);
	assert.equal(
		current.images[0].originalUrl,
		"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/BardoThodolChenmo.jpg/330px-BardoThodolChenmo.jpg"
	);
	assert.equal(current.images[0].caption, "Manuscript of the Bardo Thodol.");
	assert.equal(current.images[0].fileWidth, 497);
});

await ok("infobox image moves above the table; no File: link leaks", () => {
	assert.doesNotMatch(currentMd, /File:/);
	assert.match(currentMd, /\{\{IMAGE:[^}]+330px-BardoThodolChenmo\.jpg\}\}\n\*Manuscript of the Bardo Thodol\.\*\n\n\| Bardo Thodol/);
});

await ok("infobox sub-boxes unpack into rows; cell lists keep line breaks", () => {
	assert.match(currentMd, /\| \[\[Wylie transliteration\\\|Wylie\]\] \| bar do thos grol \|/);
	assert.match(currentMd, /\| Produced by \| \[\[Alan Marshall \(producer\)\\\|Alan Marshall\]\]<br>\[\[Mario Kassar\]\] \|/);
});

await ok("titles with parentheses survive as whole wikilinks", () => {
	assert.match(currentMd, /\[\[Terma \(religion\)\|terma text\]\]/);
	assert.match(currentMd, /about the \[\[bardo\]\]/);
});

await ok("sidebars, hatnotes, cleanup banners and namespace links drop out", () => {
	assert.doesNotMatch(currentMd, /Part of a series|For the film|Lacks ISBNs|Category:|Help:IPA/);
	assert.match(currentMd, /pronounced \[pʰaː\.tʰo\]/);
});

await ok("footnote ids with brackets and URLs match on both ends", () => {
	// Raw id: FOOTNOTESogyal2002[https://archive.org/x]-38 — renumbered to 1,
	// the first citation in the article, on both ends.
	assert.match(currentMd, /about the \[\[bardo\]\],\[\^1\] pronounced/);
	assert.match(currentMd, /^\[\^1\]: Sogyal 2002, p\. 13\.$/m);
	assert.doesNotMatch(currentMd, /FOOTNOTE/);
});

await ok("Parsoid reference wrappers land under their own heading, once", () => {
	assert.equal((currentMd.match(/^## References$/gm) || []).length, 1);
	assert.match(currentMd, /### Citations\n\n\[\^/);
	assert.doesNotMatch(currentMd, /### Works cited/, "empty heading pruned");
});

await ok("figures, blockquotes and wrapped lists all come through", () => {
	assert.match(currentMd, /\{\{IMAGE:[^}]+Tibetian_Wheel\.svg\.png\}\}\n\*Dharma wheel\*/);
	assert.match(currentMd, /^> Quoted line\.$/m);
	assert.match(currentMd, /^- Coleman, Graham \(2005\)\.$/m);
});

await ok("omitting references strips markers and empty reference headings", () => {
	const md = assembleMarkdown(current.title, CURRENT_URL, current.sections, current.sections.map((s) => s.id), "wikilink", true);
	assert.doesNotMatch(md, /\[\^/);
	assert.doesNotMatch(md, /## References|### Citations/);
});

// --- which images count as the article's own (the Dharmachakra flood) ----------------
const GALLERY_HTML = `
<html><body><h1 id="firstHeading">Dharmachakra</h1>
<div id="mw-content-text"><div class="mw-parser-output"><section>
  <figure typeof="mw:File/Thumb"><a href="./File:Ashoka_Chakra.svg"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/1/17/Ashoka_Chakra.svg/250px-Ashoka_Chakra.svg.png" width="250" height="250"/></a><figcaption>The ancient Dharmachakra</figcaption></figure>
  <p>Seen on the <img src="//upload.wikimedia.org/wikipedia/commons/thumb/4/41/Flag_of_India.svg/120px-Flag_of_India.svg.png" width="60" height="40"/> flag.</p>
  <table class="wikitable"><tr><td><img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Emblem.svg/120px-Emblem.svg.png" width="80" height="80"/> Emblem</td></tr></table>
  <ul class="gallery mw-gallery-traditional">
    <li class="gallerybox"><div class="thumb"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Flag_of_Romani.svg/120px-Flag_of_Romani.svg.png" width="120" height="80"/></div><div class="gallerytext">Flag of the Romani people</div></li>
    <li class="gallerybox"><div class="thumb"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/e/ef/USVA_headstone_emb-02.svg/120px-USVA_headstone_emb-02.svg.png" width="120" height="120"/></div><div class="gallerytext">USVA headstone emblem</div></li>
  </ul>
</section></div></div></body></html>`;

await ok("only captioned figures and infobox pictures come in by default", () => {
	const p = parseWikipediaArticle(GALLERY_HTML, "https://en.wikipedia.org/wiki/Dharmachakra", {});
	assert.deepEqual(p.images.map((i) => i.caption), ["The ancient Dharmachakra"]);
	assert.equal(p.images[0].source, "figure");
	const md = assembleMarkdown(p.title, p.url, p.sections, [], "wikilink", false);
	assert.equal((md.match(/\{\{IMAGE:/g) || []).length, 1, "no inline or table-cell icons");
	assert.doesNotMatch(md, /Romani|USVA/);
});

await ok("galleries arrive only on request, tagged so the modal leaves them unticked", () => {
	const p = parseWikipediaArticle(GALLERY_HTML, "https://en.wikipedia.org/wiki/Dharmachakra", { includeGalleries: true });
	assert.deepEqual(p.images.map((i) => i.source), ["figure", "gallery", "gallery"]);
	assert.equal(p.images[2].caption, "USVA headstone emblem");
});

// --- image downloads ------------------------------------------------------------------
const images = require("../src/images.js");

await ok("candidate chain: bitmap original first, then a standard-width thumb", () => {
	const c = images.downloadCandidates(
		"https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e3/Name.jpg/330px-Name.jpg?utm_source=x",
		{ fileWidth: 1100 }
	);
	assert.deepEqual(c, [
		"https://upload.wikimedia.org/wikipedia/commons/e/e3/Name.jpg",
		"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Name.jpg/960px-Name.jpg",
		"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Name.jpg/330px-Name.jpg"
	]);
	for (const url of c.slice(1)) {
		const w = Number(url.match(/\/(\d+)px-/)[1]);
		assert.ok(images.STANDARD_WIDTHS.includes(w), `${w} is a standard width`);
	}
});

await ok("SVG: rasterized PNG by default, vector original only when kept", () => {
	const svg = "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/W.svg/120px-W.svg.png";
	const png = images.downloadCandidates(svg, { svgMode: "png" });
	assert.equal(png[0], "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/W.svg/1280px-W.svg.png");
	assert.equal(png[png.length - 1], "https://upload.wikimedia.org/wikipedia/commons/f/fc/W.svg");
	const keep = images.downloadCandidates(svg, { svgMode: "svg" });
	assert.equal(keep[0], "https://upload.wikimedia.org/wikipedia/commons/f/fc/W.svg");
});

await ok("TIFF/PDF originals never get downloaded raw", () => {
	const c = images.downloadCandidates(
		"https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Scan.tif/lossy-page1-330px-Scan.tif.jpg",
		{ fileWidth: 4000 }
	);
	assert.ok(c.every((u) => u.includes("/thumb/")));
	assert.equal(c[0], "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Scan.tif/lossy-page1-1920px-Scan.tif.jpg");
});

await ok("sniffImageType reads bytes, and rejects HTML served as a .jpg", () => {
	const bytes = (arr, pad = 16) => Uint8Array.from([...arr, ...new Array(pad).fill(0)]);
	assert.equal(images.sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0])).ext, "jpg");
	assert.equal(images.sniffImageType(bytes([0x89, 0x50, 0x4e, 0x47])).ext, "png");
	assert.equal(images.sniffImageType(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="x"></svg>')).ext, "svg");
	assert.equal(images.sniffImageType(new TextEncoder().encode("<!DOCTYPE html><html><body>Wikimedia Commons</body></html>")), null);
});

// --- key ring ---------------------------------------------------------------------------
const { KeyRing, parseKeyList, classifyFailure, pacificDate } = require("../src/keyring.js");
const K1 = "AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
const K2 = "AIzaSyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2";
const K3 = "AIzaSyCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3";

await ok("parseKeyList reads bare keys, labels, and pasted .env rings", () => {
	const keys = parseKeyList(`# me@gmail.com\nGEMINI_API_KEY=${K1}\n# me@gmail.com #2\n#GEMINI_API_KEY=${K2}\nWork: ${K3}\n${K1}`);
	assert.deepEqual(keys.map((k) => k.label), ["me@gmail.com", "me@gmail.com #2", "Work"]);
	assert.equal(keys.length, 3, "duplicate dropped");
	assert.match(keys[0].fp, /^[0-9a-f]{8}$/);
	assert.ok(!JSON.stringify(new KeyRing(keys).describe()).includes("AIza"), "describe() never shows values");
});

await ok("classifyFailure separates quota, refusal, model trouble", () => {
	assert.equal(classifyFailure(429, ""), "quota");
	assert.equal(classifyFailure(403, "PERMISSION_DENIED"), "dead");
	assert.equal(classifyFailure(400, "API key not valid. Please pass a valid API key."), "dead");
	assert.equal(classifyFailure(503, "high demand"), "model");
	assert.equal(classifyFailure(0, "timeout"), "model");
	assert.equal(classifyFailure(400, "bad request"), "other");
});

await ok("a dry key benches its whole account until the Pacific date rolls", () => {
	let now = new Date("2026-10-01T18:00:00Z"); // 11:00 Pacific
	const ring = new KeyRing(parseKeyList(`me@gmail.com: ${K1}\nme@gmail.com #2: ${K2}\nWork: ${K3}`), {}, () => now);
	ring.markDry(ring.keys[0].fp);
	assert.deepEqual(ring.candidates().map((k) => k.label), ["Work"]);
	now = new Date("2026-10-02T06:59:00Z"); // 23:59 Pacific, same day
	assert.equal(ring.candidates().length, 1);
	now = new Date("2026-10-02T07:01:00Z"); // 00:01 Pacific, next day
	assert.equal(ring.candidates().length, 3);
	assert.equal(pacificDate(now), "2026-10-02");
	assert.deepEqual(ring.toState().dry, {}, "stale marks pruned");
});

// --- Gemini caller (mock transport, no network) --------------------------------------
const gemini = require("../src/gemini.js");
const IMGS = [{ originalUrl: "https://upload.wikimedia.org/a.jpg", caption: "Poster" }];
const reply = (obj) => ({
	status: 200,
	text: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] })
});

await ok("rotates past a dry key and a refused key, key sent only as a header", async () => {
	const ring = new KeyRing(parseKeyList(`A: ${K1}\nB: ${K2}\nC: ${K3}`));
	const calls = [];
	const transport = async (req) => {
		calls.push(req);
		assert.ok(!req.url.includes("AIza"), "no key in the URL");
		const key = req.headers["x-goog-api-key"];
		if (key === K1) return { status: 429, text: "RESOURCE_EXHAUSTED" };
		if (key === K2) return { status: 403, text: "PERMISSION_DENIED" };
		return reply({
			isMovie: true, movieTitle: "Metropolis", releaseYear: "1927",
			imageSuggestions: [{ originalUrl: IMGS[0].originalUrl, suggestedName: "../2026 10 01 Metropolis (1927) Theatrical Release Poster", isPoster: true }]
		});
	};
	const out = await gemini.analyzeMetadataAndImages({
		title: "Metropolis", leadText: "", infoboxText: "", images: IMGS, vaultDate: "2026 10 01", ring, transport
	});
	assert.equal(out.source, "gemini");
	assert.equal(calls.length, 3);
	assert.ok(calls.every((c) => c.url.includes("/models/gemini-flash-latest:generateContent")));
	assert.equal(out.analysis.imageSuggestions[0].suggestedName, "2026 10 01 Metropolis (1927) Theatrical Release Poster");
	const state = ring.toState();
	assert.equal(Object.keys(state.dry).length, 1);
	assert.equal(Object.keys(state.dead).length, 1);
	assert.equal(state.active, ring.keys[2].fp);
});

await ok("a failing -latest alias steps to the newest listed stable flash model", async () => {
	const ring = new KeyRing(parseKeyList(K1));
	const seen = [];
	const transport = async (req) => {
		seen.push(req.url.replace("https://generativelanguage.googleapis.com/v1beta/", ""));
		if (req.url.endsWith("/models?pageSize=200")) {
			return { status: 200, text: JSON.stringify({ models: [
				{ name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
				{ name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
				{ name: "models/gemini-3.7-flash-preview", supportedGenerationMethods: ["generateContent"] },
				{ name: "models/gemini-3.6-flash-lite", supportedGenerationMethods: ["generateContent"] },
				{ name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] }
			] }) };
		}
		if (req.url.includes("gemini-flash-latest")) return { status: 503, text: "high demand" };
		return reply({ isMovie: false, imageSuggestions: [] });
	};
	const out = await gemini.analyzeMetadataAndImages({
		title: "X", leadText: "", infoboxText: "", images: IMGS, vaultDate: "", ring, transport
	});
	assert.equal(out.source, "gemini");
	assert.equal(out.note, "gemini-3.6-flash");
	assert.deepEqual(seen, ["models/gemini-flash-latest:generateContent", "models?pageSize=200", "models/gemini-3.6-flash:generateContent"]);
});

await ok("no keys, or every call failing, lands on heuristics without throwing", async () => {
	const none = await gemini.analyzeMetadataAndImages({
		title: "X (film)", leadText: "a 1999 film", infoboxText: "", images: IMGS, vaultDate: "", ring: new KeyRing([]), transport: async () => { throw new Error("unreachable"); }
	});
	assert.equal(none.source, "heuristics");
	let calls = 0;
	const allDry = await gemini.analyzeMetadataAndImages({
		title: "X", leadText: "", infoboxText: "", images: IMGS, vaultDate: "",
		ring: new KeyRing(parseKeyList(`${K1}\n${K2}`)),
		transport: async () => { calls++; return { status: 429, text: "quota" }; }
	});
	assert.equal(allDry.source, "heuristics");
	assert.equal(calls, 2, "one try per key, no retries against a dry key");
});

// --- server module wiring -----------------------------------------------------------
await ok("server-side gemini adapter still exposes analyzeMetadataAndImages", () => {
	const nodeGemini = require("../src/node-gemini.js");
	assert.equal(typeof nodeGemini.analyzeMetadataAndImages, "function");
});

if (process.exitCode) {
	console.error("\nFAILED");
} else {
	console.log(`\n${passed} assertions passed`);
}
