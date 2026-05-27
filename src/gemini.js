// src/gemini.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize Gemini API
let genAI = null;
let model = null;

function initGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('Warning: GEMINI_API_KEY is not defined in the environment. Gemini smart features will be disabled/fallback.');
    return false;
  }
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-2.5-flash as the standard fast & capable model
    model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });
    return true;
  } catch (e) {
    console.error('Failed to initialize Gemini AI:', e.message);
    return false;
  }
}

/**
 * Analyzes article metadata and suggests image names using Gemini.
 * Falls back to programmatic heuristics if the API key is missing or fails.
 * @param {string} title Page title
 * @param {string} leadText Introduction text
 * @param {string} infoboxHtml Cleaned text/HTML of infobox
 * @param {Array} images List of parsed image objects { originalUrl, caption }
 * @param {string} vaultDate Date prefix (YYYY MM DD)
 * @returns {Promise<object>} Analysis results
 */
async function analyzeMetadataAndImages(title, leadText, infoboxHtml, images, vaultDate) {
  const isInitialized = (genAI && model) || initGemini();
  
  if (!isInitialized) {
    return generateFallbackAnalysis(title, leadText, images, vaultDate);
  }
  
  const prompt = `
    You are an expert editor preparing content for a personal Obsidian vault.
    You will be given information about a Wikipedia article:
    Title: "${title}"
    Lead Section: "${leadText.slice(0, 1500)}"
    Infobox Data: "${infoboxHtml.slice(0, 1000)}"
    Images: ${JSON.stringify(images.map(img => ({ originalUrl: img.originalUrl, caption: img.caption })))}
    Vault Date: "${vaultDate}"

    Your task is to:
    1. Determine if this article is about a movie (film) as the main subject.
    2. If it is a movie, extract:
       - movieTitle: The official title of the movie (e.g. "The Gambler").
       - releaseYear: The release year of the movie as a 4-digit number (e.g. "2014").
    3. Suggest a clean, descriptive filename for each image.
       Image Naming Rules:
       - Every filename MUST start with the Vault Date: "${vaultDate} "
       - For standard images, use: "VaultDate Title or brief desc from caption" (e.g. "${vaultDate} Ryan Dahl at NodeConf")
       - For the primary theatrical release poster of a movie (if this is a movie and this image is the poster), use: "VaultDate Movie Title (ReleaseYear) Theatrical Release Poster" (e.g. "${vaultDate} The Gambler (2014) Theatrical Release Poster")
       - Do not include file extensions (e.g., .jpg, .png) in the suggestions.
       - Clean up filenames: remove special characters like \\ / : * ? " < > | [ ] and replace multiple spaces with a single space.
       - Limit suggested filenames to 80 characters maximum.
       - Be descriptive but concise. If an image caption is empty or generic, use the page subject to form a description.

    Return your response strictly as a JSON object with this structure:
    {
      "isMovie": true/false,
      "movieTitle": "...",
      "releaseYear": "...",
      "briefDescription": "...",
      "imageSuggestions": [
        {
          "originalUrl": "URL from the input list",
          "suggestedName": "suggested name matching rules",
          "isPoster": true/false
        }
      ]
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Gemini API Error, falling back to heuristics:', error.message);
    return generateFallbackAnalysis(title, leadText, images, vaultDate);
  }
}

/**
 * Programmatic fallback if Gemini is unavailable.
 */
function generateFallbackAnalysis(title, leadText, images, vaultDate) {
  // Check if title or lead section implies it's a movie
  const titleLower = title.toLowerCase();
  const leadLower = leadText.toLowerCase();
  
  const movieIndicators = ['film', 'movie', 'directed by', 'starring', 'theatrical release', 'cinema of'];
  const isMoviePattern = movieIndicators.some(ind => leadLower.includes(ind)) || titleLower.includes('(film)') || titleLower.includes('(movie)');
  
  let movieTitle = title.replace(/\s*\(.*film.*\)/i, '').replace(/\s*\(.*movie.*\)/i, '').trim();
  let releaseYear = '';
  
  // Try to find a 4 digit year in the title or lead text
  const titleYearMatch = title.match(/\((\d{4})\)/);
  if (titleYearMatch) {
    releaseYear = titleYearMatch[1];
  } else {
    const leadYearMatch = leadText.match(/\b(19\d{2}|20\d{2})\b/);
    if (leadYearMatch) {
      releaseYear = leadYearMatch[1];
    }
  }

  const imageSuggestions = images.map((img, index) => {
    let namePart = '';
    let isPoster = false;
    
    // Simple classification: first image in a movie article is usually the poster
    if (isMoviePattern && index === 0) {
      isPoster = true;
      namePart = `${movieTitle} (${releaseYear || 'UnknownYear'}) Theatrical Release Poster`;
    } else {
      // Derive a short name from caption
      let captionClean = img.caption
        .replace(/[^a-zA-Z0-9\s-_]/g, '')
        .trim();
        
      if (captionClean.length > 50) {
        captionClean = captionClean.slice(0, 50).trim();
      }
      
      namePart = captionClean || `${title} Image ${index + 1}`;
    }
    
    // Sanitize suggestedName
    const suggestedName = `${vaultDate} ${namePart}`
      .replace(/[\\/*?:"<>|\[\]]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
      
    return {
      originalUrl: img.originalUrl,
      suggestedName,
      isPoster
    };
  });

  return {
    isMovie: isMoviePattern,
    movieTitle,
    releaseYear,
    briefDescription: leadText.slice(0, 150).trim() + '...',
    imageSuggestions
  };
}

module.exports = {
  analyzeMetadataAndImages
};
