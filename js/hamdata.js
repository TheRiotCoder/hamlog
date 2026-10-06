/*
 * HamLog – band / mode tables and pure helper functions.
 * No DOM access: works in the browser (window.HamData) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HamData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ADIF Band enumeration (MHz), 160m .. 70cm
  const BANDS = [
    { band: '160m', lo: 1.8, hi: 2.0 },
    { band: '80m', lo: 3.5, hi: 4.0 },
    { band: '60m', lo: 5.06, hi: 5.45 },
    { band: '40m', lo: 7.0, hi: 7.3 },
    { band: '30m', lo: 10.1, hi: 10.15 },
    { band: '20m', lo: 14.0, hi: 14.35 },
    { band: '17m', lo: 18.068, hi: 18.168 },
    { band: '15m', lo: 21.0, hi: 21.45 },
    { band: '12m', lo: 24.89, hi: 24.99 },
    { band: '10m', lo: 28.0, hi: 29.7 },
    { band: '6m', lo: 50, hi: 54 },
    { band: '4m', lo: 70, hi: 71 },
    { band: '2m', lo: 144, hi: 148 },
    { band: '1.25m', lo: 222, hi: 225 },
    { band: '70cm', lo: 420, hi: 450 }
  ];

  // UI mode choices -> ADIF MODE + SUBMODE (ADIF 3.1.x mode/submode enumeration)
  const MODES = [
    { key: 'SSB', label: 'SSB', mode: 'SSB', submode: '', rst: '59', group: 'Phone' },
    { key: 'USB', label: 'SSB – USB', mode: 'SSB', submode: 'USB', rst: '59', group: 'Phone' },
    { key: 'LSB', label: 'SSB – LSB', mode: 'SSB', submode: 'LSB', rst: '59', group: 'Phone' },
    { key: 'FM', label: 'FM', mode: 'FM', submode: '', rst: '59', group: 'Phone' },
    { key: 'AM', label: 'AM', mode: 'AM', submode: '', rst: '59', group: 'Phone' },
    { key: 'DMR', label: 'DMR', mode: 'DIGITALVOICE', submode: 'DMR', rst: '59', group: 'Phone' },
    { key: 'DSTAR', label: 'D-STAR', mode: 'DIGITALVOICE', submode: 'DSTAR', rst: '59', group: 'Phone' },
    { key: 'C4FM', label: 'C4FM (Fusion)', mode: 'DIGITALVOICE', submode: 'C4FM', rst: '59', group: 'Phone' },
    { key: 'CW', label: 'CW', mode: 'CW', submode: '', rst: '599', group: 'CW' },
    { key: 'FT8', label: 'FT8', mode: 'FT8', submode: '', rst: '-10', group: 'Digital' },
    { key: 'FT4', label: 'FT4', mode: 'MFSK', submode: 'FT4', rst: '-10', group: 'Digital' },
    { key: 'JS8', label: 'JS8', mode: 'MFSK', submode: 'JS8', rst: '-10', group: 'Digital' },
    { key: 'Q65', label: 'Q65', mode: 'MFSK', submode: 'Q65', rst: '-10', group: 'Digital' },
    { key: 'FST4', label: 'FST4', mode: 'MFSK', submode: 'FST4', rst: '-10', group: 'Digital' },
    { key: 'JT65', label: 'JT65', mode: 'JT65', submode: '', rst: '-10', group: 'Digital' },
    { key: 'JT9', label: 'JT9', mode: 'JT9', submode: '', rst: '-10', group: 'Digital' },
    { key: 'MSK144', label: 'MSK144', mode: 'MSK144', submode: '', rst: '-10', group: 'Digital' },
    { key: 'RTTY', label: 'RTTY', mode: 'RTTY', submode: '', rst: '599', group: 'Digital' },
    { key: 'PSK31', label: 'PSK31', mode: 'PSK', submode: 'PSK31', rst: '599', group: 'Digital' },
    { key: 'PSK63', label: 'PSK63', mode: 'PSK', submode: 'PSK63', rst: '599', group: 'Digital' },
    { key: 'OLIVIA', label: 'Olivia', mode: 'OLIVIA', submode: '', rst: '599', group: 'Digital' },
    { key: 'SSTV', label: 'SSTV', mode: 'SSTV', submode: '', rst: '59', group: 'Digital' }
  ];

  // Old/non-standard MODE values that ADIF 3.x treats as SUBMODES (import-only mapping)
  const LEGACY_MODE_MAP = {
    USB: ['SSB', 'USB'], LSB: ['SSB', 'LSB'],
    FT4: ['MFSK', 'FT4'], JS8: ['MFSK', 'JS8'], Q65: ['MFSK', 'Q65'], FST4: ['MFSK', 'FST4'],
    PSK31: ['PSK', 'PSK31'], PSK63: ['PSK', 'PSK63'], BPSK31: ['PSK', 'PSK31'], BPSK63: ['PSK', 'PSK63'],
    DSTAR: ['DIGITALVOICE', 'DSTAR'], DMR: ['DIGITALVOICE', 'DMR'], C4FM: ['DIGITALVOICE', 'C4FM']
  };

  const CW_LIKE = ['CW', 'RTTY', 'PSK', 'OLIVIA', 'HELL', 'CONTESTI', 'DOMINO', 'MT63', 'THOR', 'THRB', 'MFSK16'];
  const WSJT_LIKE = ['FT8', 'JT65', 'JT9', 'JT4', 'MSK144', 'ISCAT', 'FT4', 'JS8', 'Q65', 'FST4', 'FST4W', 'WSPR', 'JTMS', 'MFSK'];

  function pad(n, w) { return String(n).padStart(w || 2, '0'); }

  /* ---------- frequency / band ---------- */
  function bandFromFreq(mhz) {
    const f = typeof mhz === 'number' ? mhz : parseFloat(mhz);
    if (!isFinite(f)) return '';
    for (const b of BANDS) if (f >= b.lo && f <= b.hi) return b.band;
    return '';
  }
  function bandInfo(band) { return BANDS.find(b => b.band === String(band || '').toLowerCase()) || null; }
  function freqInBand(mhz, band) {
    const b = bandInfo(band);
    return !!b && mhz >= b.lo && mhz <= b.hi;
  }
  function formatFreq(mhz) {
    // up to 6 decimals (1 Hz), strip trailing zeros
    let s = Number(mhz).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  /**
   * Parse a user-typed frequency. Accepts "14.074", "14,074" (decimal comma)
   * or kHz like "14074" (auto-converted when the kHz value lands in a ham band).
   */
  function parseFreq(input) {
    const raw = String(input == null ? '' : input).trim().replace(/\s+/g, '').replace(/mhz$/i, '');
    if (!raw) return { mhz: null, text: '', fromKhz: false };
    const norm = raw.replace(',', '.');
    if (!/^\d*\.?\d+$|^\d+\.$/.test(norm)) return { mhz: null, text: raw, fromKhz: false };
    let mhz = parseFloat(norm);
    if (!isFinite(mhz) || mhz <= 0) return { mhz: null, text: raw, fromKhz: false };
    let fromKhz = false;
    if (!bandFromFreq(mhz) && mhz >= 1000 && bandFromFreq(mhz / 1000)) { mhz = mhz / 1000; fromKhz = true; }
    return { mhz, text: formatFreq(mhz), fromKhz };
  }

  /* ---------- modes ---------- */
  function modeByKey(key) { return MODES.find(m => m.key === key) || null; }
  function normalizeModePair(mode, submode) {
    let m = String(mode || '').trim().toUpperCase();
    let s = String(submode || '').trim().toUpperCase();
    if (LEGACY_MODE_MAP[m]) { const [mm, ss] = LEGACY_MODE_MAP[m]; m = mm; s = s || ss; }
    return { mode: m, submode: s };
  }
  function modeKeyFor(mode, submode) {
    const p = normalizeModePair(mode, submode);
    const hit = MODES.find(o => o.mode === p.mode && o.submode === p.submode);
    return hit ? hit.key : null;
  }
  function modeLabel(mode, submode) {
    const k = modeKeyFor(mode, submode);
    if (k) return modeByKey(k).label;
    return String(submode || mode || '').toUpperCase();
  }
  function defaultRst(mode, submode) {
    const p = normalizeModePair(mode, submode);
    const k = modeKeyFor(p.mode, p.submode);
    if (k) return modeByKey(k).rst;
    if (CW_LIKE.indexOf(p.mode) >= 0) return '599';
    if (WSJT_LIKE.indexOf(p.mode) >= 0 || WSJT_LIKE.indexOf(p.submode) >= 0) return '-10';
    return '59';
  }
  /** Mode identity used for dupe checks: SSB/USB/LSB are all "SSB"; otherwise submode wins. */
  function dupeMode(q) {
    const p = normalizeModePair(q.mode, q.submode);
    if (p.mode === 'SSB') return 'SSB';
    return p.submode || p.mode;
  }

  /* ---------- callsign / grid ---------- */
  function normalizeCall(s) { return String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9/]/g, ''); }
  function isValidCall(s) {
    const c = normalizeCall(s);
    return c.length >= 3 && c.length <= 20 && /^[A-Z0-9]+(\/[A-Z0-9]+)*$/.test(c) && /\d/.test(c) && /[A-Z]/.test(c);
  }
  function normalizeGrid(s) {
    const g = String(s || '').replace(/\s+/g, '');
    if (!g) return '';
    let out = g.slice(0, 2).toUpperCase() + g.slice(2, 4);
    if (g.length > 4) out += g.slice(4, 6).toLowerCase();
    if (g.length > 6) out += g.slice(6, 8);
    return out;
  }
  function isValidGrid(s) { return /^[A-R]{2}(\d{2}([A-X]{2}(\d{2})?)?)?$/i.test(String(s || '')); }

  /* ---------- UTC date/time ---------- */
  function nowUtcParts(d) {
    d = d || new Date();
    return {
      date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
      time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
    };
  }
  function dateInputToAdif(s) {
    const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(s || '').trim());
    return m ? m[1] + m[2] + m[3] : '';
  }
  function adifToDateInput(s) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || ''));
    return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
  }
  function timeInputToAdif(s) {
    const t = String(s || '').trim();
    let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(t);
    if (m) return pad(m[1]) + m[2] + (m[3] || '00');
    m = /^(\d{2})(\d{2})(\d{2})?$/.exec(t);
    if (m) return m[1] + m[2] + (m[3] || '00');
    return '';
  }
  function adifToTimeInput(s) {
    const t = String(s || '');
    if (/^\d{6}$/.test(t)) return t.slice(0, 2) + ':' + t.slice(2, 4) + ':' + t.slice(4, 6);
    if (/^\d{4}$/.test(t)) return t.slice(0, 2) + ':' + t.slice(2, 4) + ':00';
    return '';
  }
  function isValidAdifDate(s) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1930 || mo < 1 || mo > 12 || d < 1) return false;
    const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return d <= dim;
  }
  function isValidAdifTime(s) {
    const m = /^(\d{2})(\d{2})(\d{2})?$/.exec(String(s || ''));
    return !!m && +m[1] < 24 && +m[2] < 60 && (m[3] === undefined || +m[3] < 60);
  }

  /* ---------- duplicates / merge ---------- */
  function dupeKey(q) {
    return [normalizeCall(q.call), String(q.band || '').toLowerCase(), dupeMode(q), q.qso_date].join('|');
  }
  /** QSOs with same call + band + mode on the same UTC day. */
  function findDupes(qsos, cand, excludeId) {
    if (!cand.call || !cand.band || !cand.qso_date) return [];
    const k = dupeKey(cand);
    return qsos.filter(q => q.id !== excludeId && dupeKey(q) === k);
  }
  /** Key used to skip exact repeats when importing/merging (minute resolution). */
  function mergeKey(q) {
    return [normalizeCall(q.call), q.qso_date, String(q.time_on || '').slice(0, 4), String(q.band || '').toLowerCase(), dupeMode(q)].join('|');
  }
  function sortKey(q) { return String(q.qso_date || '') + String(q.time_on || '').padEnd(6, '0'); }

  return {
    BANDS, MODES, LEGACY_MODE_MAP,
    bandFromFreq, bandInfo, freqInBand, formatFreq, parseFreq,
    modeByKey, normalizeModePair, modeKeyFor, modeLabel, defaultRst, dupeMode,
    normalizeCall, isValidCall, normalizeGrid, isValidGrid,
    nowUtcParts, dateInputToAdif, adifToDateInput, timeInputToAdif, adifToTimeInput,
    isValidAdifDate, isValidAdifTime,
    dupeKey, findDupes, mergeKey, sortKey
  };
});
