// server.js
const express = require('express');
const path = require('path');
const { parseWikipediaArticle } = require('./src/parser');
const { analyzeMetadataAndImages } = require('./src/node-gemini');
const { WIKIMEDIA_USER_AGENT } = require('./src/images');
const { exportArticle } = require('./src/exporter');
const { assembleMarkdown } = require('./src/markdown');

const app = express();
const PORT = process.env.PORT || 3000;
// Loopback only: the export endpoint writes files to disk, so nothing off
// this machine should reach it.
const HOST = '127.0.0.1';

// No CORS: only this server's own page may call the API. (The plugin has
// run in-process since 2.0.) Without CORS headers, a web page elsewhere
// cannot drive /api/export into writing files.
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
  let articleUrl;
  try {
    articleUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'That does not look like a URL.' });
  }
  if (!/^https?:$/.test(articleUrl.protocol) || !/(^|.)wikipedia.org$/i.test(articleUrl.hostname)) {
    return res.status(400).json({ error: 'Only wikipedia.org articles can be imported.' });
  }
  articleUrl.protocol = 'https:';
  articleUrl.hostname = articleUrl.hostname.replace(/.m.wikipedia.org$/i, '.wikipedia.org');
  
  try {
    console.log(`Analyzing Wikipedia URL: ${url}`);
    
    // Fetch HTML (native fetch, Node 18+)
    const response = await fetch(articleUrl.toString(), {
      headers: { 'User-Agent': WIKIMEDIA_USER_AGENT }
    });
    if (!response.ok) {
      throw new Error(`Wikipedia returned HTTP ${response.status}`);
    }

    const html = await response.text();
    
    // Parse article HTML structure programmatically
    const parsedData = parseWikipediaArticle(html, articleUrl.toString(), {
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
    
    // Format a vault date (default to today, in the server's local
    // timezone, if not provided). Local components avoid the UTC roll-
    // forward that toISOString() causes for late-evening imports west of UTC.
    const now = new Date();
    const localDate = `${now.getFullYear()} ${String(now.getMonth() + 1).padStart(2, '0')} ${String(now.getDate()).padStart(2, '0')}`;
    const activeDate = date || localDate;
    
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
          fileWidth: img.fileWidth || 0,
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
app.listen(PORT, HOST, () => {
  console.log(`==================================================`);
  console.log(`Wikipedia to Obsidian Markdown Server Running!`);
  console.log(`Access GUI: http://${HOST}:${PORT}`);
  console.log(`==================================================`);
});
