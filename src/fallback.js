// src/fallback.js
// Programmatic film detection + image naming heuristics. Runs when no
// Gemini API key exists or the API call fails. Pure logic, no
// dependencies — shared by the server (src/gemini.js) and the Obsidian
// plugin bundle (plugin/).

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
  generateFallbackAnalysis
};
