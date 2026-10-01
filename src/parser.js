// src/parser.js
const cheerio = require('cheerio');
const { normalizeImageUrl, originalFileUrl } = require('./images');
const { footnoteId } = require('./markdown');

/**
 * Wiki namespaces whose links point at site machinery rather than at an
 * article. Their text survives; the link does not. (File:/Image: links wrap
 * an <img>, so their inner content passes through.)
 */
const NON_ARTICLE_NAMESPACES = /^(File|Image|Media|Category|Help|Template|Template talk|Special|Wikipedia|WP|Portal|Module|Talk|User|User talk|Draft|MediaWiki|H|Wikipedia talk|Help talk|Category talk|File talk):/i;

/**
 * Removes page chrome and navigation boilerplate that has no place in a note.
 * @param {object} $ Cheerio instance
 */
function cleanHtml($) {
  $('.mw-editsection, script, style, link, noscript, #toc, .toc, .mw-jump-link').remove();
  // Navigation and maintenance boxes: navboxes, the "Part of a series on…"
  // sidebar, v·t·e navbars, hatnotes, cleanup banners, sister-project boxes.
  $([
    '.navbox', '.navbox-styles', '.vertical-navbox', '.sidebar', '.navbar',
    '.catlinks', '.printfooter', '.metadata', '.ambox', '.stub', '.hatnote',
    '.shortdescription', '.noprint', '.sistersitebox', '.side-box',
    '.portalbox', '.mw-authority-control', '.mw-empty-elt', '.mw-cite-backlink'
  ].join(', ')).remove();

  // Prune raw wikitext fallback text nodes (like [[File:name.jpg|...]])
  // inside image wrappers, which otherwise leak as stray double brackets.
  $('[typeof^="mw:File"], .mw-file-description').contents().filter(function() {
    return this.type === 'text';
  }).remove();
}

/**
 * Resolves a relative link to a clean absolute URL.
 * @param {string} href The link href attribute
 * @param {string} baseUrl The original page URL
 * @returns {string} The resolved absolute URL
 */
function resolveUrl(href, baseUrl) {
  if (!href) return '';
  if (href.startsWith('//')) return 'https:' + href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  // WHATWG URL instead of the Node 'url' module, so this file also
  // bundles for the Obsidian plugin (browser/mobile targets).
  try {
    return new URL(href, baseUrl).toString();
  } catch (e) {
    return href;
  }
}

/**
 * Reads a wiki article target out of any href shape Wikipedia emits:
 * `/wiki/Title`, Parsoid's `./Title`, or `https://xx.wikipedia.org/wiki/Title`.
 * @param {string} href
 * @returns {null | {title: string, fragment: string}}
 */
function wikiTarget(href) {
  if (!href) return null;
  let path = null;
  let m = href.match(/^(?:https?:)?\/\/[a-z0-9-]+\.(?:m\.)?wikipedia\.org\/wiki\/([^?]+)/i);
  if (m) path = m[1];
  else if ((m = href.match(/^\/wiki\/([^?]+)/))) path = m[1];
  else if ((m = href.match(/^\.\/([^?]+)/))) path = m[1];
  if (!path) return null;
  const [slug, frag = ''] = path.split('#');
  const decode = (s) => {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  };
  return { title: decode(slug).replace(/_/g, ' '), fragment: decode(frag).replace(/_/g, ' ') };
}

/**
 * Canonical en.wikipedia URL for a title. Parentheses and apostrophes get
 * percent-encoded too (encodeURIComponent leaves them), because a raw ")"
 * ends a markdown link early — the source of `[[Alan Marshall (producer|…]])`.
 */
function wikiUrl(title, fragment, origin) {
  const enc = (s) => encodeURIComponent(s.replace(/ /g, '_')).replace(/[()'!*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${origin}/wiki/${enc(title)}${fragment ? '#' + enc(fragment) : ''}`;
}

/** Escape characters that would break out of markdown link text. */
function escapeLinkText(text) {
  return text.replace(/([[\]])/g, '\\$1');
}

/** Wrap inline text in a markdown marker, keeping outer whitespace outside it. */
function wrapInline(marker, raw) {
  const inner = raw.trim();
  if (!inner) return raw;
  const lead = /^\s/.test(raw) ? ' ' : '';
  const trail = /\s$/.test(raw) ? ' ' : '';
  return `${lead}${marker}${inner}${marker}${trail}`;
}

function isIconLike(src, width, height) {
  const s = src.toLowerCase();
  return (width > 0 && width < 50) || (height > 0 && height < 50) ||
    ['icon', 'edit-', 'padlock', 'question_book', 'commons-logo', 'wiktionary-logo', 'wikiquote-logo', 'symbol_support_vote', 'ambox'].some((k) => s.includes(k));
}

/**
 * Registers an <img> in the article's image list and returns the key its
 * placeholder uses, or null for icons. One file shown twice (say, at two
 * widths) shares one entry.
 * @param {object} $ Cheerio instance
 * @param {object} imgEl <img> element
 * @param {string} baseUrl
 * @param {Array} images Image registry (mutated)
 * @param {string} [caption]
 * @param {'infobox'|'figure'|'gallery'} [source] Where the image sat in the article
 * @returns {string|null}
 */
function registerImage($, imgEl, baseUrl, images, caption = '', source = 'figure') {
  const $img = $(imgEl);
  const src = $img.attr('src');
  if (!src || src.startsWith('data:')) return null;
  const width = parseInt($img.attr('width')) || 0;
  const height = parseInt($img.attr('height')) || 0;
  if (isIconLike(src, width, height)) return null;

  const url = normalizeImageUrl(resolveUrl(src, baseUrl));
  const fileKey = originalFileUrl(url);
  const existing = images.find((img) => img.fileKey === fileKey);
  if (existing) {
    // A real caption beats alt text picked up on an earlier sighting.
    if (caption && caption.trim() && (existing.altOnly || !existing.caption)) {
      existing.caption = caption.replace(/\s+/g, ' ').trim();
      existing.altOnly = false;
    }
    return existing.originalUrl;
  }
  images.push({
    originalUrl: url,
    caption: (caption || $img.attr('alt') || '').replace(/\s+/g, ' ').trim(),
    altOnly: !caption,
    source,
    fileKey,
    fileWidth: parseInt($img.attr('data-file-width')) || 0
  });
  return url;
}

/** Collects a table's own rows (never a nested table's). */
function ownRows($, tableEl) {
  return tableEl.find('tr').filter((_, tr) => $(tr).closest('table').is(tableEl)).toArray();
}

/** Collects a row's own cells. */
function ownCells($, tr) {
  return $(tr).children('th, td').toArray();
}

/**
 * Infobox rows, with sub-boxes (a full-width cell that only holds another
 * table, like the "Transcriptions" block) unpacked into rows of their own
 * instead of one cell of run-together text.
 */
function infoboxRows($, tableEl) {
  const out = [];
  for (const tr of ownRows($, tableEl)) {
    const cells = ownCells($, tr);
    if (cells.length === 1) {
      const $cell = $(cells[0]);
      const nested = $cell.find('table').filter((_, t) => $(t).parents('table').first().is(tableEl));
      const textOutside = $cell.clone().find('table').remove().end().text().trim();
      if (nested.length > 0 && !textOutside) {
        nested.each((_, t) => out.push(...infoboxRows($, $(t))));
        continue;
      }
    }
    out.push(tr);
  }
  return out;
}

/**
 * Converts a table element to Markdown programmatically.
 * Utilizes a 2D grid to handle colspan and rowspan cells correctly without overlapping.
 * @param {object} $ Cheerio instance
 * @param {object} tableEl Cheerio table element
 * @param {string} baseUrl Base URL of the page
 * @param {string} linkMode Mode for formatting links
 * @returns {string} Markdown table content
 */
function convertTableToMarkdown($, tableEl, baseUrl, linkMode, images = []) {
  const cellGrid = [];
  const rows = tableEl.hasClass('infobox') ? infoboxRows($, tableEl) : ownRows($, tableEl);

  rows.forEach((tr, rIndex) => {
    let cIndex = 0;
    ownCells($, tr).forEach((cell) => {
      const $cell = $(cell);
      const text = cleanNodeText($, $cell, baseUrl, linkMode, true, false, images)
        .replace(/\s+/g, ' ')
        .replace(/\|/g, (m, offset, s) => (s[offset - 1] === '\\' ? m : '\\|'))
        .replace(/^(?:\s*<br>\s*)+|(?:\s*<br>\s*)+$/g, '')
        .trim();
      const rowspan = Math.min(parseInt($cell.attr('rowspan')) || 1, 500);
      const colspan = Math.min(parseInt($cell.attr('colspan')) || 1, 50);

      if (!cellGrid[rIndex]) cellGrid[rIndex] = [];
      while (cellGrid[rIndex][cIndex] !== undefined) cIndex++;

      for (let r = 0; r < rowspan; r++) {
        const targetRow = rIndex + r;
        if (targetRow >= rows.length) break;
        if (!cellGrid[targetRow]) cellGrid[targetRow] = [];
        for (let c = 0; c < colspan; c++) {
          // Only the first cell of a colspan carries the text, so content
          // never duplicates side-by-side.
          cellGrid[targetRow][cIndex + c] = (c === 0) ? text : '';
        }
      }
      cIndex += colspan;
    });
  });

  // Drop rows left entirely empty (e.g. an image row whose image moved out).
  const grid = cellGrid.filter((row) => row && row.some((cell) => cell));
  if (grid.length === 0) return '';

  const maxCols = Math.max(...grid.map((r) => r.length));
  if (maxCols === 0) return '';
  for (const row of grid) {
    for (let c = 0; c < maxCols; c++) if (row[c] === undefined) row[c] = '';
  }

  let md = '\n';
  md += '| ' + grid[0].map((cell) => cell || ' ').join(' | ') + ' |\n';
  md += '| ' + Array(maxCols).fill('---').join(' | ') + ' |\n';
  for (let r = 1; r < grid.length; r++) {
    md += '| ' + grid[r].map((cell) => cell || ' ').join(' | ') + ' |\n';
  }
  return md + '\n';
}

/**
 * Processes text inside an HTML element and maps it to Markdown equivalents.
 * Wiki links come out as standard markdown links to en.wikipedia.org;
 * markdown.js's applyLinkMode turns them into wikilinks/comments/plain text.
 * @param {object} $ Cheerio instance
 * @param {object} node Cheerio node element
 * @param {string} baseUrl Base page URL
 * @param {string} linkMode Unused here (kept for signature stability)
 * @param {boolean} inTable True if this processing is occurring inside a table cell
 * @param {boolean} omitReferences True if reference footnotes should be omitted
 * @returns {string} Markdown-formatted text
 */
function cleanNodeText($, node, baseUrl, linkMode = 'standard', inTable = false, omitReferences = false, images = []) {
  const parts = [];
  const recurse = ($n) => cleanNodeText($, $n, baseUrl, linkMode, inTable, omitReferences, images);
  let origin = 'https://en.wikipedia.org';
  try { origin = new URL(baseUrl).origin.replace('.m.wikipedia.org', '.wikipedia.org'); } catch (e) { /* keep default */ }

  node.contents().each((_, child) => {
    if (child.type === 'text') {
      let text = child.data;
      // Literal "[12]" in text would read as a link reference; escape it.
      if (!omitReferences) text = text.replace(/\[(\d+)\]/g, '\\[$1]');
      parts.push(text);
      return;
    }
    if (child.type !== 'tag') return;

    const $child = $(child);
    const tagName = child.name;

    if (tagName === 'a') {
      const href = $child.attr('href') || '';
      const text = recurse($child);
      if (!text.trim()) return;
      const target = wikiTarget(href);

      if (target && NON_ARTICLE_NAMESPACES.test(target.title)) {
        parts.push(text);
      } else if ($child.hasClass('new') || href.includes('redlink=1')) {
        parts.push(text); // red link: no article to point at
      } else if (target) {
        // Self-links and same-page jumps carry no title worth linking.
        if (!target.title) { parts.push(text); return; }
        parts.push(`[${escapeLinkText(text.trim())}](${wikiUrl(target.title, target.fragment, origin)})`);
      } else if (!href || href.startsWith('#')) {
        parts.push(text);
      } else {
        const absoluteUrl = resolveUrl(href, baseUrl).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
        if (linkMode === 'plain') parts.push(text);
        else if (linkMode === 'comment') parts.push(`${text.trim()}%%[Link](${absoluteUrl})%%`);
        else parts.push(`[${escapeLinkText(text.trim())}](${absoluteUrl})`);
      }
    } else if (tagName === 'b' || tagName === 'strong') {
      parts.push(wrapInline('**', recurse($child)));
    } else if (tagName === 'i' || tagName === 'em') {
      parts.push(wrapInline('*', recurse($child)));
    } else if (tagName === 'code' || tagName === 'kbd' || tagName === 'samp') {
      const text = $child.text();
      if (text) parts.push(`\`${text.replace(/`/g, "'")}\``);
    } else if (tagName === 'img') {
      // Images inside running text and table cells — flags beside names,
      // icons in lists, link-box logos — never belong to the note. Article
      // images arrive through figures, the infobox, and (opt-in) galleries.
      return;
    } else if (tagName === 'sup') {
      const isRef = $child.hasClass('reference') || /^\[[^\]]+\]$/.test($child.text().trim()) && $child.find('a[href*="#cite_note-"]').length > 0;
      if (isRef) {
        if (omitReferences) return;
        // The cite_note id ties the in-body marker to its definition below;
        // footnoteId sanitizes both ends identically.
        const anchor = $child.find('a[href*="#cite_note-"]').first();
        let refId = '';
        if (anchor.length > 0) {
          refId = anchor.attr('href').split('#cite_note-')[1] || '';
          try { refId = decodeURIComponent(refId); } catch (e) { /* keep raw */ }
        } else {
          refId = $child.text().replace(/[[\]]/g, '');
        }
        parts.push(`[^${footnoteId(refId)}]`);
      } else {
        const text = recurse($child);
        if (text.trim()) parts.push(`<sup>${text.trim()}</sup>`);
      }
    } else if (tagName === 'sub') {
      const text = recurse($child);
      if (text.trim()) parts.push(`<sub>${text.trim()}</sub>`);
    } else if (tagName === 'br') {
      parts.push(inTable ? '<br>' : '\n');
    } else if (tagName === 'ul' || tagName === 'ol') {
      const listItems = [];
      $child.children('li').each((_, li) => {
        const liText = recurse($(li)).replace(/\s*\n\s*/g, ' ').trim();
        if (liText) listItems.push(liText);
      });
      if (inTable) {
        // Horizontal lists (hlist) read as a comma run; others one per line.
        parts.push(($child.closest('.hlist').length ? listItems.join(', ') : listItems.join('<br>')) + ' ');
      } else {
        parts.push('\n' + listItems.map((item) => `- ${item}`).join('\n') + '\n');
      }
    } else if (tagName === 'table' && inTable) {
      const rows = [];
      ownRows($, $child).forEach((tr) => {
        const cells = ownCells($, tr).map((c) => recurse($(c)).replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (cells.length) rows.push(cells.join(': '));
      });
      parts.push(`<br>${rows.join('<br>')}<br>`);
    } else if (inTable && ['div', 'p', 'tr', 'dl', 'dd', 'dt', 'figure', 'figcaption', 'blockquote'].includes(tagName)) {
      // Block content inside a cell: keep the line break it implies.
      parts.push(`<br>${recurse($child)}<br>`);
    } else {
      parts.push(recurse($child));
    }
  });

  let out = parts.join('');
  if (inTable) out = out.replace(/(?:\s*<br>\s*){2,}/g, '<br>');
  return out;
}

/** True for a <div> that only wraps block-level structure (no prose of its own). */
function isWrapperDiv($, $el) {
  const hasOwnText = $el.contents().toArray().some((n) => n.type === 'text' && n.data.trim());
  if (hasOwnText) return false;
  return $el.children().toArray().some((c) => ['p', 'div', 'ul', 'ol', 'table', 'dl', 'figure', 'blockquote', 'section', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(c.name));
}

/**
 * Parses a Wikipedia article HTML, decomposing it into structured sections and elements.
 * @param {string} html The raw Wikipedia article HTML content
 * @param {string} url The URL of the page
 * @param {object} options Options object containing:
 *        - linkMode: standard, wikilink, comment, plain
 *        - omitReferences: boolean
 *        - includeGalleries: boolean — also take gallery thumbnails (default false)
 * @returns {object} Structured article data
 */
function parseWikipediaArticle(html, url, options = {}) {
  const $ = cheerio.load(html);
  cleanHtml($);

  const title = $('#firstHeading').text().trim() ||
    $('title').first().text().replace(/\s+[-–—]\s+Wikipedia\s*$/, '').trim() ||
    'Wikipedia Article';
  const contentDiv = $('#mw-content-text .mw-parser-output').first();
  if (!contentDiv || contentDiv.length === 0) {
    throw new Error('Failed to find main content text on page.');
  }

  const images = [];
  const text = (el, omit = options.omitReferences) =>
    cleanNodeText($, $(el), url, options.linkMode, false, omit, images);
  const paragraph = (s) => s.replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();

  function figureCaption($fig) {
    const cap = $fig.find('figcaption, .thumbcaption, .gallerytext, .infobox-caption').first();
    if (cap.length === 0) return '';
    const clone = cap.clone();
    clone.find('.magnify, sup.reference').remove();
    return clone.text().replace(/\s+/g, ' ').trim();
  }

  /**
   * The infobox's own pictures: cells that hold an image and nothing else
   * but a caption (poster, portrait, map). Flags or signatures sitting
   * beside data in a cell don't qualify.
   * @returns {Array<{cell: object, img: object, caption: string, captionRow: object|null}>}
   */
  function infoboxPictures($table) {
    const out = [];
    $table.find('img').each((_, img) => {
      const $img = $(img);
      if (isIconLike($img.attr('src') || '', parseInt($img.attr('width')) || 0, parseInt($img.attr('height')) || 0)) return;
      const $cell = $img.closest('td, th');
      if (!$cell.length || out.some((p) => p.cell === $cell[0])) return;
      const ownText = $cell.clone().find('.infobox-caption, style').remove().end().text().trim();
      if (ownText) return;
      const $next = $cell.closest('tr').next('tr');
      const nextIsCaption = $next.is('.infobox-caption') || ($next.find('.infobox-caption').length > 0 &&
        !$next.text().replace($next.find('.infobox-caption').text(), '').trim());
      const caption = (figureCaption($cell) || (nextIsCaption ? $next.text() : '')).replace(/\s+/g, ' ').trim();
      out.push({ cell: $cell[0], img, caption, captionRow: nextIsCaption ? $next[0] : null });
    });
    return out;
  }

  // Register the lead infobox's pictures first so a film's poster stays image #1.
  for (const pic of infoboxPictures($('.infobox').first())) {
    registerImage($, pic.img, url, images, pic.caption, 'infobox');
  }

  const sections = [];
  let currentSection = { title: 'Introduction', level: 1, id: 'section-intro', elements: [] };
  const push = (el) => currentSection.elements.push(el);

  const imageElement = (key, caption) => ({
    type: 'image',
    url: key,
    caption,
    content: `{{IMAGE:${key}}}${caption ? `\n*${caption.replace(/\*/g, '')}*` : ''}`
  });

  function collectRefs($el) {
    const refs = [];
    $el.find('ol.references').addBack('ol.references').children('li').each((_, li) => {
      const $li = $(li);
      const refId = $li.attr('id') || '';
      const clone = $li.clone();
      clone.find('.mw-cite-backlink, .mw-linkback-text').remove();
      const refText = paragraph(cleanNodeText($, clone, url, options.linkMode, false, true, images).replace(/\n+/g, ' '));
      if (refId && refText) refs.push({ id: refId, text: refText });
    });
    return refs;
  }

  function walk(el) {
    const $el = $(el);
    const tagName = el.name;
    const cls = $el.attr('class') || '';

    if (tagName === 'section') {
      $el.children().each((_, c) => walk(c));
      return;
    }

    // Headings: bare <h2>…<h6> (legacy) or <div class="mw-heading"> (current).
    let headingEl = null;
    if (/^h[2-6]$/.test(tagName)) headingEl = $el;
    else if (tagName === 'div' && /\bmw-heading\b/.test(cls)) {
      const h = $el.find('h2, h3, h4, h5, h6').first();
      if (h.length) headingEl = h;
    }
    if (headingEl) {
      if (currentSection.elements.length > 0 || currentSection.title !== 'Introduction') {
        sections.push(currentSection);
      }
      const headingText = headingEl.text().replace('[edit]', '').replace(/\s+/g, ' ').trim();
      currentSection = {
        title: headingText,
        level: parseInt(headingEl[0].name[1]),
        id: headingEl.attr('id') || $el.attr('id') || headingText.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        elements: []
      };
      return;
    }

    // Reference lists (legacy div.reflist, Parsoid div.mw-references-wrap, bare ol).
    if ($el.is('ol.references') || $el.find('ol.references').length > 0) {
      if (!options.omitReferences) {
        const refs = collectRefs($el);
        if (refs.length) push({ type: 'references', content: refs });
      }
      return;
    }

    // Images: figures, legacy thumbs, galleries (div.gallery or Parsoid ul.gallery).
    if (tagName === 'figure' || /\b(thumb|gallery)\b/.test(cls)) {
      // Galleries pile up dozens of loosely related thumbnails (flags,
      // emblems, every carving on a temple); they only come along when the
      // caller opts in. Figures — the article's captioned pictures — always do.
      const isGallery = $el.find('.gallerybox').length > 0 || /\bgallery\b/.test(cls);
      if (isGallery && !options.includeGalleries) return;
      const boxes = isGallery ? $el.find('.gallerybox') : $el;
      boxes.each((_, box) => {
        const $box = $(box);
        const img = $box.find('img').first();
        if (img.length === 0) return;
        const caption = figureCaption($box) || (img.attr('alt') || '').trim();
        const key = registerImage($, img[0], url, images, caption, isGallery ? 'gallery' : 'figure');
        if (key) push(imageElement(key, caption));
      });
      return;
    }

    if (tagName === 'p') {
      const md = paragraph(text(el));
      if (md) push({ type: 'p', content: md });
      return;
    }

    if (tagName === 'table') {
      const isInfobox = $el.hasClass('infobox');
      if (isInfobox) {
        // Image rows move out of the infobox to sit above it as real
        // images, instead of a cell holding `![[poster.jpg]]Theatrical release poster`.
        for (const pic of infoboxPictures($el)) {
          const key = registerImage($, pic.img, url, images, pic.caption, 'infobox');
          if (key) push(imageElement(key, pic.caption));
          $(pic.cell).closest('tr').remove();
          if (pic.captionRow) $(pic.captionRow).remove();
        }
      }
      const tableMd = convertTableToMarkdown($, $el, url, options.linkMode, images);
      if (tableMd.trim()) push({ type: 'table', content: tableMd, isInfobox });
      return;
    }

    if (tagName === 'ul' || tagName === 'ol') {
      const items = [];
      $el.children('li').each((_, li) => {
        const liText = paragraph(text(li)).replace(/\n(?!\s*- )/g, ' ');
        if (liText) items.push(liText.replace(/\n/g, '\n  '));
      });
      if (items.length > 0) {
        const bullet = tagName === 'ol' ? (i) => `${i + 1}. ` : () => '- ';
        push({ type: 'list', content: items.map((item, i) => bullet(i) + item).join('\n') });
      }
      return;
    }

    if (tagName === 'blockquote') {
      const md = paragraph(text(el));
      if (md) push({ type: 'p', content: md.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n') });
      return;
    }

    if (tagName === 'dl') {
      const lines = [];
      $el.children('dt, dd').each((_, item) => {
        const md = paragraph(text(item));
        if (!md) return;
        lines.push(item.name === 'dt' ? `**${md}**` : md);
      });
      if (lines.length) push({ type: 'p', content: lines.join('\n') });
      return;
    }

    if (tagName === 'div') {
      if (isWrapperDiv($, $el)) {
        $el.children().each((_, c) => walk(c));
      } else {
        const md = paragraph(text(el));
        if (md) push({ type: 'p', content: md });
      }
    }
  }

  contentDiv.children().each((_, el) => walk(el));
  if (currentSection.elements.length > 0) sections.push(currentSection);

  // Headings left with nothing beneath them and no populated subsection
  // (e.g. "Works cited" after its cleanup banner got stripped) drop out.
  const pruned = sections.filter((sec, i) => {
    if (sec.elements.length > 0 || sec.id === 'section-intro') return true;
    for (let j = i + 1; j < sections.length && sections[j].level > sec.level; j++) {
      if (sections[j].elements.length > 0) return true;
    }
    return false;
  });

  // Reference lists that sat outside the walked content.
  if (!options.omitReferences && !pruned.some((s) => s.elements.some((e) => e.type === 'references'))) {
    const refs = collectRefs($('ol.references').parent());
    if (refs.length > 0) {
      pruned.push({ title: 'References', level: 2, id: 'references-section', elements: [{ type: 'references', content: refs }] });
    }
  }

  return {
    title,
    url,
    sections: pruned,
    images: images.map(({ originalUrl, caption, fileWidth, source }) => ({ originalUrl, caption, fileWidth, source }))
  };
}

module.exports = {
  parseWikipediaArticle,
  convertTableToMarkdown,
  cleanNodeText,
  wikiTarget
};
