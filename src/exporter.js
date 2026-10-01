// src/exporter.js
const fs = require('fs').promises;
const path = require('path');
const { WIKIMEDIA_USER_AGENT, IMAGE_ACCEPT, downloadCandidates, sniffImageType } = require('./images');
const { sanitizeFileName } = require('./fallback');

/**
 * Downloads one image, trying candidate URLs best-first (see src/images.js)
 * and keeping the first response whose BYTES are an image. Wikimedia serves
 * HTML redirect and error pages with status 200, so neither the status nor
 * the Content-Type header gets trusted. The extension comes from the bytes.
 * @param {string} url Image URL as found on the page
 * @param {object} [opts] { fileWidth, svgMode } — svgMode 'png' or 'jpg' saves
 *        Wikimedia's PNG rendering of an SVG (no canvas in Node, so 'jpg'
 *        also lands as PNG here); 'svg' keeps the vector original.
 * @returns {Promise<{buffer: Buffer, ext: string}>}
 */
async function downloadImage(url, opts = {}) {
  const svgMode = opts.svgMode === 'svg' ? 'svg' : 'png';
  const tried = [];
  for (const candidate of downloadCandidates(url, { fileWidth: opts.fileWidth, svgMode })) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(candidate, {
          headers: { 'User-Agent': WIKIMEDIA_USER_AGENT, Accept: IMAGE_ACCEPT },
          signal: AbortSignal.timeout(20000)
        });
        if (response.status === 429 && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        if (!response.ok) {
          tried.push(`HTTP ${response.status}`);
          break;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const kind = sniffImageType(buffer);
        if (!kind) {
          tried.push('not an image');
          break;
        }
        return { buffer, ext: `.${kind.ext}` };
      } catch (error) {
        tried.push(error.name === 'TimeoutError' ? 'timeout' : error.message);
        break;
      }
    }
  }
  throw new Error(`Failed to download image from ${url} (${tried.join(', ') || 'no candidates'})`);
}

/**
 * Formats a link to an image according to Obsidian preferences.
 * @param {string} filename Clean image filename with extension
 * @param {string} attachmentFolder Attachments subfolder name (e.g. "Attachments")
 * @param {string} linkMode Link style ('standard', 'wikilink')
 * @returns {string} Markdown image link
 */
function formatImageLink(filename, attachmentFolder, linkMode = 'standard') {
  if (linkMode === 'wikilink') {
    // Obsidian style: ![[filename]]
    // (Obsidian resolves files automatically anywhere in the vault, but we can just use the name)
    return `![[${filename}]]`;
  } else {
    // Standard markdown: ![alt](path)
    const relativePath = attachmentFolder ? `${attachmentFolder}/${encodeURIComponent(filename)}` : encodeURIComponent(filename);
    return `![${filename}](${relativePath})`;
  }
}

/**
 * Resolves a safe file path by checking if the file already exists,
 * appending incremented suffixes (e.g. " (1)", " (2)") if a conflict is found.
 * @param {string} dir Target directory
 * @param {string} baseName File title (no extension)
 * @param {string} ext Extension (including dot, e.g. ".md" or ".jpg")
 * @returns {Promise<{filename: string, filePath: string}>}
 */
async function getSafeFilePath(dir, baseName, ext) {
  // sanitizeFileName strips separators and leading dots, so a name like
  // "../../x" cannot climb out of the target folder.
  const sanitizedBase = sanitizeFileName(baseName) || 'untitled';
  let attempt = 0;
  let filename = `${sanitizedBase}${ext}`;
  let filePath = path.join(dir, filename);
  
  while (true) {
    try {
      await fs.access(filePath);
      // File exists, increment attempt suffix
      attempt++;
      filename = `${sanitizedBase} (${attempt})${ext}`;
      filePath = path.join(dir, filename);
    } catch (e) {
      // File does not exist, safe to write!
      break;
    }
  }
  return { filename, filePath };
}

/**
 * Exports the generated markdown and images to the local output folder or directly to an Obsidian Vault.
 * @param {object} payload Export payload:
 *        - title: Article title
 *        - markdown: Final markdown text
 *        - images: Array of { originalUrl, finalName }
 *        - saveToVault: boolean
 *        - vaultPath: absolute path to vault
 *        - attachmentsFolder: name of attachments folder (default "Attachments")
 *        - linkMode: standard, wikilink
 * @returns {Promise<object>} Status report
 */
async function exportArticle(payload) {
  const {
    title,
    markdown,
    images = [],
    saveToVault = false,
    vaultPath = '',
    attachmentsFolder = 'Attachments',
    linkMode = 'standard',
    svgMode = 'png'
  } = payload;
  
  // 1. Establish Directories
  let baseDir = '';
  let attachDir = '';
  
  if (saveToVault) {
    if (!vaultPath) {
      throw new Error('Vault Path is required when Save to Vault is checked.');
    }
    // Verify directory exists
    try {
      await fs.access(vaultPath);
    } catch (e) {
      throw new Error(`The vault path does not exist: ${vaultPath}`);
    }
    
    baseDir = vaultPath;
    attachDir = attachmentsFolder ? path.join(vaultPath, attachmentsFolder) : vaultPath;
  } else {
    // Standalone mode: save in local project's "output/[article-title]" directory
    const sanitizedTitle = sanitizeFileName(title) || 'untitled';
    baseDir = path.join(__dirname, '..', 'output', sanitizedTitle);
    attachDir = path.join(baseDir, attachmentsFolder || 'attachments');
  }
  
  await fs.mkdir(baseDir, { recursive: true });
  if (attachDir !== baseDir) {
    await fs.mkdir(attachDir, { recursive: true });
  }
  
  // 2. Download Images and Map Extensions
  const finalImageMap = {}; // originalUrl -> finalFilenameWithExt
  const errors = [];
  
  console.log(`Downloading ${images.length} images...`);
  for (const img of images) {
    try {
      const { buffer, ext } = await downloadImage(img.originalUrl, { fileWidth: img.fileWidth, svgMode });
      const { filename, filePath } = await getSafeFilePath(attachDir, img.finalName, ext);
      
      await fs.writeFile(filePath, buffer);
      finalImageMap[img.originalUrl] = filename;
    } catch (e) {
      console.error(`Failed to download ${img.originalUrl}:`, e.message);
      errors.push({ url: img.originalUrl, error: e.message });
    }
  }
  
  // 3. Assemble and adjust Markdown text
  // Replace the image placeholders in markdown with actual image links
  let finalMarkdown = markdown;
  
  // Replace references
  for (const [url, filename] of Object.entries(finalImageMap)) {
    const placeholder = `{{IMAGE:${url}}}`;
    const imgLink = formatImageLink(filename, saveToVault ? attachmentsFolder : (attachmentsFolder || 'attachments'), linkMode);
    
    // Replace all occurrences of this placeholder
    finalMarkdown = finalMarkdown.split(placeholder).join(imgLink);
  }
  
  // Clean up any unmatched image placeholders (e.g. ones that failed to download)
  // We replace them with their captions or a failed comment
  const placeholderRegex = /\{\{IMAGE:([^}]+)\}\}/g;
  let match;
  while ((match = placeholderRegex.exec(finalMarkdown)) !== null) {
    const failedUrl = match[1];
    const imgData = images.find(i => i.originalUrl === failedUrl);
    const fallbackText = imgData ? `*Image: ${imgData.caption || 'Missing Image'}*` : '*Image Missing*';
    finalMarkdown = finalMarkdown.split(match[0]).join(`\n${fallbackText}\n`);
  }
  
  // 4. Save Markdown File
  const { filePath: mdSavePath } = await getSafeFilePath(baseDir, title, '.md');
  await fs.writeFile(mdSavePath, finalMarkdown, 'utf8');
  
  return {
    success: true,
    markdownPath: mdSavePath,
    attachmentsPath: attachDir,
    imagesDownloaded: Object.keys(finalImageMap).length,
    imagesFailed: errors.length,
    errors
  };
}

module.exports = {
  exportArticle,
  downloadImage
};
