// src/markdown.js
// Pure markdown assembly, shared by the server (server.js) and the
// Obsidian plugin bundle (plugin/). No I/O, no dependencies.

/**
 * A footnote label Obsidian accepts, from a Wikipedia cite_note id. Used on
 * BOTH ends — the in-body `[^id]` and the `[^id]:` definition — so they
 * always match. Raw ids can carry brackets, spaces, commas and URLs
 * (`FOOTNOTESogyal_Rinpoche2002[https://archive.org/…]-38`), which break
 * footnote syntax.
 * @param {string} id
 * @returns {string}
 */
function footnoteId(id) {
  const cleaned = String(id || '')
    .replace(/^cite_note-/, '')
    .replace(/https?:\/\/[^\]\s]*/g, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || 'note';
}

// [Text](https://xx.wikipedia.org/wiki/Slug#Fragment) — link text may hold
// backslash-escaped brackets; the slug never holds a raw ")" (the parser
// percent-encodes parentheses).
const WIKI_LINK_REGEX = /\[((?:\\.|[^\]\\])+)\]\(https:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/([^)#\s]+)(?:#([^)\s]*))?\)/g;

const FOOTNOTE_MARKER = /\[\^[^\]\s]+\]/g;

function decodeSlug(slug) {
  try {
    return decodeURIComponent(slug).replace(/_/g, ' ');
  } catch (e) {
    return slug.replace(/_/g, ' ');
  }
}

/**
 * Helper to apply desired linkMode to standard Wikipedia links in compiled Markdown.
 * If isInsideTable is true, the vertical bar (|) in Wikilinks is escaped as (\|)
 * to prevent Markdown table parser from treating it as a column divider.
 */
function applyLinkMode(markdown, linkMode, isInsideTable = false) {
  if (!linkMode || linkMode === 'standard') return markdown;

  return markdown.replace(WIKI_LINK_REGEX, (match, rawText, lang, slug, fragment) => {
    const text = rawText.replace(/\\([[\]])/g, '$1');
    if (linkMode === 'plain') return text;
    if (linkMode === 'comment') {
      return `${text}%%[Link](https://${lang}.wikipedia.org/wiki/${slug}${fragment ? '#' + fragment : ''})%%`;
    }
    if (linkMode !== 'wikilink') return match;

    // Wikilink targets cannot hold | [ ] # ^; aliases cannot hold ]].
    const target = decodeSlug(slug).replace(/[|[\]#^]/g, ' ').replace(/\s+/g, ' ').trim();
    const heading = fragment ? '#' + decodeSlug(fragment).replace(/[|[\]#^]/g, ' ').trim() : '';
    const alias = text.replace(/\[/g, '(').replace(/\]/g, ')');
    const pipe = isInsideTable ? '\\|' : '|';
    // Obsidian resolves link targets case-insensitively, so text that only
    // differs in case links directly and keeps the article's own wording.
    if (!heading && target.toLowerCase() === alias.toLowerCase()) return `[[${alias}]]`;
    return `[[${target}${heading}${pipe}${alias}]]`;
  });
}

/** Percent-encode parentheses and spaces so a URL never ends a markdown link early. */
function safeUrl(url) {
  return String(url || '').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
}

/** Renders one section element to markdown (no surrounding blank lines). */
function renderElement(el, linkMode, omitReferences) {
  const strip = (text) => (omitReferences ? text.replace(FOOTNOTE_MARKER, '') : text);
  if (el.type === 'p' || el.type === 'list' || el.type === 'image') {
    return applyLinkMode(strip(el.content), linkMode, false).trim();
  }
  if (el.type === 'table') {
    // Tables are processed with isInsideTable = true so Wikilink pipes (|) are escaped safely
    return applyLinkMode(strip(el.content), linkMode, true).trim();
  }
  if (el.type === 'references') {
    if (omitReferences) return '';
    return el.content
      .map((ref) => `[^${footnoteId(ref.id)}]: ${applyLinkMode(ref.text, linkMode, false)}`)
      .join('\n');
  }
  return '';
}

/**
 * Helper to generate markdown from sections and selected options.
 * Spacing rules are strictly optimized for compact headers:
 * - No empty blank lines are written between adjacent heading tags.
 * - Single blank lines are cleanly added before body elements and between body paragraphs.
 * - A heading with nothing under it (and no populated subsection) drops out,
 *   so "Omit references" leaves no empty "Notes"/"Citations" headings behind.
 */
function assembleMarkdown(title, url, rawSections, selectedSectionIds, linkMode, omitReferences) {
  const chosen = rawSections
    .filter((section) => section.id === 'section-intro' || selectedSectionIds.includes(section.id))
    .map((section) => ({
      section,
      body: section.elements
        .map((el) => renderElement(el, linkMode, omitReferences))
        .filter(Boolean)
        .join('\n\n')
    }));

  const keep = chosen.filter((entry, i) => {
    if (entry.body) return true;
    for (let j = i + 1; j < chosen.length && chosen[j].section.level > entry.section.level; j++) {
      if (chosen[j].body) return true;
    }
    return false;
  });

  let md = `# [${title.replace(/([[\]])/g, '\\$1')}](${safeUrl(url)})\n\n`;
  for (const { section, body } of keep) {
    if (section.id !== 'section-intro') {
      md += `\n${'#'.repeat(section.level)} ${section.title}\n`;
    }
    if (body) md += `\n${body}\n\n`;
  }

  // Compress spacing to ensure compact headers and clean paragraphs (no stray blank lines)
  return compressMarkdownSpacing(renumberFootnotes(md));
}

/**
 * Relabel footnotes 1, 2, 3… in order of first citation. Obsidian's live
 * preview prints a footnote's label as-is, so Wikipedia's ids
 * (`FOOTNOTEFremantle200120-1`) would otherwise clutter every sentence.
 * Definitions never cited in the chosen sections get the numbers after.
 */
function renumberFootnotes(md) {
  const numbers = new Map();
  const label = (id) => {
    if (!numbers.has(id)) numbers.set(id, String(numbers.size + 1));
    return numbers.get(id);
  };
  const DEFINITION = /^\[\^([^\]\s]+)\]:/gm;
  const MARKER = /\[\^([^\]\s]+)\](?!:)/g;
  // First pass assigns numbers by citation order; definitions come after.
  md.replace(MARKER, (m, id) => label(id));
  md.replace(DEFINITION, (m, id) => label(id));
  return md
    .replace(DEFINITION, (m, id) => `[^${numbers.get(id)}]:`)
    .replace(MARKER, (m, id) => `[^${numbers.get(id)}]`);
}

/**
 * Compresses multiple consecutive newlines and heading spacing to provide a clean, compact Markdown document.
 */
function compressMarkdownSpacing(md) {
  // 1. Compress 3 or more consecutive newlines down to exactly 2 newlines (a single empty blank line)
  let cleaned = md.replace(/\n{3,}/g, '\n\n');

  // 2. Remove any blank lines between adjacent headings (H1-H6) to support compact header layout
  // Match heading lines followed by one or more blank lines, followed by another heading line
  const adjacentHeadingsRegex = /(^(?:#{1,6})\s+.*)\n\n+(?=(?:#{1,6})\s+)/gm;
  cleaned = cleaned.replace(adjacentHeadingsRegex, '$1\n');

  // 3. Remove leading and trailing newlines
  return cleaned.trim() + '\n';
}

module.exports = {
  footnoteId,
  applyLinkMode,
  assembleMarkdown,
  compressMarkdownSpacing
};
