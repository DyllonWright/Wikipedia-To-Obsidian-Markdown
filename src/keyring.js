// src/keyring.js
// A small Gemini key ring: several keys, one active, rotate when one runs
// dry. Pure logic with no I/O and no Node built-ins, so the Obsidian plugin
// (desktop + mobile) and the local server share it.
//
// Rules ported from the fleet's reference ring
// (E-Reader-Screenshot-Transcriber/gui/lib/keyRing.js + ringLatch.js), minus
// the part that rewrites a `.env` file — here the caller persists the small
// state object this module hands back (the plugin keeps it in data.json):
//
//   * A 429 / RESOURCE_EXHAUSTED benches the key until the date rolls over
//     in Pacific time — Google resets free-tier quota at midnight Pacific.
//     Dated, not timed: no timer, and a long-running session recovers alone.
//   * Quota meters per Google PROJECT, not per key. Keys whose labels name
//     one account ("me@gmail.com", "me@gmail.com #2") go dry together.
//   * A revoked or invalid key (400 API_KEY_INVALID, 401, 403) gets benched
//     for good until the key list changes; retrying it never helps.
//   * Values never get printed. A key shows up as its label plus a short
//     fingerprint.

const KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/;

/**
 * FNV-1a 32-bit, as 8 hex digits: a short, stable handle for a key that
 * stays safe to show and to store. Not cryptographic, and need not be — it
 * only has to tell a handful of keys apart without revealing them.
 * @param {string} key
 * @returns {string}
 */
function fingerprint(key) {
  let h = 0x811c9dc5;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Read a pasted key list. Accepts, line by line:
 *   AIza…                         a bare key
 *   Personal: AIza…               a label, then the key
 *   # Personal                    a label for the key on the next line
 *   GEMINI_API_KEY=AIza…          a line pasted from a .env ring
 *   #GEMINI_API_KEY=AIza…         a commented spare from a .env ring
 * Duplicates drop out (first occurrence wins).
 * @param {string} text
 * @returns {Array<{key: string, label: string, fp: string}>}
 */
function parseKeyList(text) {
  const out = [];
  let pendingLabel = '';
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(KEY_PATTERN);
    if (!match) {
      if (line.startsWith('#')) pendingLabel = line.replace(/^#+\s*/, '').trim();
      continue;
    }
    const key = match[0];
    let label = line
      .slice(0, match.index)
      .replace(/^#+\s*/, '')
      .replace(/[A-Z_]*API_KEYS?\s*=\s*$/i, '')
      .replace(/[\s:=,-]+$/, '')
      .trim();
    if (!label) label = pendingLabel;
    pendingLabel = '';
    if (out.some((k) => k.key === key)) continue;
    out.push({ key, label, fp: fingerprint(key) });
  }
  return out;
}

/** "me@gmail.com #2" → "me"; "Personal" → "personal". Groups one project's keys. */
function accountOf(label) {
  const text = String(label || '').trim().toLowerCase();
  if (!text) return '';
  return text.replace(/\s*#\d+\s*$/, '').replace(/@.*$/, '').trim();
}

/** Today's date in Pacific time, "YYYY-MM-DD" — Gemini's quota day. */
function pacificDate(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch (e) {
    // No Intl time zone data: approximate Pacific as UTC-8.
    return new Date(now.getTime() - 8 * 3600 * 1000).toISOString().slice(0, 10);
  }
}

/**
 * Sort one failed call into what to do next.
 *   'quota' — this key (project) has no room today; try another key
 *   'dead'  — this key gets refused outright; bench it, try another key
 *   'model' — the model, not the key, failed (404 withdrawn, 5xx, timeout);
 *             another key won't help, another model might
 *   'other' — a bad request or an unparseable reply; stop
 * @param {number} status HTTP status, or 0 for a network error / timeout
 * @param {string} [message] Error body or message
 * @returns {'quota'|'dead'|'model'|'other'}
 */
function classifyFailure(status, message) {
  const text = String(message || '').toLowerCase();
  if (status === 429 || text.includes('resource_exhausted') || text.includes('quota')) return 'quota';
  if (status === 401 || status === 403) return 'dead';
  if (status === 400 && (text.includes('api_key_invalid') || text.includes('api key not valid') || text.includes('api key expired'))) return 'dead';
  if (status === 0 || status === 404 || status === 408 || status >= 500) return 'model';
  return 'other';
}

class KeyRing {
  /**
   * @param {Array<{key: string, label: string, fp: string}>} keys
   * @param {{active?: string, dry?: Object<string,string>, dead?: Object<string,boolean>}} [state]
   * @param {() => Date} [clock]
   */
  constructor(keys, state = {}, clock = () => new Date()) {
    this.keys = keys;
    this.clock = clock;
    this.active = state.active || '';
    this.dry = { ...(state.dry || {}) };
    this.dead = { ...(state.dead || {}) };
  }

  _isDry(fp) {
    return this.dry[fp] === pacificDate(this.clock());
  }

  /** Keys worth trying now, active key first, then in list order. */
  candidates() {
    const usable = this.keys.filter((k) => !this.dead[k.fp] && !this._isDry(k.fp));
    const i = usable.findIndex((k) => k.fp === this.active);
    return i > 0 ? usable.slice(i).concat(usable.slice(0, i)) : usable;
  }

  /** Remember the key that just answered, so the next call starts on it. */
  markGood(fp) {
    this.active = fp;
  }

  /** Bench a key, plus every key on the same account, until midnight Pacific. */
  markDry(fp) {
    const today = pacificDate(this.clock());
    const hit = this.keys.find((k) => k.fp === fp);
    const account = hit ? accountOf(hit.label) : '';
    for (const k of this.keys) {
      if (k.fp === fp || (account && accountOf(k.label) === account)) this.dry[k.fp] = today;
    }
  }

  markDead(fp) {
    this.dead[fp] = true;
  }

  /** State to persist; drops entries for removed keys and past days. */
  toState() {
    const live = new Set(this.keys.map((k) => k.fp));
    const today = pacificDate(this.clock());
    const dry = {};
    const dead = {};
    for (const [fp, day] of Object.entries(this.dry)) if (live.has(fp) && day === today) dry[fp] = day;
    for (const fp of Object.keys(this.dead)) if (live.has(fp)) dead[fp] = true;
    return { active: live.has(this.active) ? this.active : '', dry, dead };
  }

  /** Display-safe summary: labels and fingerprints, never key values. */
  describe() {
    return this.keys.map((k) => ({
      label: k.label || '(unlabelled)',
      fp: k.fp,
      status: this.dead[k.fp] ? 'refused' : this._isDry(k.fp) ? 'dry until midnight Pacific' : 'ready',
      active: k.fp === this.active
    }));
  }
}

module.exports = {
  fingerprint,
  parseKeyList,
  accountOf,
  pacificDate,
  classifyFailure,
  KeyRing
};
