// src/fallback.js
// Programmatic film detection + image naming heuristics. Runs when no
// Gemini API key exists or the API call fails. Pure logic, no
// dependencies — shared by the server (src/gemini.js) and the Obsidian
// plugin bundle (plugin/).

/**
 * Make a string safe as a single vault filename (no extension): strips path
 * separators and the characters Obsidian links or Windows reject, collapses
 * whitespace, refuses leading dots (no hidden files, no `..`), caps length.
 * Applied to every suggested name — Gemini's and the user's alike — because
 * that name becomes a path inside the vault.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+/, '')
    .replace(/[\s.-]+$/, '')
    .slice(0, 120)
    .trim();
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
      // Derive a short name from the caption: first sentence, letters in any
      // script kept (so "divinités" survives), cut at a word boundary.
      let captionClean = img.caption
        .split(/(?<=[.!?])\s/)[0]
        .replace(/[^\p{L}\p{N}\s'&,()-]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (captionClean.length > 60) {
        const cut = captionClean.slice(0, 60);
        captionClean = cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60).replace(/[\s,&-]+$/, '');
      }

      namePart = captionClean || `${title} Image ${index + 1}`;
    }

    const suggestedName = sanitizeFileName(`${vaultDate} ${namePart}`);

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
  generateFallbackAnalysis,
  sanitizeFileName
};
