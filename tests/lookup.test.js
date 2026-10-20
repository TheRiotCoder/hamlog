/* Run: node tests/lookup.test.js – callsign lookup core (mocked network) */
'use strict';
const assert = require('assert');
const L = require('../js/lookup.js');
let passed = 0, failed = 0; const q = [];
function test(n, fn) { q.push([n, fn]); }

const QRZ_LOGIN = '<?xml version="1.0"?><QRZDatabase version="1.34"><Session><Key>KEY1</Key><Count>1</Count><SubExp>non-subscriber</SubExp></Session></QRZDatabase>';
const QRZ_FREE = '<QRZDatabase><Callsign><call>DL1ABC</call><fname>HANS</fname><name>MUELLER</name><addr2>BERLIN</addr2><country>Germany</country></Callsign><Session><Key>KEY1</Key><SubExp>non-subscriber</SubExp><Message>A subscription is required to access the complete record.</Message></Session></QRZDatabase>';
const QRZ_SUB = '<QRZDatabase><Callsign><call>W1AW</call><name_fmt>ARRL HQ &amp; Friends</name_fmt><addr2>Newington</addr2><state>ct</state><country>United States</country><grid>FN31pr</grid></Callsign><Session><Key>KEY1</Key><SubExp>Wed Jan 1 2027</SubExp></Session></QRZDatabase>';
const QRZ_NF = '<QRZDatabase><Session><Key>KEY1</Key><Error>Not found: ZZ9ZZZ</Error></Session></QRZDatabase>';
const QRZ_NOKEY = '<QRZDatabase><Session><Error>Session Timeout</Error></Session></QRZDatabase>';
const QRZ_BADPW = '<QRZDatabase><Session><Error>Password incorrect</Error></Session></QRZDatabase>';
const QRZ_REFUSED = '<QRZDatabase><Session><Error>Connection refused</Error></Session></QRZDatabase>';
const HQ_LOGIN = '<HamQTH version="2.7"><session><session_id>SID9</session_id></session></HamQTH>';
const HQ_REC = '<HamQTH><search><callsign>OK2CQR</callsign><nick>Petr</nick><qth>Neratovice</qth><country>Czech Republic</country><grid>JO70fg</grid></search></HamQTH>';
const CALLOOK = JSON.stringify({ status: 'VALID', name: 'JOHN Q PUBLIC', address: { line1: '1 MAIN ST', line2: 'SPRINGFIELD, IL 62701' }, location: { gridsquare: 'EN59ss' } });

function mk(routes, extra) {
  const log = [], cache = {}, sess = {};
  let creds = (extra && extra.creds) || { qrzUser: 'N0CALL', qrzPass: 'hunter2-secret' };
  const fetch = async (url) => {
    log.push(url);
    for (const [re, fn] of routes) if (re.test(url)) { const b = typeof fn === 'function' ? fn(url) : fn; if (b instanceof Error) throw b; return { ok: true, status: 200, text: async () => b }; }
    throw new TypeError('Failed to fetch');
  };
  const cfg = Object.assign({ qrz: true, hamqth: true, callook: true, prefix: true }, extra && extra.cfg);
  const c = L.createClient({ fetch, getCreds: () => creds, cfg: () => cfg, store: { get: k => cache[k], set: (k, v) => { cache[k] = v; } }, session: { get: k => sess[k], set: (k, v) => { sess[k] = v; } },
    agent: 'HamLog-test', now: (extra && extra.now) || Date.now, redact: t => String(t).split('hunter2-secret').join('•••') });
  return { c, log, cache, sess, setCreds: v => { creds = v; } };
}

test('parseQrz reads key, error, record', () => {
  const x = L.parseQrz(QRZ_FREE); assert.strictEqual(x.key, 'KEY1'); assert.strictEqual(x.rec.fname, 'HANS'); assert.match(x.subExp, /non-subscriber/);
  assert.strictEqual(L.parseQrz(QRZ_NF).error, 'Not found: ZZ9ZZZ'); assert.strictEqual(L.parseQrz(QRZ_NOKEY).key, '');
});
test('fromQrz: free record -> name/qth/country, no grid; entities decoded', () => {
  assert.deepStrictEqual(L.fromQrz(L.parseQrz(QRZ_FREE).rec), { name: 'Hans Mueller', qth: 'Berlin', state: '', country: 'Germany', grid: '' });
  const s = L.fromQrz(L.parseQrz(QRZ_SUB).rec); assert.strictEqual(s.name, 'ARRL HQ & Friends'); assert.strictEqual(s.grid, 'FN31pr'); assert.strictEqual(s.state, 'CT');
});
test('fromHamqth / fromCallook', () => {
  assert.deepStrictEqual(L.fromHamqth(L.parseHamqth(HQ_REC).rec), { name: 'Petr', qth: 'Neratovice', state: '', country: 'Czech Republic', grid: 'JO70fg' });
  assert.deepStrictEqual(L.fromCallook(JSON.parse(CALLOOK)), { name: 'John Q Public', qth: 'Springfield', state: 'IL', country: 'United States', grid: 'EN59ss' });
  assert.strictEqual(L.fromCallook({ status: 'INVALID' }), null);
});
test('prefixCountry: longest prefix, portable, KG4 rule', () => {
  const t = { W1AW: 'United States', VE3XYZ: 'Canada', DL1ABC: 'Germany', 'VP2E/W1AW': 'Anguilla', 'W1AW/VE3': 'Canada', KG4AB: 'Guantanamo Bay', KG4ABC: 'United States', 'W1AW/P': 'United States', EA8XX: 'Canary Islands', JA1ZZZ: 'Japan', GM3ABC: 'Scotland', KH6AB: 'Hawaii' };
  for (const k in t) assert.strictEqual((L.prefixCountry(k) || {}).country, t[k], k);
  assert.strictEqual(L.prefixCountry('/'), null);
  assert.ok(L.isUsCall('W1AW')); assert.ok(!L.isUsCall('DL1ABC')); assert.ok(!L.isUsCall('W1AW/VE3'));
});
test('merge: first source per field wins and is labelled', () => {
  const m = L.merge([{ source: 'qrz', data: { name: 'A', grid: '' } }, { source: 'callook', data: { name: 'B', grid: 'FN31' } }]);
  assert.deepStrictEqual(m, { fields: { name: 'A', grid: 'FN31' }, sources: { name: 'qrz', grid: 'callook' } });
});
test('client: QRZ login once, key reused, free-account note', async () => {
  const t = mk([[/username=/, QRZ_LOGIN], [/s=KEY1;callsign=DL1ABC/, QRZ_FREE]]);
  const r = await t.c.lookup('DL1ABC'); assert.strictEqual(r.fields.name, 'Hans Mueller'); assert.strictEqual(r.sources.country, 'qrz');
  assert.ok(r.notes.some(n => /free account/.test(n)));
  t.cache.cache = {}; await t.c.lookup('DL1ABC');
  assert.strictEqual(t.log.filter(u => /username=/.test(u)).length, 1); assert.strictEqual(t.sess.qrzkey, 'KEY1');
});
test('client: missing <Key> -> re-login once', async () => {
  let n = 0;
  const t = mk([[/username=/, QRZ_LOGIN], [/callsign=W1AW/, () => (n++ === 0 ? QRZ_NOKEY : QRZ_SUB)]], { cfg: { callook: false } });
  const r = await t.c.lookup('W1AW'); assert.strictEqual(r.fields.grid, 'FN31pr');
  assert.strictEqual(t.log.filter(u => /username=/.test(u)).length, 2);
});
test('client: not found is a miss; prefix still gives country', async () => {
  const t = mk([[/username=/, QRZ_LOGIN], [/callsign=/, QRZ_NF]], { cfg: { callook: false } });
  const r = await t.c.lookup('DL9ZZZ'); assert.deepStrictEqual(r.fields, { country: 'Germany' }); assert.strictEqual(r.sources.country, 'prefix');
  assert.ok(r.notes.includes('qrz: not found'));
});
test('client: bad password blocks retries until creds change; never leaks password', async () => {
  const t = mk([[/username=/, QRZ_BADPW]], { cfg: { callook: false } });
  const r = await t.c.lookup('DL1ABC'); assert.ok(r.notes.some(n => /qrz: Password incorrect/.test(n)));
  await t.c.lookup('DL1ABD'); assert.strictEqual(t.log.length, 1);
  assert.ok(JSON.stringify(r).indexOf('hunter2-secret') < 0); assert.ok(JSON.stringify(t.cache).indexOf('hunter2') < 0);
  t.setCreds({ qrzUser: 'N0CALL', qrzPass: 'another-new-password' }); await t.c.lookup('DL1ABE'); assert.strictEqual(t.log.length, 2);
});
test('client: "Connection refused" blocks QRZ for 24 h', async () => {
  let clock = 1e12; const t = mk([[/username=/, QRZ_REFUSED]], { cfg: { callook: false }, now: () => clock });
  await t.c.lookup('DL1ABC'); await t.c.lookup('DL1ABD'); assert.strictEqual(t.log.length, 1);
  clock += 864e5 + 1; await t.c.lookup('DL1ABF'); assert.strictEqual(t.log.length, 2);
});
test('client: cache hit avoids network; offline uses prefix only', async () => {
  const t = mk([[/callook/, CALLOOK]], { creds: {} });
  const a = await t.c.lookup('W9XYZ'); assert.strictEqual(a.sources.name, 'callook'); assert.strictEqual(a.fields.grid, 'EN59ss');
  const b = await t.c.lookup('W9XYZ'); assert.ok(b.cached); assert.strictEqual(t.log.length, 1);
  const o = await t.c.lookup('DL1ABC', { online: false }); assert.ok(o.offline); assert.deepStrictEqual(o.fields, { country: 'Germany' }); assert.strictEqual(t.log.length, 1);
});
test('client: network failure never rejects', async () => {
  const t = mk([], { creds: {} });
  const r = await t.c.lookup('W9XYZ'); assert.ok(r.offline); assert.strictEqual(r.fields.country, 'United States');
});
test('client: HamQTH session + fills grid after free QRZ', async () => {
  const t = mk([[/username=/, QRZ_LOGIN], [/qrz.*callsign=OK2CQR/, QRZ_FREE.replace('DL1ABC', 'OK2CQR')], [/hamqth.*\?u=/, HQ_LOGIN], [/hamqth.*id=SID9/, HQ_REC]],
    { creds: { qrzUser: 'N0CALL', qrzPass: 'hunter2-secret', hamqthUser: 'x', hamqthPass: 'y' } });
  const r = await t.c.lookup('OK2CQR'); assert.strictEqual(r.sources.name, 'qrz'); assert.strictEqual(r.fields.grid, 'JO70fg'); assert.strictEqual(r.sources.grid, 'hamqth');
});
test('client: source toggles are respected', async () => {
  const t = mk([[/callook/, CALLOOK]], { creds: {}, cfg: { callook: false, prefix: false } });
  const r = await t.c.lookup('W9XYZ'); assert.deepStrictEqual(r.fields, {}); assert.strictEqual(t.log.length, 0);
});

(async () => {
  for (const [n, fn] of q) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; console.log('  ✗ ' + n + '\n      ' + e.message); } }
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
