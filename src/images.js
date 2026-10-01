// src/images.js
// Wikimedia image URL handling + downloaded-byte sniffing. Pure logic, no
// I/O and no Node built-ins — shared by the server exporter and the
// Obsidian plugin bundle (plugin/), so it runs on mobile too.
//
// Why this module exists (2026-10-01): Wikipedia started serving thumbnails
// from `thumb.wikimedia.org` with `?utm_…` query strings, and Wikimedia now
// rejects thumbnail widths outside a fixed list. The old "high-res" rewrite
// stripped `/thumb/` but kept the thumb host, which answers with a 301 to
// the Commons Main Page — HTML, saved to disk under a `.jpg` name that no
// viewer could open. Every download now gets checked by its bytes, never by
// its URL or its Content-Type header.

/**
 * Widths Wikimedia production accepts for direct thumbnail requests. Any
 * other width answers 400 ("Use thumbnail sizes listed on
 * https://w.wiki/GHai"). Source: mediawiki.org/wiki/Common_thumbnail_sizes.
 */
const STANDARD_WIDTHS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];

/** Width requested when rasterizing an SVG (vector art scales freely). */
const SVG_RASTER_WIDTH = 1280;

/** Largest width ever requested for a bitmap thumbnail. */
const MAX_BITMAP_WIDTH = 1920;

/** Original-file extensions Obsidian (and phone galleries) render as-is. */
const RENDERABLE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

/**
 * A polite, identifying User-Agent, per the Wikimedia User-Agent policy.
 * Generic or missing agents draw 403/429 from upload.wikimedia.org. No
 * personal data goes in here.
 */
const WIKIMEDIA_USER_AGENT =
  'AdvancedWikipediaImporter/2.4 (https://github.com/DyllonWright/wikipedia-to-obsidian-markdown)';

/**
 * Accept header for image downloads. Wikimedia negotiates the format, and
 * a browser engine that advertises WebP (Obsidian's does) gets WebP back
 * for rasterized SVGs — a format many phone galleries handle badly.
 */
const IMAGE_ACCEPT = 'image/png,image/jpeg;q=0.9,image/gif;q=0.8,image/svg+xml;q=0.7,image/*;q=0.5';

const WIKIMEDIA_HOSTS =/^(upload|thumb)\.wikimedia\.org$/i;

/**
 * Canonical form of an image URL: absolute https, no query or hash, and
 * Wikimedia thumbnails moved from `thumb.wikimedia.org` back to
 * `upload.wikimedia.org` (the host that serves both thumbs and originals).
 * Two renderings of one file at different widths stay distinct here; use
 * `originalFileUrl` for identity.
 * @param {string} url
 * @returns {string}
 */
function normalizeImageUrl(url) {
  if (!url) return '';
  let u;
  try {
    u = new URL(url.startsWith('//') ? `https:${url}` : url);
  } catch (e) {
    return url;
  }
  u.search = '';
  u.hash = '';
  if (WIKIMEDIA_HOSTS.test(u.hostname)) {
    u.hostname = 'upload.wikimedia.org';
    u.protocol = 'https:';
  }
  return u.toString();
}

/**
 * Split a Wikimedia upload URL into its parts.
 *   thumb:    /wikipedia/commons/thumb/e/e3/Name.jpg/330px-Name.jpg
 *   original: /wikipedia/commons/e/e3/Name.jpg
 * @param {string} url
 * @returns {null | {origin: string, project: string, hashPath: string,
 *   fileName: string, ext: string, isThumb: boolean, thumbName: string}}
 */
function parseWikimediaUrl(url) {
  const normalized = normalizeImageUrl(url);
  let u;
  try {
    u = new URL(normalized);
  } catch (e) {
    return null;
  }
  if (!WIKIMEDIA_HOSTS.test(u.hostname)) return null;

  const thumb = u.pathname.match(/^\/([^/]+\/[^/]+)\/thumb\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)\/([^/]+)$/i);
  if (thumb) {
    const fileName = thumb[3];
    return {
      origin: u.origin,
      project: thumb[1],
      hashPath: thumb[2],
      fileName,
      ext: extensionOf(fileName),
      isThumb: true,
      thumbName: thumb[4]
    };
  }
  const orig = u.pathname.match(/^\/([^/]+\/[^/]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/i);
  if (orig) {
    const fileName = orig[3];
    return {
      origin: u.origin,
      project: orig[1],
      hashPath: orig[2],
      fileName,
      ext: extensionOf(fileName),
      isThumb: false,
      thumbName: ''
    };
  }
  return null;
}

function extensionOf(fileName) {
  let decoded = fileName;
  try {
    decoded = decodeURIComponent(fileName);
  } catch (e) { /* keep raw */ }
  const dot = decoded.lastIndexOf('.');
  return dot === -1 ? '' : decoded.slice(dot + 1).toLowerCase();
}

/**
 * The URL of the original upload behind any Wikimedia rendering of it —
 * a stable identity for de-duplicating one file shown at two widths.
 * Non-Wikimedia URLs come back normalized but otherwise untouched.
 * @param {string} url
 * @returns {string}
 */
function originalFileUrl(url) {
  const p = parseWikimediaUrl(url);
  if (!p) return normalizeImageUrl(url);
  return `${p.origin}/${p.project}/${p.hashPath}/${p.fileName}`;
}

/** Largest standard width at or below `limit` (never below 120). */
function standardWidthAtMost(limit) {
  let best = 120;
  for (const w of STANDARD_WIDTHS) {
    if (w <= limit && w > best) best = w;
  }
  return best;
}

/**
 * Rewrite a Wikimedia thumbnail URL to another (standard) width, keeping
 * any rendering prefix such as `lossy-page1-` and any rendered suffix such
 * as `.svg.png`.
 */
function thumbAtWidth(p, width) {
  if (!p.isThumb) {
    // Build a thumb path from an original; SVG renders as PNG, the rest keep
    // their own format.
    const suffix = p.ext === 'svg' ? '.png' : '';
    return `${p.origin}/${p.project}/thumb/${p.hashPath}/${p.fileName}/${width}px-${p.fileName}${suffix}`;
  }
  const renamed = p.thumbName.replace(/(^|-)\d+px-/, `$1${width}px-`);
  return `${p.origin}/${p.project}/thumb/${p.hashPath}/${p.fileName}/${renamed}`;
}

/**
 * Ordered download candidates for one image. The caller tries each in turn
 * and keeps the first response whose BYTES sniff as a real image.
 *
 * @param {string} url Image URL as found on the page (thumb or original)
 * @param {object} [opts]
 * @param {number} [opts.fileWidth] Original pixel width (data-file-width), if known
 * @param {'png'|'jpg'|'svg'} [opts.svgMode] What to do with SVG originals:
 *        'png'/'jpg' fetch Wikimedia's PNG rasterization (the caller converts
 *        PNG→JPG itself where it can); 'svg' keeps the vector original.
 * @returns {string[]}
 */
function downloadCandidates(url, opts = {}) {
  const svgMode = opts.svgMode || 'png';
  const pageUrl = normalizeImageUrl(url);
  const p = parseWikimediaUrl(url);
  const out = [];
  const push = (u) => { if (u && !out.includes(u)) out.push(u); };

  if (!p) {
    push(pageUrl);
    return out;
  }

  const original = `${p.origin}/${p.project}/${p.hashPath}/${p.fileName}`;

  if (p.ext === 'svg') {
    if (svgMode === 'svg') push(original);
    // Wikimedia rasterizes SVG to PNG at any standard width.
    push(thumbAtWidth(p, SVG_RASTER_WIDTH));
    push(thumbAtWidth(p, 960));
    if (p.isThumb) push(pageUrl);
    if (svgMode !== 'svg') push(original); // last resort: vector beats nothing
    return out;
  }

  if (RENDERABLE_EXTENSIONS.includes(p.ext)) {
    push(original);
    if (p.isThumb) {
      const limit = Math.min(opts.fileWidth || MAX_BITMAP_WIDTH, MAX_BITMAP_WIDTH);
      push(thumbAtWidth(p, standardWidthAtMost(limit)));
      push(pageUrl);
    }
    return out;
  }

  // TIFF, PDF, DjVu, XCF, video posters…: the original won't render in
  // Obsidian, so only ever take Wikimedia's JPEG/PNG rendering of it.
  if (p.isThumb) {
    const limit = Math.min(opts.fileWidth || 1280, MAX_BITMAP_WIDTH);
    push(thumbAtWidth(p, standardWidthAtMost(limit)));
    push(pageUrl);
  }
  return out;
}

/**
 * Identify image bytes by their magic numbers. Returns null for anything
 * else — notably the HTML error and redirect pages that Wikimedia serves
 * with a 200 status.
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {null | {ext: string, mime: string}}
 */
function sniffImageType(data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (b.length < 12) return null;
  const ascii = (start, len) => String.fromCharCode(...b.subarray(start, start + len));

  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (ascii(0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (ascii(4, 4) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 4))) return { ext: 'avif', mime: 'image/avif' };
  if (b[0] === 0x42 && b[1] === 0x4d) return { ext: 'bmp', mime: 'image/bmp' };

  // SVG: text that opens with an XML prolog, a comment, a doctype or <svg,
  // and mentions <svg early on. HTML pages fail the <svg test.
  const head = ascii(0, Math.min(b.length, 1024)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml|<!--|<!DOCTYPE svg|<svg)/i.test(head) && /<svg[\s>]/i.test(head)) {
    return { ext: 'svg', mime: 'image/svg+xml' };
  }
  return null;
}

module.exports = {
  STANDARD_WIDTHS,
  WIKIMEDIA_USER_AGENT,
  IMAGE_ACCEPT,
  normalizeImageUrl,
  parseWikimediaUrl,
  originalFileUrl,
  downloadCandidates,
  sniffImageType
};
