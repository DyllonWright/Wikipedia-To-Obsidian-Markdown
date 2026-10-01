// src/node-gemini.js
// Server-side (Node only — never bundled into the plugin) wiring for the
// shared Gemini caller: where keys come from, and a fetch transport.
//
// Keys, merged in this order, duplicates dropped:
//   1. ENV_KEY_RING_PATH — the fleet's shared ring file (~/.env-key-ring/keys.env),
//      commented spares included. Read only; this server never rewrites it.
//   2. GEMINI_API_KEYS   — several keys, comma- or newline-separated.
//   3. GEMINI_API_KEY    — one key.
// Rotation state lives in memory for the life of the process.

const fs = require('fs');
const { KeyRing, parseKeyList } = require('./keyring');
const gemini = require('./gemini');

// Load .env without the dotenv package (process.loadEnvFile: Node 20.12+)
try { process.loadEnvFile(); } catch { /* no .env file — Gemini falls back to heuristics */ }

let ring = null;

function loadRing() {
  if (ring) return ring;
  const sources = [];
  const ringPath = process.env.ENV_KEY_RING_PATH;
  if (ringPath) {
    try {
      sources.push(fs.readFileSync(ringPath, 'utf8'));
    } catch (e) {
      console.warn(`ENV_KEY_RING_PATH set, but the ring file could not be read (${e.code || e.message}).`);
    }
  }
  if (process.env.GEMINI_API_KEYS) sources.push(process.env.GEMINI_API_KEYS.replace(/,/g, '\n'));
  if (process.env.GEMINI_API_KEY) sources.push(process.env.GEMINI_API_KEY);

  const keys = [];
  for (const k of parseKeyList(sources.join('\n'))) {
    if (!keys.some((existing) => existing.key === k.key)) keys.push(k);
  }
  ring = new KeyRing(keys);
  if (keys.length === 0) {
    console.warn('No Gemini key found (GEMINI_API_KEY, GEMINI_API_KEYS or ENV_KEY_RING_PATH). Using offline heuristics.');
  } else {
    console.log(`Gemini key ring: ${keys.length} key(s) — ${keys.map((k) => k.fp).join(', ')}`);
  }
  return ring;
}

/** @type {import('./gemini').Transport} */
async function fetchTransport({ url, method, headers, body, timeoutMs }) {
  try {
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: e && e.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : String(e && e.message) };
  }
}

/**
 * Same signature the server always used; returns the bare analysis.
 */
async function analyzeMetadataAndImages(title, leadText, infoboxText, images, vaultDate) {
  const { analysis, source, note } = await gemini.analyzeMetadataAndImages({
    title,
    leadText,
    infoboxText,
    images,
    vaultDate,
    ring: loadRing(),
    transport: fetchTransport
  });
  console.log(`Film detection + image names: ${source} (${note})`);
  return analysis;
}

module.exports = {
  analyzeMetadataAndImages,
  fetchTransport
};
