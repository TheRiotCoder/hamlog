/*
 * HamLog – ADIF 3.1.x (.adi) export and import.
 * Browser: window.Adif (needs window.HamData). Node: require('./adif.js').
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hamdata.js'));
  else root.Adif = factory(root.HamData);
})(typeof self !== 'undefined' ? self : this, function (H) {
  'use strict';

  const ADIF_VER = '3.1.4';
  const EOL = '\r\n';

  // ADIF field name -> internal QSO property
  const FIELD_MAP = {
    CALL: 'call', QSO_DATE: 'qso_date', TIME_ON: 'time_on', BAND: 'band', FREQ: 'freq',
    MODE: 'mode', SUBMODE: 'submode', RST_SENT: 'rst_sent', RST_RCVD: 'rst_rcvd',
    NAME: 'name', QTH: 'qth', STATE: 'state', COUNTRY: 'country', GRIDSQUARE: 'gridsquare',
    COMMENT: 'comment', STATION_CALLSIGN: 'station_callsign', OPERATOR: 'operator',
    MY_GRIDSQUARE: 'my_gridsquare', TX_PWR: 'tx_pwr'
  };
  const FIELD_ORDER = Object.keys(FIELD_MAP);
  const MULTILINE = { NOTES: 1, ADDRESS: 1, QSLMSG_RCVD: 0 };
  // Fields that are interpreted (not kept as "extra") on import
  const CONSUMED_ON_IMPORT = { QRZCOM_QSO_UPLOAD_STATUS: 1, QRZCOM_QSO_UPLOAD_DATE: 1 };

  /** ADI String/MultilineString data must be ASCII 32..126 (CR/LF allowed only in multiline). */
  function toAscii(value, multiline) {
    let s = String(value == null ? '' : value);
    s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u2026/g, '...')
      .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/Æ/g, 'AE').replace(/ø/g, 'o').replace(/Ø/g, 'O')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
      .replace(/\t/g, ' ');
    if (multiline) s = s.replace(/\r\n|\r|\n/g, EOL);
    else s = s.replace(/[\r\n]+/g, ' ');
    return s.replace(/[^\x20-\x7E\r\n]/g, '?');
  }

  /** One ADI field: <NAME:LEN>value  (LEN = character count; ASCII so chars == bytes). Empty -> ''. */
  function field(name, value) {
    if (value == null) return '';
    const v = toAscii(value, !!MULTILINE[name]);
    if (v === '') return '';
    return '<' + name + ':' + v.length + '>' + v;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function timestamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + ' ' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
  }

  function buildHeader(opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const lines = [
      'ADIF export from ' + (opts.programId || 'HamLog') + ' (offline ham radio logger)',
      field('ADIF_VER', ADIF_VER),
      field('CREATED_TIMESTAMP', timestamp(now)),
      field('PROGRAMID', opts.programId || 'HamLog'),
      field('PROGRAMVERSION', opts.programVersion || '1.0.0'),
      '<EOH>'
    ];
    return lines.join(EOL) + EOL;
  }

  function cleanNumber(v) {
    const s = String(v == null ? '' : v).trim().replace(',', '.').replace(/\s*w(atts?)?$/i, '');
    if (!s) return '';
    const n = parseFloat(s);
    return isFinite(n) && /^-?\d*\.?\d+$/.test(s) ? s.replace(/^(-?)\./, '$10.') : '';
  }

  /** Map an internal QSO to the ADIF field list [[NAME, value], ...] (pre-encoding). */
  function qsoFields(q, defaults) {
    defaults = defaults || {};
    const mp = H.normalizeModePair(q.mode, q.submode);
    let band = String(q.band || '').toLowerCase();
    const freq = q.freq ? H.parseFreq(q.freq) : { mhz: null };
    if (!band && freq.mhz) band = H.bandFromFreq(freq.mhz);
    const vals = {
      CALL: H.normalizeCall(q.call),
      QSO_DATE: q.qso_date,
      TIME_ON: q.time_on,
      BAND: band,
      FREQ: freq.mhz ? H.formatFreq(freq.mhz) : '',
      MODE: mp.mode,
      SUBMODE: mp.submode,
      RST_SENT: q.rst_sent,
      RST_RCVD: q.rst_rcvd,
      NAME: q.name,
      QTH: q.qth,
      STATE: q.state ? String(q.state).trim().toUpperCase() : '',
      COUNTRY: q.country,
      GRIDSQUARE: q.gridsquare ? H.normalizeGrid(q.gridsquare) : '',
      COMMENT: q.comment,
      STATION_CALLSIGN: H.normalizeCall(q.station_callsign || defaults.station_callsign || ''),
      OPERATOR: H.normalizeCall(q.operator || defaults.operator || ''),
      MY_GRIDSQUARE: H.normalizeGrid(q.my_gridsquare || defaults.my_gridsquare || ''),
      TX_PWR: cleanNumber(q.tx_pwr || defaults.tx_pwr || '')
    };
    const out = [];
    for (const k of FIELD_ORDER) {
      const v = vals[k] == null ? '' : String(vals[k]).trim();
      if (v !== '') out.push([k, v]);
    }
    const extra = q.extra || {};
    for (const k of Object.keys(extra)) {
      const name = String(k).toUpperCase();
      if (FIELD_MAP[name] || CONSUMED_ON_IMPORT[name]) continue;
      if (/_INTL$/.test(name)) continue; // *_INTL fields are ADX-only (not allowed in .adi)
      if (!/^[A-Z0-9_]+$/.test(name)) continue;
      if (extra[k] != null && String(extra[k]) !== '') out.push([name, String(extra[k])]);
    }
    return out;
  }

  function qsoToAdif(q, defaults) {
    return qsoFields(q, defaults).map(([k, v]) => field(k, v)).filter(Boolean).join(' ') + ' <EOR>';
  }

  /** Full .adi file text. */
  function exportAdif(qsos, opts) {
    opts = opts || {};
    const body = (qsos || []).map(q => qsoToAdif(q, opts.defaults)).join(EOL);
    return buildHeader(opts) + EOL + body + (body ? EOL : '');
  }

  /* ---------------- import ---------------- */

  function utf8Len(cp) { return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }
  function strUtf8Len(s) { let n = 0; for (const ch of s) n += utf8Len(ch.codePointAt(0)); return n; }
  /** Index in `str` after consuming `byteLen` UTF-8 bytes starting at `start`. */
  function advanceBytes(str, start, byteLen) {
    let i = start, bytes = 0;
    while (i < str.length && bytes < byteLen) {
      const cp = str.codePointAt(i);
      const b = utf8Len(cp);
      if (bytes + b > byteLen) break;
      bytes += b;
      i += cp > 0xffff ? 2 : 1;
    }
    return i;
  }

  /**
   * Parse ADI text. Returns { header: {FIELD: value}, records: [{FIELD: value}], warnings: [] }.
   * Field names are upper-cased. Handles optional header, type indicators (<F:L:T>),
   * case-insensitive <eoh>/<eor>, zero-length fields, and files whose lengths were
   * written as UTF-8 byte counts instead of characters.
   */
  function parseAdif(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const header = {};
    const records = [];
    const warnings = [];
    let cur = {};
    let pos = 0;
    let sawHeader = false;
    const tagRe = /<([A-Za-z0-9_]+)(?::(\d+)(?::([A-Za-z]))?)?>/g;
    // A header exists if the file does not start with '<'. Skip its free text up to the first tag.
    const hasPreamble = text.length > 0 && text[0] !== '<';
    for (;;) {
      tagRe.lastIndex = pos;
      const m = tagRe.exec(text);
      if (!m) break;
      const name = m[1].toUpperCase();
      const after = tagRe.lastIndex;
      if (m[2] === undefined) {
        if (name === 'EOR') {
          if (Object.keys(cur).length) records.push(cur);
          cur = {};
        } else if (name === 'EOH') {
          Object.assign(header, cur);
          cur = {};
          sawHeader = true;
        }
        pos = after;
        continue;
      }
      const len = parseInt(m[2], 10);
      let end = after + len;
      let value = text.slice(after, end);
      // Writer may have counted UTF-8 bytes; if the char-count read swallowed the next tag, re-read by bytes.
      if (value.indexOf('<') >= 0 && strUtf8Len(value) > len) {
        end = advanceBytes(text, after, len);
        value = text.slice(after, end);
      }
      cur[name] = value;
      pos = end;
    }
    if (hasPreamble && !sawHeader) warnings.push('File has text before the first field but no <EOH>; header ignored.');
    if (Object.keys(cur).length) {
      if (cur.CALL) { records.push(cur); warnings.push('Last record had no <EOR>; imported anyway.'); }
    }
    return { header, records, warnings };
  }

  function adifDateToIso(d) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(d || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString() : null;
  }

  /** Convert a parsed ADIF record into an internal QSO object (without id/timestamps). */
  function recordToQso(rec) {
    const q = {
      call: '', qso_date: '', time_on: '', band: '', freq: '', mode: '', submode: '',
      rst_sent: '', rst_rcvd: '', name: '', qth: '', state: '', country: '', gridsquare: '',
      comment: '', station_callsign: '', operator: '', my_gridsquare: '', tx_pwr: '',
      extra: {}, uploaded_qrz: null
    };
    for (const k of Object.keys(rec)) {
      const v = String(rec[k] == null ? '' : rec[k]).replace(/[\r\n]+$/, '');
      if (FIELD_MAP[k]) q[FIELD_MAP[k]] = v.trim();
      else if (!CONSUMED_ON_IMPORT[k]) q.extra[k] = v;
    }
    q.call = H.normalizeCall(q.call);
    q.station_callsign = H.normalizeCall(q.station_callsign);
    q.operator = H.normalizeCall(q.operator);
    q.qso_date = String(q.qso_date).replace(/\D/g, '');
    let t = String(q.time_on).replace(/\D/g, '');
    if (t.length === 4) t += '00';
    q.time_on = t;
    const mp = H.normalizeModePair(q.mode, q.submode);
    q.mode = mp.mode; q.submode = mp.submode;
    q.band = String(q.band).toLowerCase();
    if (q.freq) { const f = H.parseFreq(q.freq); q.freq = f.mhz ? H.formatFreq(f.mhz) : q.freq; if (!q.band && f.mhz) q.band = H.bandFromFreq(f.mhz); }
    if (q.gridsquare) q.gridsquare = H.normalizeGrid(q.gridsquare);
    if (q.my_gridsquare) q.my_gridsquare = H.normalizeGrid(q.my_gridsquare);
    if (String(rec.QRZCOM_QSO_UPLOAD_STATUS || '').toUpperCase() === 'Y') {
      q.uploaded_qrz = adifDateToIso(rec.QRZCOM_QSO_UPLOAD_DATE) || new Date().toISOString();
    }
    return q;
  }

  function importAdif(text) {
    const parsed = parseAdif(text);
    return { header: parsed.header, warnings: parsed.warnings, qsos: parsed.records.map(recordToQso) };
  }

  return { ADIF_VER, FIELD_MAP, toAscii, field, buildHeader, qsoFields, qsoToAdif, exportAdif, parseAdif, recordToQso, importAdif };
});
