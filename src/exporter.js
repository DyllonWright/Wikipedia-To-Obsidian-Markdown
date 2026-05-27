// src/exporter.js
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

/**
 * Resolves a Wikipedia thumbnail URL to its high-resolution original image URL.
 * E.g. converts /thumb/ paths and strips trailing dimension segments.
 * @param {string} url The thumbnail URL
 * @returns {string} The original high-resolution URL
 */
function getHighResUrl(url) {
  if (!url) return '';
  
  // Normalise wikipedia url format
  if (url.includes('/thumb/')) {
    const parts = url.split('/');
    const thumbIndex = parts.indexOf('thumb');
    if (thumbIndex !== -1) {
      // Remove the '/thumb' segment
      parts.splice(thumbIndex, 1);
      
      // Look at the last segment. If it represents thumbnail size (e.g., '220px-Filename.jpg'),
      // we remove it to get the original file path.
      const lastPart = parts[parts.length - 1];
      if (lastPart.match(/^\d+px-/) || (lastPart.toLowerCase().endsWith('.png') && parts[parts.length - 2].toLowerCase().endsWith('.svg'))) {
        parts.pop();
      }
      return parts.join('/');
    }
  }
  return url;
}

/**
 * Downloads a file from a URL and returns its binary buffer and resolved extension.
 * @param {string} url Source URL
 * @returns {Promise<{buffer: Buffer, ext: string}>}
 */
async function downloadImage(url) {
  const highResUrl = getHighResUrl(url);
  const urlsToTry = [highResUrl, url]; // Try high-res first, fallback to original if 404
  
  let lastError = null;
  for (const targetUrl of urlsToTry) {
    try {
      const response = await axios.get(targetUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
        },
        timeout: 15000 // 15s timeout
      });
      
      const contentType = response.headers['content-type'] || '';
      let ext = '.jpg'; // default fallback
      
      if (contentType.includes('image/png')) ext = '.png';
      else if (contentType.includes('image/jpeg')) ext = '.jpg';
      else if (contentType.includes('image/webp')) ext = '.webp';
      else if (contentType.includes('image/gif')) ext = '.gif';
      else if (contentType.includes('image/svg+xml')) ext = '.svg';
      else {
        // Guess from URL path if header is generic
        const pathExt = path.extname(new URL(targetUrl).pathname);
        if (pathExt) ext = pathExt.toLowerCase();
      }
      
      return {
        buffer: Buffer.from(response.data),
        ext
      };
    } catch (error) {
      lastError = error;
      // Continue loop to try fallback URL
    }
  }
  
  throw new Error(`Failed to download image from ${url}. Last error: ${lastError ? lastError.message : 'Unknown'}`);
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
  const sanitizedBase = baseName.replace(/[\\/*?:"<>|]/g, '-').trim();
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
    linkMode = 'standard'
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
    const sanitizedTitle = title.replace(/[\\/*?:"<>|]/g, '-').trim();
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
      const { buffer, ext } = await downloadImage(img.originalUrl);
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
  const fileBasename = title.replace(/[\\/*?:"<>|]/g, '-').trim();
  const { filename: finalMdName, filePath: mdSavePath } = await getSafeFilePath(baseDir, fileBasename, '.md');
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
  downloadImage,
  getHighResUrl
};
