// src/imagelink.js
// Image embeds for the note body. Shared by the plugin and the server.

/**
 * Encodes a vault path for a markdown link destination.
 *
 * Obsidian decodes internal link paths with decodeURI, which leaves the
 * escapes %2C %3B %40 %26 %3D %2B %24 untouched. encodeURIComponent writes
 * exactly those escapes for , ; @ & = + $, so a name such as
 * "Brooch, from the necropolis.jpg" pointed at a file that never existed
 * (issue #1, 2026-11-13). Only the characters that break the markdown
 * destination itself get escaped here; everything else stays literal.
 * @param {string} vaultPath Path with "/" separators
 * @returns {string}
 */
function encodeLinkPath(vaultPath) {
  return String(vaultPath || '')
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * Picks the embed style for images.
 * @param {string} imageLinkMode 'auto' | 'wikilink' | 'markdown'
 * @param {string} linkMode Article link mode; 'auto' follows it
 * @returns {'wikilink' | 'markdown'}
 */
function resolveImageStyle(imageLinkMode, linkMode) {
  if (imageLinkMode === 'wikilink' || imageLinkMode === 'markdown') return imageLinkMode;
  return linkMode === 'wikilink' ? 'wikilink' : 'markdown';
}

/**
 * Formats one image embed.
 * @param {string} filename Image filename with extension
 * @param {string} folder Attachments folder as a vault path ('' for the root)
 * @param {string} style 'wikilink' or 'markdown'
 * @returns {string}
 */
function formatImageEmbed(filename, folder, style) {
  if (style === 'wikilink') return `![[${filename}]]`;
  const vaultPath = folder ? `${folder}/${filename}` : filename;
  return `![${filename}](${encodeLinkPath(vaultPath)})`;
}

module.exports = { encodeLinkPath, resolveImageStyle, formatImageEmbed };
