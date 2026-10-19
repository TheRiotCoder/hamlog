/*
 * HamLog – contest + POTA/SOTA helpers (pure, no DOM). Browser: window.HamField. Node: require('./field.js').
 * Scoring here is an APPROXIMATE running estimate, not an official claimed score. See README for sources.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hamdata.js'));
  else root.HamField = factory(root.HamData);
})(typeof self !== 'undefined' ? self : this, function (H) {
  'use strict';

  /* ---------------- mode category ---------------- */
  /** 'CW' | 'PH' | 'DG' (Cabrillo-style category; RTTY reported as RY in Cabrillo). */
  function modeCat(q) {
    const p = H.normalizeModePair(q.mode, q.submode);
    if (p.mode === 'CW') return 'CW';
    if (['SSB', 'FM', 'AM', 'DIGITALVOICE'].indexOf(p.mode) >= 0) return 'PH';
    return 'DG';
  }
  function cabMode(q) {
    const p = H.normalizeModePair(q.mode, q.submode);
    if (p.mode === 'RTTY') return 'RY';
    if (p.mode === 'FM') return 'FM';
    return modeCat(q);
  }

  /* ---------------- contest presets ---------------- */
  const SEC = '[A-Z]{2,4}';
  const CONTESTS = {
    'ARRL-FD': {
      name: 'ARRL Field Day', adif: 'ARRL-FIELD-DAY', cab: () => 'ARRL-FD', serial: false,
      sentHint: '3A CT', rcvdHint: 'class section, e.g. 2A STX', rcvd: [/^\d{1,2}[A-F]$/, new RegExp('^' + SEC + '$')],
      dupe: 'band-mode', pts: q => (modeCat(q) === 'PH' ? 1 : 2), mult: null, multLabel: 'sections',
      multKey: q => tok(q.srx_string)[1], scoreNote: 'QSO points only (phone 1, CW/digital 2); power multiplier and bonus points not included.'
    },
    'WFD': {
      name: 'Winter Field Day', adif: 'WFD', cab: () => 'WFD', serial: false,
      sentHint: '1O LA', rcvdHint: 'category+class section, e.g. 2H EPA', rcvd: [/^\d{1,2}[HIOM]$/, new RegExp('^(' + SEC + ')$')],
      dupe: 'band-mode', pts: q => (modeCat(q) === 'PH' ? 1 : 2), mult: null, multLabel: 'sections',
      multKey: q => tok(q.srx_string)[1], scoreNote: 'QSO points only (phone 1, CW/digital 2); WFD objective multipliers not included.'
    },
    'ARRL-SS': {
      name: 'ARRL Sweepstakes', adif: q => (modeCat(q) === 'CW' ? 'ARRL-SS-CW' : 'ARRL-SS-SSB'),
      cab: m => (m === 'CW' ? 'ARRL-SS-CW' : 'ARRL-SS-SSB'), serial: true,
      sentHint: 'A 79 LA (precedence check section; serial is automatic)', rcvdHint: 'nr prec check section, e.g. 43 M 31 CT',
      rcvd: [/^[QABUMS]$/, /^\d{2}$/, new RegExp('^' + SEC + '$')],
      dupe: 'once', pts: () => 2, mult: true, multLabel: 'sections',
      multKey: q => tok(q.srx_string)[2], scoreNote: '2 points per QSO × ARRL/RAC sections worked.'
    },
    'CQ-WW': {
      name: 'CQ World Wide DX', adif: q => (modeCat(q) === 'CW' ? 'CQ-WW-CW' : 'CQ-WW-SSB'),
      cab: m => (m === 'CW' ? 'CQ-WW-CW' : 'CQ-WW-SSB'), serial: false,
      sentHint: '59 4 (RST + CQ zone)', rcvdHint: 'RST zone, e.g. 59 14', rcvd: [/^[1-5][1-9]9?$/, /^([1-9]|[1-3]\d|40)$/],
      dupe: 'band', pts: null, mult: true, multLabel: 'zones/band',
      multKey: q => q.band + ':' + tok(q.srx_string)[1],
      scoreNote: 'Shows QSOs and CQ zones per band only. Countries and continent-based QSO points need a DXCC table HamLog does not ship.'
    },
    'ARRL-DX': {
      name: 'ARRL International DX', adif: q => (modeCat(q) === 'CW' ? 'ARRL-DX-CW' : 'ARRL-DX-SSB'),
      cab: m => (m === 'CW' ? 'ARRL-DX-CW' : 'ARRL-DX-SSB'), serial: false,
      sentHint: '59 LA (W/VE: RST + state/province) or 59 100 (DX: RST + power)', rcvdHint: 'RST + power (or state if you are DX)',
      rcvd: [/^[1-5][1-9]9?$/, /^([A-Z]{2,3}|\d{1,4}|K|KW|[A-Z0-9]{1,4})$/],
      dupe: 'band', pts: () => 3, mult: true, multLabel: 'mults/band',
      multKey: q => q.band + ':' + (/^\d|^KW?$/.test(tok(q.srx_string)[1] || '') ? prefix(q.call) : tok(q.srx_string)[1]),
      scoreNote: '3 points per QSO. W/VE multiplier is ESTIMATED from call prefixes (not a true DXCC lookup); DX side counts states/provinces per band.'
    },
    'QSO-PARTY': {
      name: 'State QSO party (generic)', adif: null, cab: null, serial: false, needsId: true,
      sentHint: '59 LA or your county/parish', rcvdHint: 'their exchange, e.g. 59 CAD', rcvd: null,
      dupe: 'band-mode', pts: q => (modeCat(q) === 'PH' ? 1 : 2), mult: true, multLabel: 'mults',
      multKey: q => { const t = tok(q.srx_string); return t[t.length - 1]; },
      scoreNote: 'Rules differ by state. Estimate: phone 1, CW/digital 2 × unique last exchange token (county/state). Check your party\u2019s rules.'
    },
    'GENERIC': {
      name: 'Generic serial + exchange', adif: null, cab: null, serial: true, needsId: true,
      sentHint: 'optional extra exchange (serial is automatic)', rcvdHint: 'serial then any exchange, e.g. 12 LA', rcvd: null,
      dupe: 'band-mode', pts: () => 1, mult: false, multLabel: '', multKey: null, scoreNote: '1 point per QSO, no multipliers.'
    }
  };

  function tok(s) { return String(s || '').trim().toUpperCase().split(/\s+/).filter(Boolean); }
  function prefix(call) {
    // Portable prefix wins (VP2E/W1AW -> VP2E, W1AW/VE3 -> VE3); P/M/MM/AM/QRP suffixes ignored.
    const parts = H.normalizeCall(call).split('/').filter(x => x && !/^(P|M|MM|AM|QRP|\d)$/.test(x));
    const c = parts.length > 1 ? parts.slice().sort((a, b) => a.length - b.length)[0] : (parts[0] || '');
    const m = /^([A-Z0-9]*?\d)/.exec(c) || /^[A-Z]+/.exec(c);
    return m ? m[0] : c;
  }

  /** Parse a received exchange string. Returns { srx, srx_string, errors[] }. */
  function parseRcvd(key, text) {
    const c = CONTESTS[key];
    let t = tok(text);
    const out = { srx: '', srx_string: '', errors: [] };
    if (!c) { out.errors.push('Unknown contest'); return out; }
    if (c.serial) {
      // serial comes first (e.g. Sweepstakes "43 M 31 CT"); otherwise the check would be mistaken for it
      if (!/^\d+$/.test(t[0] || '')) out.errors.push('Received serial number missing (type it first)');
      else { out.srx = String(parseInt(t[0], 10)); t = t.slice(1); }
    }
    if (c.rcvd) {
      if (t.length !== c.rcvd.length) out.errors.push('Expected ' + c.rcvd.length + ' exchange item' + (c.rcvd.length > 1 ? 's' : '') + ' (' + c.rcvdHint + ')');
      else c.rcvd.forEach((re, i) => { if (!re.test(t[i])) out.errors.push('"' + t[i] + '" does not look right (' + c.rcvdHint + ')'); });
    } else if (!c.serial && !t.length) out.errors.push('Exchange is empty');
    out.srx_string = t.join(' ');
    return out;
  }

  function contestId(key, q, custom) {
    const c = CONTESTS[key];
    if (!c) return '';
    if (c.needsId) return String(custom || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
    return typeof c.adif === 'function' ? c.adif(q) : c.adif;
  }

  function dupeKeyFor(key, q) {
    const c = CONTESTS[key] || CONTESTS.GENERIC;
    const call = H.normalizeCall(q.call);
    if (c.dupe === 'once') return call;
    if (c.dupe === 'band') return call + '|' + String(q.band).toLowerCase();
    return call + '|' + String(q.band).toLowerCase() + '|' + modeCat(q);
  }
  /** Contest dupes: QSOs in the same session that match per the contest's dupe rule. */
  function contestDupes(key, sessionQsos, cand, excludeId) {
    const k = dupeKeyFor(key, cand);
    return sessionQsos.filter(q => q.id !== excludeId && dupeKeyFor(key, q) === k);
  }

  function qsoMs(q) {
    const d = String(q.qso_date || ''), t = String(q.time_on || '').padEnd(6, '0');
    return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
  }

  /** Running stats for a contest session. nowMs = reference time for rate (defaults to last QSO). */
  function contestStats(key, qsos, nowMs) {
    const c = CONTESTS[key] || CONTESTS.GENERIC;
    const seen = new Set(), mults = new Set();
    let n = 0, dupes = 0, pts = 0;
    const sorted = qsos.slice().sort((a, b) => qsoMs(a) - qsoMs(b));
    for (const q of sorted) {
      const k = dupeKeyFor(key, q);
      if (seen.has(k)) { dupes++; continue; }
      seen.add(k); n++;
      if (c.pts) pts += c.pts(q);
      if (c.multKey) { const m = c.multKey(q); if (m) mults.add(m); }
    }
    const ref = nowMs != null ? nowMs : (sorted.length ? qsoMs(sorted[sorted.length - 1]) : 0);
    const lastHour = sorted.filter(q => { const t = qsoMs(q); return t <= ref && t > ref - 3600e3; }).length;
    let score = null;
    if (c.pts) score = c.mult ? pts * Math.max(mults.size, 0) : pts;
    return { qsos: n, dupes, points: c.pts ? pts : null, mults: c.multKey ? mults.size : null, multLabel: c.multLabel, rate: lastHour, score, note: c.scoreNote };
  }

  /* ---------------- Cabrillo ---------------- */
  const CAB_BAND = { '160m': '1800', '80m': '3500', '60m': '5300', '40m': '7000', '30m': '10100', '20m': '14000', '17m': '18068',
    '15m': '21000', '12m': '24890', '10m': '28000', '6m': '50', '4m': '70', '2m': '144', '1.25m': '222', '70cm': '432' };
  function cabFreq(q) {
    const p = q.freq ? H.parseFreq(q.freq) : { mhz: null };
    if (p.mhz && p.mhz < 30) return String(Math.round(p.mhz * 1000));
    return CAB_BAND[String(q.band).toLowerCase()] || '';
  }
  function cabDate(d) { return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8); }
  function cabCall(c) { return H.normalizeCall(c) || '-'; }

  /**
   * Build a Cabrillo 3.0 log. session: { contest, contest_id, exch_sent, my_call, location, category... }.
   */
  function cabrillo(session, qsos, opts) {
    opts = opts || {};
    const c = CONTESTS[session.contest] || CONTESTS.GENERIC;
    const sorted = qsos.slice().sort((a, b) => qsoMs(a) - qsoMs(b));
    const cats = new Set(sorted.map(modeCat));
    const catMode = cats.size === 1 ? ({ CW: 'CW', PH: 'SSB', DG: 'DIGI' })[[...cats][0]] : 'MIXED';
    const contest = c.cab ? c.cab(catMode === 'CW' ? 'CW' : 'SSB') : (contestId(session.contest, {}, session.contest_id) || 'UNKNOWN');
    const myCall = H.normalizeCall(session.my_call || '');
    const st = contestStats(session.contest, qsos);
    const L = ['START-OF-LOG: 3.0', 'CREATED-BY: HamLog ' + (opts.version || ''), 'CONTEST: ' + contest, 'CALLSIGN: ' + myCall];
    if (session.location) L.push('LOCATION: ' + String(session.location).toUpperCase());
    L.push('CATEGORY-OPERATOR: ' + (session.cat_operator || 'SINGLE-OP'));
    L.push('CATEGORY-BAND: ALL', 'CATEGORY-MODE: ' + catMode, 'CATEGORY-POWER: ' + (session.cat_power || 'LOW'));
    if (st.score != null) L.push('CLAIMED-SCORE: ' + st.score);
    if (session.operators) L.push('OPERATORS: ' + session.operators);
    if (session.grid) L.push('GRID-LOCATOR: ' + session.grid);
    L.push('SOAPBOX: Claimed score is an estimate from HamLog; the sponsor computes the official score.');
    for (const q of sorted) {
      const sent = [q.stx, q.stx_string].filter(x => x !== '' && x != null).join(' ');
      const rcvd = [q.srx, q.srx_string].filter(x => x !== '' && x != null).join(' ');
      L.push(['QSO:', cabFreq(q).padStart(5), cabMode(q), cabDate(q.qso_date), String(q.time_on).slice(0, 4),
        (H.normalizeCall(q.station_callsign) || myCall).padEnd(13), sent.toUpperCase(), cabCall(q.call).padEnd(13), rcvd.toUpperCase()].join(' ').replace(/\s+$/, ''));
    }
    L.push('END-OF-LOG:');
    return L.join('\r\n') + '\r\n';
  }

  /* ---------------- POTA / SOTA references ---------------- */
  function normRef(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }
  /** POTA park: location prefix (letters/digits), dash, 4+ digits, e.g. US-0001, VE-1234, K-1234 (legacy). */
  function isValidPotaRef(s) { return /^[A-Z0-9]{1,4}-\d{4,6}$/.test(normRef(s)) && /^[A-Z]/.test(normRef(s)); }
  /** SOTA summit: association/region-NNN, e.g. W7W/LC-001, G/LD-008, W0C/FR-062. */
  function isValidSotaRef(s) { return /^[A-Z0-9]{1,4}\/[A-Z]{2}-\d{3}$/.test(normRef(s)); }
  function splitRefs(s) { return String(s || '').toUpperCase().split(/[\s,;]+/).map(normRef).filter(Boolean); }

  /** POTA file name: CALLSIGN@PARK-YYYYMMDD.adi ('/' in a call becomes '_' because '/' is not allowed in file names). */
  function potaFilename(call, park, adifDate) {
    return (H.normalizeCall(call) || 'NOCALL').replace(/\//g, '_') + '@' + normRef(park) + '-' + adifDate + '.adi';
  }
  /** Parks a QSO was made from: pota_parks (multi-park "2-fer") or just MY_SIG_INFO. */
  function parksOf(q) {
    const list = Array.isArray(q.pota_parks) ? q.pota_parks.map(normRef) : splitRefs(q.pota_parks);
    return list.length ? list : (q.my_sig_info ? [normRef(q.my_sig_info)] : []);
  }
  /** Group activator QSOs (MY_SIG = POTA) into one file per park per UTC day. A multi-park QSO is copied
   *  into each park's file with MY_SIG_INFO set to that park (POTA: separate log per park). */
  function potaGroups(qsos, myCall) {
    const groups = new Map();
    for (const q of qsos) {
      if (String(q.my_sig || '').toUpperCase() !== 'POTA') continue;
      const call = H.normalizeCall(q.station_callsign) || H.normalizeCall(myCall);
      for (const park of parksOf(q)) {
        const k = potaFilename(call, park, q.qso_date);
        if (!groups.has(k)) groups.set(k, { filename: k, park, date: q.qso_date, qsos: [] });
        groups.get(k).qsos.push(Object.assign({}, q, { my_sig_info: park }));
      }
    }
    return [...groups.values()].sort((a, b) => (a.filename < b.filename ? -1 : 1));
  }

  /** Activation progress. POTA: unique call/band/mode/their-park on this park this UTC day (10 needed).
   *  SOTA: distinct stations worked from this summit in the session (4 needed for points). */
  function activationProgress(type, qsos, ref, adifDate) {
    ref = normRef(ref);
    if (type === 'POTA') {
      const set = new Set();
      for (const q of qsos) if (parksOf(q).indexOf(ref) >= 0 && q.qso_date === adifDate && String(q.my_sig).toUpperCase() === 'POTA')
        set.add([H.normalizeCall(q.call), q.band, H.dupeMode(q), normRef(q.sig_info)].join('|'));
      return { count: set.size, needed: 10, valid: set.size >= 10 };
    }
    const set = new Set();
    for (const q of qsos) if (normRef(q.my_sota_ref) === ref) set.add(H.normalizeCall(q.call).split('/').sort((a, b) => b.length - a.length)[0]);
    return { count: set.size, needed: 4, valid: set.size >= 4 };
  }

  /* ---------------- SOTA CSV V2 ---------------- */
  const SOTA_BAND = { '160m': '1.8MHz', '80m': '3.5MHz', '60m': '5MHz', '40m': '7MHz', '30m': '10MHz', '20m': '14MHz', '17m': '18MHz',
    '15m': '21MHz', '12m': '24MHz', '10m': '28MHz', '6m': '50MHz', '4m': '70MHz', '2m': '144MHz', '1.25m': '222MHz', '70cm': '432MHz' };
  function sotaMode(q) {
    const p = H.normalizeModePair(q.mode, q.submode);
    if (p.mode === 'CW') return 'CW';
    if (p.mode === 'SSB') return 'SSB';
    if (p.mode === 'FM') return 'FM';
    if (p.mode === 'AM') return 'AM';
    if (p.mode === 'DIGITALVOICE' || p.mode === 'SSTV') return 'Other';
    return 'Data';
  }
  function csvCell(s) {
    s = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
    return /[",\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** SOTA V2 CSV: V2,MyCall,MySummit,DD/MM/YY,HHMM,Band,Mode,HisCall,HisSummit,Notes (chronological). */
  function sotaCsv(qsos, myCall) {
    const rows = qsos.filter(q => q.my_sota_ref || q.sota_ref).slice().sort((a, b) => qsoMs(a) - qsoMs(b)).map(q => {
      const d = String(q.qso_date);
      const p = q.freq ? H.parseFreq(q.freq) : { mhz: null };
      const band = p.mhz ? H.formatFreq(p.mhz) + 'MHz' : (SOTA_BAND[String(q.band).toLowerCase()] || '');
      const cells = ['V2', H.normalizeCall(q.station_callsign) || H.normalizeCall(myCall), normRef(q.my_sota_ref),
        d.slice(6, 8) + '/' + d.slice(4, 6) + '/' + d.slice(2, 4), String(q.time_on).slice(0, 4), band, sotaMode(q),
        H.normalizeCall(q.call), normRef(q.sota_ref), q.comment || ''];
      return cells.map(csvCell).join(',');
    });
    return rows.join('\r\n') + (rows.length ? '\r\n' : '');
  }

  return {
    CONTESTS, modeCat, cabMode, tok, prefix, parseRcvd, contestId, dupeKeyFor, contestDupes, contestStats, qsoMs,
    cabrillo, cabFreq, normRef, isValidPotaRef, isValidSotaRef, splitRefs, parksOf, potaFilename, potaGroups, activationProgress,
    sotaCsv, sotaMode
  };
});
