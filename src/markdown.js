// src/markdown.js
// Pure markdown assembly, shared by the server (server.js) and the
// Obsidian plugin bundle (plugin/). No I/O, no dependencies.

/**
 * Helper to apply desired linkMode to standard Wikipedia links in compiled Markdown.
 * If isInsideTable is true, the vertical bar (|) in Wikilinks is escaped as (\|)
 * to prevent Markdown table parser from treating it as a column divider.
 */
function applyLinkMode(markdown, linkMode, isInsideTable = false) {
  if (!linkMode || linkMode === 'standard') return markdown;

  // Regex to match Wikipedia internal links: [Text](https://en.wikipedia.org/wiki/Slug)
  const wikiLinkRegex = /\[([^\]]+)\]\(https:\/\/en\.wikipedia\.org\/wiki\/([^?#\)]+)(#[^\)]*)?\)/g;

  return markdown.replace(wikiLinkRegex, (match, text, slug, hash) => {
    try {
      const decodedSlug = decodeURIComponent(slug).replace(/_/g, ' ');

      if (linkMode === 'wikilink') {
        if (decodedSlug.toLowerCase() === text.toLowerCase()) {
          return `[[${decodedSlug}${hash || ''}]]`;
        } else {
          const pipeSymbol = isInsideTable ? '\\|' : '|';
          return `[[${decodedSlug}${hash || ''}${pipeSymbol}${text}]]`;
        }
      } else if (linkMode === 'comment') {
        return `${text}%%[Link](https://en.wikipedia.org/wiki/${slug}${hash || ''})%%`;
      } else if (linkMode === 'plain') {
        return text;
      }
    } catch (e) {
      console.error('Failed to post-process link:', match, e);
    }
    return match;
  });
}

/**
 * Helper to generate markdown from sections and selected options.
 * Spacing rules are strictly optimized for compact headers:
 * - No empty blank lines are written between adjacent heading tags.
 * - Single blank lines are cleanly added before body elements and between body paragraphs.
 */
function assembleMarkdown(title, url, rawSections, selectedSectionIds, linkMode, omitReferences) {
  let md = `# [${title}](${url})\n\n`;

  let lastWasHeading = false;

  for (const section of rawSections) {
    // If references section and references are omitted, skip
    if (section.title === 'References' && omitReferences) {
      continue;
    }

    // Check if user excluded this section
    if (section.id !== 'section-intro' && !selectedSectionIds.includes(section.id)) {
      continue;
    }

    if (section.title !== 'Introduction') {
      const headingPrefix = '#'.repeat(section.level);
      if (lastWasHeading) {
        // Compact mode: No blank line between adjacent headers!
        md += `${headingPrefix} ${section.title}\n`;
      } else {
        // Standard division: Add a single blank line before the heading if it follows body elements
        md += `\n${headingPrefix} ${section.title}\n`;
      }
      lastWasHeading = true;
    }

    for (const el of section.elements) {
      let elementContent = '';

      if (el.type === 'p') {
        elementContent = `${applyLinkMode(el.content, linkMode, false)}\n\n`;
      } else if (el.type === 'table') {
        // Tables are processed with isInsideTable = true so Wikilink pipes (|) are escaped safely
        elementContent = `${applyLinkMode(el.content, linkMode, true)}\n\n`;
      } else if (el.type === 'list') {
        elementContent = `${applyLinkMode(el.content, linkMode, false)}\n\n`;
      } else if (el.type === 'image') {
        elementContent = `${applyLinkMode(el.content, linkMode, false)}\n\n`;
      } else if (el.type === 'references') {
        let refContent = `\n`;
        for (const ref of el.content) {
          const cleanRefId = ref.id.replace('cite_note-', '');
          refContent += `[^${cleanRefId}]: ${applyLinkMode(ref.text, linkMode, false)}\n`;
        }
        refContent += `\n`;
        elementContent = refContent;
      }

      if (elementContent) {
        if (lastWasHeading) {
          // If we had a heading, ensure we have exactly one blank line before starting the body content
          md += '\n';
          lastWasHeading = false;
        }
        md += elementContent;
      }
    }
  }

  // Compress spacing to ensure compact headers and clean paragraphs (no stray blank lines)
  md = compressMarkdownSpacing(md);

  return md;
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
  applyLinkMode,
  assembleMarkdown,
  compressMarkdownSpacing
};
