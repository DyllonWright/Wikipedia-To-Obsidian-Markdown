// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const { parseWikipediaArticle } = require('./src/parser');
const { analyzeMetadataAndImages } = require('./src/gemini');
const { exportArticle } = require('./src/exporter');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so the Obsidian plugin can call our server
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve the static frontend
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Endpoint to analyze a Wikipedia article.
 * Fetches page content, structures sections, finds images, and gets Gemini suggestions.
 */
app.get('/api/analyze', async (req, res) => {
  const { url, date } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Wikipedia URL is required.' });
  }
  
  try {
    console.log(`Analyzing Wikipedia URL: ${url}`);
    
    // Fetch HTML
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
      }
    });
    
    const html = response.data;
    
    // Parse article HTML structure programmatically
    const parsedData = parseWikipediaArticle(html, url, {
      linkMode: 'standard',
      omitReferences: false
    });
    
    // Extract lead section text and infobox summary for Gemini analysis
    let leadText = '';
    const introSection = parsedData.sections.find(s => s.id === 'section-intro');
    if (introSection) {
      leadText = introSection.elements
        .filter(el => el.type === 'p')
        .map(el => el.content)
        .join(' ');
    }
    
    let infoboxHtml = '';
    if (introSection) {
      const infoboxEl = introSection.elements.find(el => el.type === 'table' && el.isInfobox);
      if (infoboxEl) {
        infoboxHtml = infoboxEl.content;
      }
    }
    
    // Format a vault date (default to today if not provided)
    const activeDate = date || new Date().toISOString().split('T')[0].replace(/-/g, ' ');
    
    // Query Gemini for movie details and image names
    console.log('Sending metadata to Gemini for analysis and name suggestions...');
    const geminiAnalysis = await analyzeMetadataAndImages(
      parsedData.title,
      leadText,
      infoboxHtml,
      parsedData.images,
      activeDate
    );
    
    // Combine programmatic parse results with Gemini metadata
    const result = {
      title: parsedData.title,
      url: parsedData.url,
      isMovie: geminiAnalysis.isMovie,
      movieTitle: geminiAnalysis.movieTitle || parsedData.title,
      releaseYear: geminiAnalysis.releaseYear || '',
      briefDescription: geminiAnalysis.briefDescription || '',
      sections: parsedData.sections.map(s => ({
        id: s.id,
        title: s.title,
        level: s.level,
        elementCount: s.elements.length
      })),
      images: parsedData.images.map(img => {
        // Find Gemini suggestion for this image
        const suggestion = geminiAnalysis.imageSuggestions.find(s => s.originalUrl === img.originalUrl);
        return {
          originalUrl: img.originalUrl,
          caption: img.caption,
          suggestedName: suggestion ? suggestion.suggestedName : `${activeDate} ${parsedData.title}`,
          isPoster: suggestion ? suggestion.isPoster : false
        };
      }),
      // Keep parsed sections data cache on server to avoid re-scraping during generate
      rawSections: parsedData.sections
    };
    
    res.json(result);
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

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

/**
 * Endpoint to generate the final markdown document.
 * This runs the generation on-the-fly and returns the raw string back to the user.
 */
app.post('/api/generate', async (req, res) => {
  const {
    title,
    url,
    rawSections,
    selectedSections,
    linkMode,
    omitReferences
  } = req.body;
  
  if (!title || !rawSections) {
    return res.status(400).json({ error: 'Missing title or article sections data.' });
  }
  
  try {
    // Re-parse or parse from rawSections mapping
    const markdown = assembleMarkdown(title, url, rawSections, selectedSections, linkMode, omitReferences);
    res.json({ markdown });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Endpoint to export the markdown note and download attachments.
 * Saves directly to disk (local outputs or specified Obsidian Vault).
 */
app.post('/api/export', async (req, res) => {
  const {
    title,
    markdown,
    images,
    saveToVault,
    vaultPath,
    attachmentsFolder,
    linkMode
  } = req.body;
  
  try {
    const result = await exportArticle({
      title,
      markdown,
      images,
      saveToVault,
      vaultPath,
      attachmentsFolder,
      linkMode
    });
    
    res.json(result);
  } catch (error) {
    console.error('Export error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start listening
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Wikipedia to Obsidian Markdown Server Running!`);
  console.log(`Access GUI: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
