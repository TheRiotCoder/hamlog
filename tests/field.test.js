/* Run: node tests/field.test.js   (no dependencies) – contest, Cabrillo, POTA/SOTA */
'use strict';
const assert = require('assert');
const path = require('path');
const H = require(path.join(__dirname, '..', 'js', 'hamdata.js'));
const A = require(path.join(__dirname, '..', 'js', 'adif.js'));
const F = require(path.join(__dirname, '..', 'js', 'field.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message.split('\n').join('\n      ') : e)); }
}
const Q = (o) => Object.assign({ id: Math.random().toString(36).slice(2), call: 'W1AW', qso_date: '20261107', time_on: '210000', band: '20m', mode: 'CW', submode: '', freq: '' }, o);

test('presets exist with verified IDs', () => {
  for (const k of ['ARRL-FD', 'WFD', 'ARRL-SS', 'CQ-WW', 'ARRL-DX', 'QSO-PARTY', 'GENERIC']) assert.ok(F.CONTESTS[k], k);
  assert.strictEqual(F.contestId('ARRL-FD', Q()), 'ARRL-FIELD-DAY');
  assert.strictEqual(F.contestId('WFD', Q()), 'WFD');
  assert.strictEqual(F.contestId('ARRL-SS', Q({ mode: 'CW' })), 'ARRL-SS-CW');
  assert.strictEqual(F.contestId('ARRL-SS', Q({ mode: 'SSB' })), 'ARRL-SS-SSB');
  assert.strictEqual(F.contestId('CQ-WW', Q({ mode: 'SSB', submode: 'USB' })), 'CQ-WW-SSB');
  assert.strictEqual(F.contestId('ARRL-DX', Q({ mode: 'CW' })), 'ARRL-DX-CW');
  assert.strictEqual(F.contestId('QSO-PARTY', Q(), 'la-qso party!'), 'LA-QSOPARTY');
});
test('mode categories', () => {
  assert.strictEqual(F.modeCat(Q({ mode: 'CW' })), 'CW');
  assert.strictEqual(F.modeCat(Q({ mode: 'SSB', submode: 'USB' })), 'PH');
  assert.strictEqual(F.modeCat(Q({ mode: 'FM' })), 'PH');
  assert.strictEqual(F.modeCat(Q({ mode: 'FT8' })), 'DG');
  assert.strictEqual(F.cabMode(Q({ mode: 'RTTY' })), 'RY');
});
test('parse received exchange: Field Day', () => {
  let r = F.parseRcvd('ARRL-FD', '2a stx');
  assert.deepStrictEqual([r.srx, r.srx_string, r.errors.length], ['', '2A STX', 0]);
  r = F.parseRcvd('ARRL-FD', '2A'); assert.ok(r.errors.length);
  r = F.parseRcvd('ARRL-FD', '2Z STX'); assert.ok(r.errors.length);
});
test('parse received exchange: WFD and Sweepstakes', () => {
  assert.strictEqual(F.parseRcvd('WFD', '1O LA').errors.length, 0);
  assert.ok(F.parseRcvd('WFD', '1X LA').errors.length);
  const r = F.parseRcvd('ARRL-SS', '43 M 31 CT');
  assert.deepStrictEqual([r.srx, r.srx_string, r.errors.length], ['43', 'M 31 CT', 0]);
  assert.ok(F.parseRcvd('ARRL-SS', 'M 31 CT').errors.some(e => /serial/i.test(e)));
  assert.ok(F.parseRcvd('ARRL-SS', '43 Z 31 CT').errors.length);
});
test('parse received exchange: CQ WW, ARRL DX, generic', () => {
  assert.strictEqual(F.parseRcvd('CQ-WW', '59 14').errors.length, 0);
  assert.ok(F.parseRcvd('CQ-WW', '59 41').errors.length);
  assert.strictEqual(F.parseRcvd('ARRL-DX', '599 KW').errors.length, 0);
  assert.strictEqual(F.parseRcvd('ARRL-DX', '59 100').errors.length, 0);
  const g = F.parseRcvd('GENERIC', '012 LA');
  assert.deepStrictEqual([g.srx, g.srx_string], ['12', 'LA']);
  assert.ok(F.parseRcvd('QSO-PARTY', '').errors.length);
});
test('dupe rules per contest', () => {
  const log = [Q({ call: 'K5ABC', band: '20m', mode: 'CW' })];
  assert.strictEqual(F.contestDupes('ARRL-FD', log, Q({ call: 'K5ABC', band: '20m', mode: 'CW' })).length, 1);
  assert.strictEqual(F.contestDupes('ARRL-FD', log, Q({ call: 'K5ABC', band: '40m', mode: 'CW' })).length, 0, 'other band ok');
  assert.strictEqual(F.contestDupes('ARRL-FD', log, Q({ call: 'K5ABC', band: '20m', mode: 'SSB' })).length, 0, 'other mode ok');
  assert.strictEqual(F.contestDupes('ARRL-FD', log, Q({ call: 'K5ABC', band: '20m', mode: 'FT8' })).length, 0, 'digital is its own mode');
  assert.strictEqual(F.contestDupes('ARRL-SS', log, Q({ call: 'K5ABC', band: '40m' })).length, 1, 'SS: once per contest');
  assert.strictEqual(F.contestDupes('CQ-WW', log, Q({ call: 'K5ABC', band: '20m', mode: 'SSB' })).length, 1, 'CQWW: once per band');
  assert.strictEqual(F.contestDupes('CQ-WW', log, Q({ call: 'K5ABC', band: '15m' })).length, 0);
  assert.strictEqual(F.contestDupes('ARRL-FD', log, Q({ call: 'k5abc', band: '20M', mode: 'CW' })).length, 1, 'case-insensitive');
  assert.strictEqual(F.contestDupes('ARRL-FD', log, log[0], log[0].id).length, 0, 'exclude self');
});
test('contest stats: QSOs, mults, rate, dupes, estimate', () => {
  const log = [
    Q({ call: 'K5A', time_on: '210000', srx: '1', srx_string: 'A 70 STX', mode: 'CW' }),
    Q({ call: 'K5B', time_on: '211000', srx: '2', srx_string: 'B 80 NTX' }),
    Q({ call: 'K5C', time_on: '221500', srx: '3', srx_string: 'Q 90 STX', band: '40m' }),
    Q({ call: 'K5A', time_on: '222000', srx: '4', srx_string: 'A 70 STX', band: '40m' })
  ];
  const st = F.contestStats('ARRL-SS', log);
  assert.strictEqual(st.qsos, 3); assert.strictEqual(st.dupes, 1); assert.strictEqual(st.mults, 2);
  assert.strictEqual(st.points, 6); assert.strictEqual(st.score, 12);
  assert.strictEqual(st.rate, 2, 'QSOs within 60 min before last (22:15, 22:20; 21:10 is >60 min earlier)');
  const fd = F.contestStats('ARRL-FD', [Q({ srx_string: '2A STX', mode: 'CW' }), Q({ call: 'N5X', srx_string: '1D LA', mode: 'SSB' })]);
  assert.strictEqual(fd.points, 3); assert.strictEqual(fd.score, 3); assert.strictEqual(fd.mults, 2);
  const cq = F.contestStats('CQ-WW', [Q({ srx_string: '599 5' }), Q({ call: 'DL1A', srx_string: '599 14' }), Q({ call: 'DL2A', srx_string: '599 14', band: '40m' })]);
  assert.strictEqual(cq.mults, 3); assert.strictEqual(cq.score, null, 'no CQWW score without DXCC data');
  assert.strictEqual(F.contestStats('ARRL-SS', [], Date.UTC(2026, 0, 1)).rate, 0);
});
test('ARRL DX multiplier estimate', () => {
  assert.strictEqual(F.prefix('DL1ABC'), 'DL1'); assert.strictEqual(F.prefix('VP2E/W1AW'), 'VP2'); assert.strictEqual(F.prefix('W1AW/VE3'), 'VE3'); assert.strictEqual(F.prefix('DL1ABC/P'), 'DL1');
  const st = F.contestStats('ARRL-DX', [Q({ call: 'DL1A', srx_string: '599 KW' }), Q({ call: 'DL1B', srx_string: '599 100' }), Q({ call: 'G4X', srx_string: '599 100' })]);
  assert.strictEqual(st.mults, 2); assert.strictEqual(st.points, 9);
});
test('Cabrillo: Sweepstakes', () => {
  const log = [
    Q({ call: 'W1AW', time_on: '210200', freq: '14.035', stx: '1', stx_string: 'A 79 LA', srx: '43', srx_string: 'M 31 CT', station_callsign: 'K5TEST' }),
    Q({ call: 'N5KO', time_on: '210100', band: '40m', stx: '2', stx_string: 'A 79 LA', srx: '3', srx_string: 'B 74 STX' })
  ];
  const t = F.cabrillo({ contest: 'ARRL-SS', my_call: 'k5test', location: 'la', cat_power: 'LOW' }, log, { version: '1.1.0' });
  const L = t.split('\r\n');
  assert.strictEqual(L[0], 'START-OF-LOG: 3.0');
  assert.ok(L.includes('CONTEST: ARRL-SS-CW')); assert.ok(L.includes('CALLSIGN: K5TEST')); assert.ok(L.includes('LOCATION: LA'));
  assert.ok(L.includes('CATEGORY-MODE: CW')); assert.ok(L.includes('CLAIMED-SCORE: 8'));
  const q = L.filter(l => l.startsWith('QSO:'));
  assert.strictEqual(q.length, 2);
  assert.ok(/^QSO:\s+7000 CW 2026-11-07 2101 K5TEST\s+2 A 79 LA N5KO\s+3 B 74 STX$/.test(q[0]), q[0]);
  assert.ok(/^QSO: 14035 CW 2026-11-07 2102 K5TEST\s+1 A 79 LA W1AW\s+43 M 31 CT$/.test(q[1]), q[1]);
  assert.strictEqual(L[L.length - 2], 'END-OF-LOG:'); assert.strictEqual(L[L.length - 1], '');
});
test('Cabrillo: Field Day, WFD, generic, VHF', () => {
  const fd = F.cabrillo({ contest: 'ARRL-FD', my_call: 'K5TEST', location: 'LA' }, [Q({ mode: 'SSB', band: '2m', stx_string: '1D LA', srx_string: '3A STX' })]);
  assert.ok(fd.includes('CONTEST: ARRL-FD')); assert.ok(/QSO:\s+144 PH 2026-11-07 2100 K5TEST\s+1D LA W1AW\s+3A STX/.test(fd), fd);
  const wfd = F.cabrillo({ contest: 'WFD', my_call: 'K5TEST' }, [Q({ mode: 'FT8', stx_string: '1O LA', srx_string: '2H EPA' })]);
  assert.ok(wfd.includes('CONTEST: WFD') && wfd.includes(' DG ') && wfd.includes('CATEGORY-MODE: DIGI'));
  const g = F.cabrillo({ contest: 'QSO-PARTY', contest_id: 'LA-QSO-PARTY', my_call: 'K5TEST' }, [Q({ srx_string: '59 CAD', stx_string: '59 EBR' }), Q({ mode: 'SSB', call: 'N5X', srx_string: '59 ORL' })]);
  assert.ok(g.includes('CONTEST: LA-QSO-PARTY') && g.includes('CATEGORY-MODE: MIXED'));
});
test('ADIF export carries contest fields', () => {
  const q = Q({ contest_id: 'ARRL-SS-CW', stx: '12', srx: '043', stx_string: 'A 79 LA', srx_string: 'M 31 CT', extra: { ARRL_SECT: 'CT' } });
  const t = A.qsoToAdif(q, {});
  for (const f of ['<CONTEST_ID:10>ARRL-SS-CW', '<STX:2>12', '<SRX:3>043', '<STX_STRING:7>A 79 LA', '<SRX_STRING:7>M 31 CT', '<ARRL_SECT:2>CT']) assert.ok(t.includes(f), f + ' in ' + t);
  // round trip
  const back = A.importAdif(A.exportAdif([q], {})).qsos[0];
  assert.strictEqual(back.contest_id, 'ARRL-SS-CW'); assert.strictEqual(back.srx_string, 'M 31 CT'); assert.strictEqual(back.stx, '12');
});
test('ADIF export: POTA + SOTA fields', () => {
  const t = A.qsoToAdif(Q({ my_sig: 'pota', my_sig_info: 'us-0001', sig: 'POTA', sig_info: 'US-1234', my_sota_ref: 'w7w/lc-001', sota_ref: 'W7O/CN-001' }), {});
  for (const f of ['<MY_SIG:4>POTA', '<MY_SIG_INFO:7>US-0001', '<SIG:4>POTA', '<SIG_INFO:7>US-1234', '<MY_SOTA_REF:10>W7W/LC-001', '<SOTA_REF:10>W7O/CN-001']) assert.ok(t.includes(f), f);
  // 1.0-era record whose POTA data came in through ADIF import as "extra" still exports it
  const old = A.qsoToAdif(Q({ extra: { SIG: 'POTA', SIG_INFO: 'US-0005' } }), {});
  assert.ok(old.includes('<SIG_INFO:7>US-0005') && old.includes('<SIG:4>POTA'));
  // and a plain 1.0 record exports none of the new fields
  assert.ok(!/CONTEST_ID|SIG|SOTA|SRX|STX/.test(A.qsoToAdif(Q({}), {})));
});
test('POTA / SOTA reference formats', () => {
  for (const r of ['US-0001', 'us-1234', 'VE-0123', 'K-4567', 'GB-10234', 'JA-0001']) assert.ok(F.isValidPotaRef(r), r);
  for (const r of ['US1234', 'US-12', '1US-0001', 'US-0001-2', '']) assert.ok(!F.isValidPotaRef(r), r);
  for (const r of ['W7W/LC-001', 'g/ld-008', 'W0C/FR-062', 'DM/BW-019', 'VK2/SW-001']) assert.ok(F.isValidSotaRef(r), r);
  for (const r of ['W7W-LC-001', 'W7W/LC001', 'W7W/LC-01', 'US-0001']) assert.ok(!F.isValidSotaRef(r), r);
  assert.deepStrictEqual(F.splitRefs(' us-0001, US-4567 ;k-1'), ['US-0001', 'US-4567', 'K-1']);
});
test('POTA filename + per-park-per-day grouping', () => {
  assert.strictEqual(F.potaFilename('kb2fmh', 'us-8088', '20220202'), 'KB2FMH@US-8088-20220202.adi');
  assert.strictEqual(F.potaFilename('K5TEST/P', 'US-0001', '20261019'), 'K5TEST_P@US-0001-20261019.adi');
  const log = [
    Q({ my_sig: 'POTA', my_sig_info: 'US-0001', qso_date: '20261019', station_callsign: 'K5TEST' }),
    Q({ my_sig: 'POTA', my_sig_info: 'US-0001', qso_date: '20261020', time_on: '000500' }),
    Q({ my_sig: 'POTA', my_sig_info: 'US-0001', pota_parks: ['US-0001', 'US-4567'], qso_date: '20261019', call: 'N5X' }),
    Q({ call: 'NOTPOTA' })
  ];
  const g = F.potaGroups(log, 'K5TEST');
  assert.deepStrictEqual(g.map(x => x.filename), ['K5TEST@US-0001-20261019.adi', 'K5TEST@US-0001-20261020.adi', 'K5TEST@US-4567-20261019.adi']);
  assert.strictEqual(g[0].qsos.length, 2);
  assert.strictEqual(g[2].qsos[0].my_sig_info, 'US-4567', 'multi-park copy gets that park');
  assert.strictEqual(log[2].my_sig_info, 'US-0001', 'original not mutated');
  const adi = A.exportAdif(g[2].qsos, {});
  assert.ok(adi.includes('<MY_SIG_INFO:7>US-4567') && adi.includes('<MY_SIG:4>POTA'));
});
test('activation progress: POTA 10 / SOTA 4', () => {
  const mk = (n, o) => Array.from({ length: n }, (_, i) => Q(Object.assign({ call: 'K' + i + 'AA', qso_date: '20261019' }, o)));
  let p = F.activationProgress('POTA', mk(9, { my_sig: 'POTA', my_sig_info: 'US-0001' }), 'US-0001', '20261019');
  assert.deepStrictEqual([p.count, p.needed, p.valid], [9, 10, false]);
  const ten = mk(10, { my_sig: 'POTA', my_sig_info: 'US-0001' });
  assert.ok(F.activationProgress('POTA', ten, 'us-0001', '20261019').valid);
  assert.strictEqual(F.activationProgress('POTA', ten, 'US-0001', '20261020').count, 0, 'per UTC day');
  ten.push(Q(Object.assign({}, ten[0], { id: 'dup' })));
  assert.strictEqual(F.activationProgress('POTA', ten, 'US-0001', '20261019').count, 10, 'exact dupes not counted');
  p = F.activationProgress('SOTA', mk(3, { my_sota_ref: 'W7W/LC-001' }).concat([Q({ call: 'K0AA/P', my_sota_ref: 'W7W/LC-001', band: '40m' })]), 'W7W/LC-001');
  assert.deepStrictEqual([p.count, p.needed, p.valid], [3, 4, false], 'same station on two bands counts once');
  assert.ok(F.activationProgress('SOTA', mk(4, { my_sota_ref: 'W7W/LC-001' }), 'W7W/LC-001').valid);
});
test('SOTA CSV V2', () => {
  const t = F.sotaCsv([
    Q({ call: 'G4ELZ', my_sota_ref: 'G/LD-008', qso_date: '20030424', time_on: '120200', freq: '7.032', station_callsign: 'G3WGV' }),
    Q({ call: 'G3NOH', my_sota_ref: 'G/LD-008', qso_date: '20030424', time_on: '120400', band: '40m', comment: 'PSE QSL, direct' }),
    Q({ call: 'DL0DAN/P', my_sota_ref: 'G/LD-008', sota_ref: 'DM/BW-019', qso_date: '20030424', time_on: '120700', band: '2m', mode: 'FM' }),
    Q({ call: 'G4TJC', sota_ref: 'G/SP-015', qso_date: '20030610', time_on: '102300', band: '70cm', mode: 'FT8' }),
    Q({ call: 'X', qso_date: '20030610' })
  ], 'G3WGV');
  const L = t.trim().split('\r\n');
  assert.strictEqual(L.length, 4);
  assert.strictEqual(L[0], 'V2,G3WGV,G/LD-008,24/04/03,1202,7.032MHz,CW,G4ELZ,,');
  assert.strictEqual(L[1], 'V2,G3WGV,G/LD-008,24/04/03,1204,7MHz,CW,G3NOH,,"PSE QSL, direct"');
  assert.strictEqual(L[2], 'V2,G3WGV,G/LD-008,24/04/03,1207,144MHz,FM,DL0DAN/P,DM/BW-019,');
  assert.strictEqual(L[3], 'V2,G3WGV,,10/06/03,1023,432MHz,Data,G4TJC,G/SP-015,');
});
test('merge key keeps 2-fer P2P entries apart but old keys unchanged', () => {
  const a = Q({ sig_info: 'US-0001' }), b = Q({ sig_info: 'US-0002' }), c = Q({});
  assert.notStrictEqual(H.mergeKey(a), H.mergeKey(b));
  assert.strictEqual(H.mergeKey(c), ['W1AW', '20261107', '2100', '20m', 'CW'].join('|'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
