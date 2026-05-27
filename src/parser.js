// src/parser.js
const cheerio = require('cheerio');
const urlModule = require('url');

/**
 * Cleans the Wikipedia HTML by removing unnecessary layout/script/edit elements.
 * @param {object} $ Cheerio instance
 */
function cleanHtml($) {
  // Remove edit section links
  $('.mw-editsection').remove();
  // Remove scripts, styles, link elements
  $('script, style, link').remove();
  // Remove TOC
  $('#toc, .toc').remove();
  // Remove jump links
  $('.mw-jump-link').remove();
  // Remove navboxes, categories, print footers
  $('.navbox, .catlinks, .printfooter, .metadata, .ambox, .stub').remove();
  // Remove empty spans/divs
  $('.mw-empty-elt').remove();
  // Remove citation backlinks (e.g. ^ a b c) to prevent muddled references
  $('.mw-cite-backlink').remove();
  // Remove noscript fallback blocks to prevent stray double brackets [[File:...]]
  $('noscript').remove();

  // Prune raw wikitext image fallback text nodes (like [[File:name.jpg|...]] or [[Image:...]])
  // inside Wikipedia's custom image wrappers to prevent stray double brackets in table cells
  $('[typeof^="mw:File"]').contents().filter(function() {
    return this.type === 'text';
  }).remove();
  
  $('.mw-file-description').contents().filter(function() {
    return this.type === 'text';
  }).remove();
}

/**
 * Resolves a Wikipedia relative link to a clean absolute URL.
 * @param {string} href The link href attribute
 * @param {string} baseUrl The original page URL
 * @returns {string} The resolved absolute URL
 */
function resolveUrl(href, baseUrl) {
  if (!href) return '';
  if (href.startsWith('//')) {
    return 'https:' + href;
  }
  if (href.startsWith('/')) {
    return urlModule.resolve(baseUrl, href);
  }
  return href;
}

/**
 * Extracts a clean Wikipedia title from a relative /wiki/ path.
 * @param {string} href Wikipedia relative URL
 * @returns {string} The clean article title
 */
function getWikiTitle(href) {
  if (!href) return '';
  const match = href.match(/\/wiki\/([^?#]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).replace(/_/g, ' ');
  } catch (e) {
    return match[1].replace(/_/g, ' ');
  }
}

/**
 * Checks if a URL is a Wikipedia internal link.
 * @param {string} href Link URL
 * @returns {boolean}
 */
function isWikiLink(href) {
  return href && (href.startsWith('/wiki/') || href.includes('wikipedia.org/wiki/'));
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
  
  // Only iterate rows that are DIRECT children of this table (not nested table rows).
  // Using find('tr') would recursively descend into nested <table> elements and duplicate content.
  const directRows = tableEl.find('tr').filter((_, tr) => {
    return $(tr).closest('table').is(tableEl);
  });

  directRows.each((rIndex, tr) => {
    let cIndex = 0;
    $(tr).find('th, td').filter((_, cell) => $(cell).closest('table').is(tableEl)).each((_, cell) => {
      const $cell = $(cell);
      
      // Clean cell content, removing block elements' layout issues, and capture any images inside
      const text = cleanNodeText($, $cell, baseUrl, linkMode, true, false, images).replace(/\s+/g, ' ').trim();
      const rowspan = parseInt($cell.attr('rowspan')) || 1;
      const colspan = parseInt($cell.attr('colspan')) || 1;
      
      // Find the first empty cell in our grid for this row
      if (!cellGrid[rIndex]) cellGrid[rIndex] = [];
      while (cellGrid[rIndex][cIndex] !== undefined) {
        cIndex++;
      }
      
      // Populate cell grid for rowspan and colspan span sizes
      for (let r = 0; r < rowspan; r++) {
        const targetRow = rIndex + r;
        if (!cellGrid[targetRow]) cellGrid[targetRow] = [];
        for (let c = 0; c < colspan; c++) {
          const targetCol = cIndex + c;
          // Safeguard: Only place the text in the first cell of the colspan span; subsequent cells are empty
          // This prevents table columns and content from being duplicated side-by-side
          cellGrid[targetRow][targetCol] = (c === 0) ? text : '';
        }
      }
      cIndex += colspan;
    });
  });
  
  if (cellGrid.length === 0) return '';
  
  // Calculate max columns
  const maxCols = Math.max(...cellGrid.map(r => r.length));
  if (maxCols === 0) return '';
  
  // Fill in any undefined elements with empty strings
  for (let r = 0; r < cellGrid.length; r++) {
    if (!cellGrid[r]) cellGrid[r] = [];
    while (cellGrid[r].length < maxCols) {
      cellGrid[r].push('');
    }
  }
  
  // Build markdown string
  let md = '\n';
  
  // Header row
  const header = cellGrid[0].map(cell => cell || ' ');
  md += '| ' + header.join(' | ') + ' |\n';
  
  // Divider row
  const divider = Array(maxCols).fill('---');
  md += '| ' + divider.join(' | ') + ' |\n';
  
  // Data rows
  for (let r = 1; r < cellGrid.length; r++) {
    const row = cellGrid[r].map(cell => cell || ' ');
    md += '| ' + row.join(' | ') + ' |\n';
  }
  
  return md + '\n';
}

/**
 * Processes text inside an HTML element and maps it to Markdown equivalents.
 * @param {object} $ Cheerio instance
 * @param {object} node Cheerio node element
 * @param {string} baseUrl Base page URL
 * @param {string} linkMode Mode for links ('standard', 'wikilink', 'comment', 'plain')
 * @param {boolean} inTable True if this processing is occurring inside a table cell
 * @param {boolean} omitReferences True if reference footnotes should be omitted
 * @returns {string} Markdown-formatted text
 */
function cleanNodeText($, node, baseUrl, linkMode = 'standard', inTable = false, omitReferences = false, images = []) {
  let parts = [];
  
  node.contents().each((_, child) => {
    if (child.type === 'text') {
      // Escape brackets that look like citations if not handled as reference nodes
      let text = child.data;
      if (!omitReferences) {
        text = text.replace(/\[(\d+)\]/g, '\\[$1]');
      }
      parts.push(text);
    } else if (child.type === 'tag') {
      const $child = $(child);
      const tagName = child.name;
      
      if (tagName === 'a') {
        const href = $child.attr('href') || '';
        const text = cleanNodeText($, $child, baseUrl, linkMode, inTable, omitReferences, images).trim();
        if (!text) return;
        
        // Skip File:/Image: wiki links — these are image file-description pages that wrap <img> tags.
        // The inner <img> already emits {{IMAGE:...}} so we just pass the inner content through.
        if (/^\/wiki\/(File|Image):/i.test(href)) {
          parts.push(text);
          return;
        }
        
        const absoluteUrl = resolveUrl(href, baseUrl);
        
        if (isWikiLink(href)) {
          const wikiTitle = getWikiTitle(href);
          
          if (linkMode === 'wikilink') {
            if (wikiTitle.toLowerCase() === text.toLowerCase()) {
              parts.push(`[[${wikiTitle}]]`);
            } else {
              parts.push(`[[${wikiTitle}|${text}]]`);
            }
          } else if (linkMode === 'comment') {
            parts.push(`${text}%%[Link](https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))})%%`);
          } else if (linkMode === 'plain') {
            parts.push(text);
          } else { // standard
            parts.push(`[${text}](https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))})`);
          }
        } else if (href && href.startsWith('#')) {
          // Internal page jump link, map to plain text
          parts.push(text);
        } else if (href) {
          // External link
          if (linkMode === 'comment') {
            parts.push(`${text}%%[Link](${absoluteUrl})%%`);
          } else if (linkMode === 'plain') {
            parts.push(text);
          } else {
            parts.push(`[${text}](${absoluteUrl})`);
          }
        } else {
          parts.push(text);
        }
      } else if (tagName === 'b' || tagName === 'strong') {
        const text = cleanNodeText($, $child, baseUrl, linkMode, inTable, omitReferences, images).trim();
        if (text) parts.push(`**${text}**`);
      } else if (tagName === 'i' || tagName === 'em') {
        const text = cleanNodeText($, $child, baseUrl, linkMode, inTable, omitReferences, images).trim();
        if (text) parts.push(`*${text}*`);
      } else if (tagName === 'code') {
        const text = $child.text();
        if (text) parts.push(`\`${text}\``);
      } else if (tagName === 'img') {
        const src = $child.attr('src');
        if (src) {
          const absoluteUrl = resolveUrl(src, baseUrl);
          const width = parseInt($child.attr('width')) || 0;
          const height = parseInt($child.attr('height')) || 0;
          const srcLower = src.toLowerCase();
          const isIcon = srcLower.includes('icon') || 
                         srcLower.includes('edit-') || 
                         srcLower.includes('padlock') || 
                         srcLower.includes('question_book') || 
                         srcLower.includes('commons-logo');
                         
          if (!((width > 0 && width < 50) || (height > 0 && height < 50) || isIcon)) {
            parts.push(`{{IMAGE:${absoluteUrl}}}`);
            if (images && !images.some(img => img.originalUrl === absoluteUrl)) {
              images.push({
                originalUrl: absoluteUrl,
                caption: $child.attr('alt') || ''
              });
            }
          }
        }
      } else if (tagName === 'sup') {
        const isRef = $child.hasClass('reference') || $child.find('a').hasClass('mw-cite-backlink') || $child.text().match(/^\[\d+\]$/);
        if (isRef) {
          if (omitReferences) {
            // Strip out references entirely
            return;
          }
          // Use the href anchor to get the exact cite_note-* ID so that the in-body
          // footnote [^AuthorYear-5] matches the definition [^AuthorYear-5]: at the bottom.
          // Falls back to visible display text (e.g. "5") if no anchor is found.
          const anchor = $child.find('a[href^="#cite_note-"]').first();
          let refId;
          if (anchor.length > 0) {
            refId = anchor.attr('href').replace('#cite_note-', '');
          } else {
            refId = $child.text().replace(/[\[\]]/g, '');
          }
          parts.push(`[^${refId}]`);
        } else {
          const text = cleanNodeText($, $child, baseUrl, linkMode, inTable, omitReferences, images);
          if (text) parts.push(`^${text}`);
        }
      } else if (tagName === 'sub') {
        const text = cleanNodeText($, $child, baseUrl, linkMode, inTable, omitReferences, images);
        if (text) parts.push(`~${text}~`);
      } else if (tagName === 'br') {
        parts.push(inTable ? '<br>' : '\n');
      } else if (['span', 'div', 'small', 'big', 'cite', 'abbr', 'dfn', 'q'].includes(tagName)) {
        parts.push(cleanNodeText($, $child, baseUrl, linkMode, inTable, omitReferences, images));
      } else if (tagName === 'ul' || tagName === 'ol') {
        const listItems = [];
        $child.find('> li').each((_, li) => {
          const liText = cleanNodeText($, $(li), baseUrl, linkMode, inTable, omitReferences, images).trim();
          if (liText) listItems.push(liText);
        });
        if (inTable) {
          parts.push(listItems.join(', '));
        } else {
          parts.push('\n' + listItems.map(item => `- ${item}`).join('\n') + '\n');
        }
      } else {
        // Fallback for list items or other unrecognized tags
        parts.push(cleanNodeText($, $child, baseUrl, linkMode, inTable, omitReferences, images));
      }
    }
  });
  
  return parts.join('');
}

/**
 * Parses a Wikipedia article HTML, decomposing it into structured sections and elements.
 * @param {string} html The raw Wikipedia article HTML content
 * @param {string} url The URL of the page
 * @param {object} options Options object containing:
 *        - linkMode: standard, wikilink, comment, plain
 *        - omitReferences: boolean
 * @returns {object} Structured article data
 */
function parseWikipediaArticle(html, url, options = {}) {
  const $ = cheerio.load(html);
  cleanHtml($);
  
  const title = $('#firstHeading').text().trim() || 'Wikipedia Article';
  const contentDiv = $('#mw-content-text .mw-parser-output');
  
  if (!contentDiv || contentDiv.length === 0) {
    throw new Error('Failed to find main content text on page.');
  }
  
  // Extract all page images (both in infobox, galleries, figures)
  const images = [];
  
  // Helper to extract image meta
  function addImage(imgEl, caption = '') {
    const src = $(imgEl).attr('src');
    if (!src) return;
    
    // Resolve absolute URL
    let absoluteUrl = resolveUrl(src, url);
    
    // Filter out obvious layout icons, logos under 50px, or Wikipedia UI markers
    const width = parseInt($(imgEl).attr('width')) || 0;
    const height = parseInt($(imgEl).attr('height')) || 0;
    
    const srcLower = src.toLowerCase();
    const isIcon = srcLower.includes('icon') || 
                   srcLower.includes('edit-') || 
                   srcLower.includes('padlock') || 
                   srcLower.includes('question_book') ||
                   srcLower.includes('commons-logo') ||
                   srcLower.includes('folder') ||
                   srcLower.includes('star');
                   
    if ((width > 0 && width < 50) || (height > 0 && height < 50) || isIcon) {
      return; // Skip small layout/icon elements
    }
    
    // De-duplicate URLs
    if (images.some(img => img.originalUrl === absoluteUrl)) {
      return;
    }
    
    images.push({
      originalUrl: absoluteUrl,
      caption: caption.trim()
    });
  }
  
  // 1. Find infobox images
  $('.infobox img').each((_, img) => {
    // Caption is often in the same row or below the image row
    let caption = '';
    const infoboxRow = $(img).closest('tr');
    const nextRow = infoboxRow.next();
    if (nextRow.length > 0 && nextRow.hasClass('infobox-caption')) {
      caption = nextRow.text();
    } else {
      caption = $(img).attr('alt') || '';
    }
    addImage(img, caption || `Infobox image for ${title}`);
  });
  
  // 2. Find thumbs and figure images
  $('figure, .thumb').each((_, container) => {
    const $container = $(container);
    const img = $container.find('img').first();
    if (img.length === 0) return;
    
    let caption = '';
    const figcaption = $container.find('figcaption, .thumbcaption');
    if (figcaption.length > 0) {
      // Remove magnifier icon text if present
      figcaption.find('.magnify').remove();
      caption = figcaption.text();
    } else {
      caption = img.attr('alt') || '';
    }
    addImage(img, caption);
  });
  
  // 3. Find galleries
  $('.gallerybox').each((_, box) => {
    const $box = $(box);
    const img = $box.find('img').first();
    if (img.length === 0) return;
    const caption = $box.find('.gallerytext').text() || img.attr('alt') || '';
    addImage(img, caption);
  });
  
  // 4. Find other body images
  contentDiv.find('.mw-file-description img, a.image img').each((_, img) => {
    const caption = $(img).attr('alt') || '';
    addImage(img, caption);
  });

  // Extract sections
  const sections = [];
  
  // Initialize Intro Section (Lead)
  let currentSection = {
    title: 'Introduction',
    level: 1,
    id: 'section-intro',
    elements: []
  };
  
  // Find all elements directly under the container
  contentDiv.children().each((_, el) => {
    const $el = $(el);
    const tagName = el.name;
    
    // Support modern Wikipedia where headings are wrapped in <div class="mw-heading">
    let isHeading = /^h[2-6]$/.test(tagName);
    let headingEl = $el;
    
    if (tagName === 'div' && ($el.hasClass('mw-heading') || ($el.attr('class') && $el.attr('class').includes('mw-heading')))) {
      const hTag = $el.find('h2, h3, h4, h5, h6').first();
      if (hTag.length > 0) {
        isHeading = true;
        headingEl = hTag;
      }
    }
    
    // Check if it's a heading
    if (isHeading) {
      // Push old section if it has content
      if (currentSection.elements.length > 0 || currentSection.title !== 'Introduction') {
        sections.push(currentSection);
      }
      
      const hTagName = headingEl[0].name;
      const headingLevel = parseInt(hTagName[1]);
      const headingText = headingEl.text().replace('[edit]', '').trim();
      const id = headingEl.attr('id') || $el.attr('id') || headingText.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      currentSection = {
        title: headingText,
        level: headingLevel,
        id: id,
        elements: []
      };
    } else {
      // Check if it's an image block (figure or thumb or gallerybox)
      if (tagName === 'figure' || (tagName === 'div' && ($el.hasClass('thumb') || $el.hasClass('gallery')))) {
        // Find images inside
        $el.find('img').each((_, img) => {
          const src = $(img).attr('src');
          if (!src) return;
          const absoluteUrl = resolveUrl(src, url);
          
          let caption = '';
          const figcaption = $el.find('figcaption, .thumbcaption, .gallerytext');
          if (figcaption.length > 0) {
            figcaption.find('.magnify').remove();
            caption = figcaption.text().trim();
          } else {
            caption = $(img).attr('alt') || '';
          }
          
          // Make sure it gets added to global list if valid
          if (!images.some(imgObj => imgObj.originalUrl === absoluteUrl)) {
            addImage(img, caption);
          }
          
          const isAdded = images.some(imgObj => imgObj.originalUrl === absoluteUrl);
          if (isAdded) {
            currentSection.elements.push({
              type: 'image',
              url: absoluteUrl,
              caption: caption,
              content: `\n{{IMAGE:${absoluteUrl}}}\n*${caption}*\n`
            });
          }
        });
      } else if (tagName === 'p') {
        const mdText = cleanNodeText($, $el, url, options.linkMode, false, options.omitReferences, images).trim();
        if (mdText) {
          currentSection.elements.push({ type: 'p', content: mdText });
        }
      } else if (tagName === 'table') {
        // Convert to standard table, and capture images inside
        const isInfobox = $el.hasClass('infobox');
        const tableMd = convertTableToMarkdown($, $el, url, options.linkMode, images);
        if (tableMd.trim()) {
          currentSection.elements.push({ type: 'table', content: tableMd, isInfobox });
        }
      } else if (tagName === 'ul' || tagName === 'ol') {
        const items = [];
        $el.find('> li').each((_, li) => {
          const liText = cleanNodeText($, $(li), url, options.linkMode, false, options.omitReferences, images).trim();
          if (liText) items.push(liText);
        });
        if (items.length > 0) {
          const listMd = items.map(item => `- ${item}`).join('\n');
          currentSection.elements.push({ type: 'list', content: listMd });
        }
      } else if ($el.hasClass('reflist') || $el.attr('id') === 'references' || tagName === 'ol' && $el.hasClass('references')) {
        // References block
        if (!options.omitReferences) {
          const refs = [];
          $el.find('li').each((_, li) => {
            const refId = $(li).attr('id') || '';
            const refText = cleanNodeText($, $(li), url, options.linkMode, false, true, images).trim();
            refs.push({ id: refId, text: refText });
          });
          currentSection.elements.push({ type: 'references', content: refs });
        }
      } else if (tagName === 'dl') {
        const dlText = cleanNodeText($, $el, url, options.linkMode, false, options.omitReferences, images).trim();
        if (dlText) {
          currentSection.elements.push({ type: 'p', content: dlText });
        }
      }
    }
  });
  
  // Push the final section
  if (currentSection.elements.length > 0) {
    sections.push(currentSection);
  }
  
  // Post-process sections: identify and separate reference footnotes if found elsewhere
  if (!options.omitReferences) {
    const referencesOl = $('ol.references');
    if (referencesOl.length > 0) {
      const refs = [];
      referencesOl.find('li').each((_, li) => {
        const refId = $(li).attr('id') || '';
        const refText = cleanNodeText($, $(li), url, options.linkMode, false, true, images).trim();
        refs.push({ id: refId, text: refText });
      });
      // Check if we already have a references block
      const hasRefs = sections.some(s => s.elements.some(e => e.type === 'references'));
      if (!hasRefs && refs.length > 0) {
        sections.push({
          title: 'References',
          level: 2,
          id: 'references-section',
          elements: [{ type: 'references', content: refs }]
        });
      }
    }
  }
  
  return {
    title,
    url,
    sections,
    images
  };
}

module.exports = {
  parseWikipediaArticle,
  convertTableToMarkdown,
  cleanNodeText
};
