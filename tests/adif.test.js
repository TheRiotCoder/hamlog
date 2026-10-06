/* Run: node tests/adif.test.js   (no dependencies) */
'use strict';
const assert = require('assert');
const path = require('path');
const H = require(path.join(__dirname, '..', 'js', 'hamdata.js'));
const A = require(path.join(__dirname, '..', 'js', 'adif.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message.split('\n').join('\n      ') : e)); }
}
/** Independent checker: every <NAME:N> must be followed by exactly N chars before the next tag/whitespace. */
function checkLengths(text) {
  const re = /<([A-Za-z0-9_]+):(\d+)>/g; let m, count = 0;
  while ((m = re.exec(text))) {
    const n = +m[2]; const v = text.substr(re.lastIndex, n);
    assert.strictEqual(v.length, n, 'short value for ' + m[1]);
    const nextCh = text.charAt(re.lastIndex + n);
    assert.ok(nextCh === '' || nextCh === ' ' || nextCh === '\r' || nextCh === '<', `field ${m[1]} length ${n} wrong; next char "${nextCh}" (value "${v}")`);
    count++;
  }
  return count;
}

const sample = {
  id: 'a1', call: 'w1abc', qso_date: '20261006', time_on: '052400', band: '20m', freq: '14.074',
  mode: 'MFSK', submode: 'FT4', rst_sent: '-10', rst_rcvd: '-12', name: 'Joe', qth: 'Boston', state: 'ma',
  country: 'United States', gridsquare: 'fn42ab', comment: 'Nice signal <3 & 73',
  station_callsign: '', operator: '', my_gridsquare: '', tx_pwr: '', extra: {}
};
const defaults = { station_callsign: 'K5XYZ', my_gridsquare: 'em20', tx_pwr: '100W', operator: '' };
const NOW = new Date(Date.UTC(2026, 9, 6, 5, 30, 0));

console.log('ADIF export');
const out = A.exportAdif([sample], { programId: 'HamLog', programVersion: '1.0.0', defaults, now: NOW });

test('header: free text first, ADIF_VER 3.1.x, CREATED_TIMESTAMP, PROGRAMID, then <EOH>', () => {
  assert.ok(!out.startsWith('<'), 'header must start with non-< text');
  assert.ok(/<ADIF_VER:5>3\.1\.\d/.test(out));
  assert.ok(out.includes('<CREATED_TIMESTAMP:15>20261006 053000'));
  assert.ok(out.includes('<PROGRAMID:6>HamLog'));
  assert.ok(out.includes('<PROGRAMVERSION:5>1.0.0'));
  const eoh = out.indexOf('<EOH>');
  assert.ok(eoh > 0 && eoh < out.indexOf('<CALL:'), '<EOH> must precede first record');
});
test('field length prefixes are exact (CALL, QSO_DATE, TIME_ON, ...)', () => {
  assert.ok(out.includes('<CALL:5>W1ABC'), 'CALL uppercased with length 5');
  assert.ok(out.includes('<QSO_DATE:8>20261006'));
  assert.ok(out.includes('<TIME_ON:6>052400'));
  assert.ok(out.includes('<BAND:3>20m'));
  assert.ok(out.includes('<FREQ:6>14.074'));
  assert.ok(out.includes('<RST_SENT:3>-10'));
  assert.ok(out.includes('<GRIDSQUARE:6>FN42ab'));
  assert.ok(out.includes('<STATE:2>MA'));
  assert.ok(out.includes('<COMMENT:19>Nice signal <3 & 73'));
  const n = checkLengths(out);
  assert.ok(n >= 20, 'expected many fields, got ' + n);
});
test('FT4 exported as MODE=MFSK + SUBMODE=FT4', () => {
  assert.ok(out.includes('<MODE:4>MFSK'));
  assert.ok(out.includes('<SUBMODE:3>FT4'));
});
test('station fields from settings: STATION_CALLSIGN, MY_GRIDSQUARE, TX_PWR (unit stripped)', () => {
  assert.ok(out.includes('<STATION_CALLSIGN:5>K5XYZ'));
  assert.ok(out.includes('<MY_GRIDSQUARE:4>EM20'));
  assert.ok(out.includes('<TX_PWR:3>100'));
  assert.ok(!out.includes('<OPERATOR:'), 'empty OPERATOR must be omitted');
});
test('each record ends with <EOR>; empty fields omitted', () => {
  assert.strictEqual((out.match(/<EOR>/g) || []).length, 1);
  assert.ok(/<EOR>\r?\n?$/.test(out));
  assert.ok(!/<[A-Z_]+:0>/.test(out));
});
test('per-QSO station snapshot wins over defaults', () => {
  const t = A.qsoToAdif(Object.assign({}, sample, { station_callsign: 'N0CALL/P', tx_pwr: '5' }), defaults);
  assert.ok(t.includes('<STATION_CALLSIGN:8>N0CALL/P'));
  assert.ok(t.includes('<TX_PWR:1>5'));
});
test('non-ASCII is transliterated so length == bytes (ADI String is ASCII)', () => {
  const t = A.qsoToAdif(Object.assign({}, sample, { name: 'José Müller', qth: 'Zürich', comment: 'line1\nline2 “73”' }), {});
  assert.ok(t.includes('<NAME:11>Jose Muller'), t);
  assert.ok(t.includes('<QTH:6>Zurich'));
  assert.ok(t.includes('<COMMENT:16>line1 line2 "73"'), t);
  assert.ok(/^[\x20-\x7E]*$/.test(t));
  checkLengths(t);
});
test('SSB / CW / FT8 / PSK31 mode mapping', () => {
  const m = (key) => { const o = H.modeByKey(key); return A.qsoToAdif(Object.assign({}, sample, { mode: o.mode, submode: o.submode }), {}); };
  assert.ok(m('SSB').includes('<MODE:3>SSB') && !m('SSB').includes('SUBMODE'));
  assert.ok(m('USB').includes('<MODE:3>SSB') && m('USB').includes('<SUBMODE:3>USB'));
  assert.ok(m('FT8').includes('<MODE:3>FT8') && !m('FT8').includes('SUBMODE'));
  assert.ok(m('PSK31').includes('<MODE:3>PSK') && m('PSK31').includes('<SUBMODE:5>PSK31'));
  assert.ok(m('CW').includes('<MODE:2>CW'));
});
test('band derived from freq when band missing', () => {
  const t = A.qsoToAdif(Object.assign({}, sample, { band: '', freq: '7.074' }), {});
  assert.ok(t.includes('<BAND:3>40m'));
});
test('multiple records -> one <EOR> each', () => {
  const t = A.exportAdif([sample, Object.assign({}, sample, { call: 'K1ABC' }), Object.assign({}, sample, { call: 'VE3XYZ' })], { now: NOW });
  assert.strictEqual((t.match(/<EOR>/g) || []).length, 3);
  assert.strictEqual((t.match(/<EOH>/g) || []).length, 1);
});

console.log('ADIF import');
test('round trip: export -> import gives same QSO data', () => {
  const r = A.importAdif(out);
  assert.strictEqual(r.qsos.length, 1);
  const q = r.qsos[0];
  assert.strictEqual(r.header.ADIF_VER.slice(0, 4), '3.1.');
  assert.strictEqual(q.call, 'W1ABC'); assert.strictEqual(q.qso_date, '20261006'); assert.strictEqual(q.time_on, '052400');
  assert.strictEqual(q.band, '20m'); assert.strictEqual(q.freq, '14.074');
  assert.strictEqual(q.mode, 'MFSK'); assert.strictEqual(q.submode, 'FT4');
  assert.strictEqual(q.rst_sent, '-10'); assert.strictEqual(q.rst_rcvd, '-12');
  assert.strictEqual(q.comment, 'Nice signal <3 & 73');
  assert.strictEqual(q.gridsquare, 'FN42ab'); assert.strictEqual(q.state, 'MA');
  assert.strictEqual(q.station_callsign, 'K5XYZ'); assert.strictEqual(q.my_gridsquare, 'EM20'); assert.strictEqual(q.tx_pwr, '100');
  assert.deepStrictEqual(q.extra, {});
});
test('lowercase tags, type indicators, no header, HHMM time, extra fields kept', () => {
  const src = '<call:4:s>K1AB<qso_date:8:d>20250102<time_on:4>1230<freq:5:n>7.030<mode:2>CW<rst_sent:3>579<eor>\n' +
              '<CALL:5>G4XYZ <QSO_DATE:8>20250103 <TIME_ON:6>010203 <BAND:3>15M <MODE:3>USB <DXCC:3>223 <EOR>';
  const r = A.importAdif(src);
  assert.strictEqual(r.qsos.length, 2);
  assert.strictEqual(r.qsos[0].call, 'K1AB'); assert.strictEqual(r.qsos[0].time_on, '123000');
  assert.strictEqual(r.qsos[0].band, '40m', 'band derived from freq'); assert.strictEqual(r.qsos[0].rst_sent, '579');
  assert.strictEqual(r.qsos[1].band, '15m');
  assert.strictEqual(r.qsos[1].mode, 'SSB'); assert.strictEqual(r.qsos[1].submode, 'USB', 'legacy MODE=USB normalized');
  assert.strictEqual(r.qsos[1].extra.DXCC, '223');
  assert.ok(A.qsoToAdif(r.qsos[1], {}).includes('<DXCC:3>223'), 'extra fields re-exported');
});
test('legacy MODE=FT4 imported as MFSK/FT4', () => {
  const r = A.importAdif('<CALL:4>K1AB<QSO_DATE:8>20250102<TIME_ON:4>1230<BAND:3>20m<MODE:3>FT4<EOR>');
  assert.strictEqual(r.qsos[0].mode, 'MFSK'); assert.strictEqual(r.qsos[0].submode, 'FT4');
});
test('length-based parsing: value containing "<" and ">" chars, zero-length fields', () => {
  const r = A.importAdif('hdr\n<EOH>\n<CALL:4>K1AB<COMMENT:9>a<b>c<d>e<NAME:0><QSO_DATE:8>20250102<TIME_ON:4>1230<EOR>');
  assert.strictEqual(r.qsos[0].comment, 'a<b>c<d>e');
  assert.strictEqual(r.qsos[0].name, '');
  assert.strictEqual(r.qsos[0].qso_date, '20250102');
});
test('header with fields and <eoh> in lowercase is not imported as a QSO', () => {
  const r = A.importAdif('Generated by X\n<adif_ver:5>3.1.0 <programid:1>X\n<eoh>\n<CALL:4>K1AB<QSO_DATE:8>20250102<TIME_ON:4>1230<EOR>');
  assert.strictEqual(r.qsos.length, 1);
  assert.strictEqual(r.header.ADIF_VER, '3.1.0');
});
test('UTF-8 byte-counted lengths from other loggers are handled', () => {
  // "Zoë" is 3 chars but 4 UTF-8 bytes; a byte-counting writer emits <NAME:4>
  const r = A.importAdif('<CALL:4>K1AB<NAME:4>Zoë<QSO_DATE:8>20250102<TIME_ON:4>1230<EOR>');
  assert.strictEqual(r.qsos[0].name, 'Zoë'); assert.strictEqual(r.qsos[0].qso_date, '20250102');
});
test('QRZ download: QRZCOM_QSO_UPLOAD_STATUS=Y marks as uploaded', () => {
  const r = A.importAdif('<CALL:4>K1AB<QSO_DATE:8>20250102<TIME_ON:4>1230<BAND:3>20m<MODE:3>FT8<QRZCOM_QSO_UPLOAD_STATUS:1>Y<QRZCOM_QSO_UPLOAD_DATE:8>20250105<EOR>');
  assert.ok(r.qsos[0].uploaded_qrz && r.qsos[0].uploaded_qrz.startsWith('2025-01-05'));
  assert.ok(!('QRZCOM_QSO_UPLOAD_STATUS' in r.qsos[0].extra));
});
test('missing final <EOR> still yields the record (with warning)', () => {
  const r = A.importAdif('<CALL:4>K1AB<QSO_DATE:8>20250102<TIME_ON:4>1230');
  assert.strictEqual(r.qsos.length, 1); assert.ok(r.warnings.length === 1);
});

console.log('Helpers');
test('band from frequency / kHz input', () => {
  assert.strictEqual(H.bandFromFreq(1.84), '160m'); assert.strictEqual(H.bandFromFreq(14.074), '20m');
  assert.strictEqual(H.bandFromFreq(146.52), '2m'); assert.strictEqual(H.bandFromFreq(446), '70cm');
  assert.strictEqual(H.bandFromFreq(13.9), '');
  assert.deepStrictEqual(H.parseFreq('14074'), { mhz: 14.074, text: '14.074', fromKhz: true });
  assert.strictEqual(H.parseFreq('7,074').text, '7.074');
  assert.strictEqual(H.parseFreq('abc').mhz, null);
});
test('RST defaults per mode: 59 / 599 / -10', () => {
  assert.strictEqual(H.defaultRst('SSB'), '59'); assert.strictEqual(H.defaultRst('FM'), '59');
  assert.strictEqual(H.defaultRst('CW'), '599'); assert.strictEqual(H.defaultRst('RTTY'), '599');
  assert.strictEqual(H.defaultRst('FT8'), '-10'); assert.strictEqual(H.defaultRst('MFSK', 'FT4'), '-10');
});
test('duplicate detection: same call+band+mode same UTC day', () => {
  const log = [{ id: '1', call: 'W1ABC', band: '20m', mode: 'SSB', submode: 'USB', qso_date: '20261006' }];
  assert.strictEqual(H.findDupes(log, { call: 'W1ABC', band: '20m', mode: 'SSB', submode: '', qso_date: '20261006' }).length, 1);
  assert.strictEqual(H.findDupes(log, { call: 'W1ABC', band: '40m', mode: 'SSB', qso_date: '20261006' }).length, 0);
  assert.strictEqual(H.findDupes(log, { call: 'W1ABC', band: '20m', mode: 'CW', qso_date: '20261006' }).length, 0);
  assert.strictEqual(H.findDupes(log, { call: 'W1ABC', band: '20m', mode: 'SSB', qso_date: '20261007' }).length, 0);
  assert.strictEqual(H.findDupes(log, { call: 'W1ABC', band: '20m', mode: 'SSB', qso_date: '20261006' }, '1').length, 0, 'excludes itself when editing');
  const ft = [{ id: '2', call: 'K1X', band: '20m', mode: 'MFSK', submode: 'FT4', qso_date: '20261006' }];
  assert.strictEqual(H.findDupes(ft, { call: 'K1X', band: '20m', mode: 'MFSK', submode: 'JS8', qso_date: '20261006' }).length, 0, 'FT4 != JS8');
});
test('callsign / grid / time validation', () => {
  assert.ok(H.isValidCall('W1ABC') && H.isValidCall('VE3/W1ABC/P') && !H.isValidCall('ABC') && !H.isValidCall('W1ABC/') && H.normalizeCall(' w1-abc ') === 'W1ABC');
  assert.strictEqual(H.normalizeGrid('em10DK'), 'EM10dk'); assert.ok(H.isValidGrid('EM10dk') && !H.isValidGrid('ZZ99'));
  assert.strictEqual(H.timeInputToAdif('05:24'), '052400'); assert.strictEqual(H.timeInputToAdif('05:24:33'), '052433');
  assert.ok(H.isValidAdifDate('20240229') && !H.isValidAdifDate('20250229'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
