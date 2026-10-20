/* Run: node tests/vault.test.js – vault crypto (ported from SatPass 1.3.5) + HamVault store, Node webcrypto */
'use strict';
const assert = require('assert');
const VC = require('../js/vaultcrypto.js');
let passed = 0, failed = 0; const q = []; const test = (n, fn) => q.push([n, fn]);
const PASS = 'correct horse battery', CREDS = { qrzUser: 'N0CALL', qrzPass: 'hunter2-secret' };

function storage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }
function loadVault(host, ls, ss) {
  global.window = {}; global.localStorage = ls || storage(); global.sessionStorage = ss || storage(); global.location = { hostname: host };
  global.window.HamVaultCrypto = VC; delete require.cache[require.resolve('../js/vault.js')]; require('../js/vault.js');
  return { V: global.window.HamVault, ls: global.localStorage, ss: global.sessionStorage };
}
const dump = st => [...st._m.entries()].map(e => e.join('=')).join('\n');

test('createVault / openVault round trip, 600k iterations, AAD-bound header', async () => {
  const v = await VC.createVault(CREDS, PASS); assert.strictEqual(v.blob.enc, 2); assert.strictEqual(VC.vaultHeader(v.blob).iter, 600000);
  assert.ok(JSON.stringify(v.blob).indexOf('hunter2') < 0);
  const o = await VC.openVault(v.blob, PASS); assert.deepStrictEqual(o.creds, CREDS);
  await assert.rejects(VC.openVault(v.blob, 'wrong passphrase!'), e => e.kind === 'auth');
  const t = JSON.parse(JSON.stringify(v.blob)); t.iter = 100000;
  await assert.rejects(VC.openVault(t, PASS));
});
test('wrapSecret / unwrapSecret (PRF) round trip, padded, wrong PRF fails', async () => {
  const prf = new Uint8Array(32).fill(7), meta = { credId: 'AAAA', prfSalt: 'QUJD', rpId: 'localhost' };
  const rec = await VC.wrapSecret('c2VjcmV0', prf, meta); assert.ok(VC.validBioRecord(rec));
  assert.strictEqual(await VC.unwrapSecret(rec, prf), 'c2VjcmV0');
  await assert.rejects(VC.unwrapSecret(rec, new Uint8Array(32).fill(8)));
});
test('backup: round trip; header tamper and wrong passphrase rejected', async () => {
  const t = await VC.exportBackup(CREDS, '', PASS); assert.ok(t.indexOf('hunter2') < 0);
  assert.deepStrictEqual((await VC.importBackup(t, PASS)).creds, CREDS);
  const o = JSON.parse(t); o.note = 'tampered'; await assert.rejects(VC.importBackup(JSON.stringify(o), PASS));
  await assert.rejects(VC.importBackup(t, 'wrong passphrase!'), e => e.kind === 'auth');
  await assert.rejects(VC.exportBackup(CREDS, '', 'short'));
});
test('sharedOrigin + lockDue', () => {
  assert.ok(VC.sharedOrigin('theriotcoder.github.io')); assert.ok(!VC.sharedOrigin('localhost')); assert.ok(!VC.sharedOrigin('github.io.example.com'));
  assert.strictEqual(VC.lockDue({ idleMin: 15, hiddenMin: 5 }, { now: 16 * 60e3, lastActive: 0, hiddenSince: null }), 'idle');
  assert.strictEqual(VC.lockDue({ idleMin: 15, hiddenMin: 5 }, { now: 6 * 60e3, lastActive: 6 * 60e3, hiddenSince: 0 }), 'hidden');
  assert.strictEqual(VC.lockDue({ idleMin: 0, hiddenMin: 0 }, { now: 1e9, lastActive: 0, hiddenSince: 0 }), null);
});
test('HamVault: no passphrase = session-only, nothing in localStorage', async () => {
  const { V, ls, ss } = loadVault('theriotcoder.github.io');
  await V.setCreds(CREDS); assert.strictEqual(V.credMode(), 'session');
  assert.ok(dump(ls).indexOf('hunter2') < 0); assert.ok(dump(ss).indexOf('hamlog:vault:creds') === 0);
});
test('HamVault: passphrase encrypts, reload is locked, unlock works, keys are namespaced', async () => {
  let { V, ls } = loadVault('theriotcoder.github.io');
  await V.setCreds(CREDS); await V.lock(PASS); assert.strictEqual(V.credMode(), 'encrypted');
  assert.ok(dump(ls).indexOf('hunter2') < 0);
  for (const k of ls._m.keys()) assert.ok(k.startsWith('hamlog:vault:'), k);
  ({ V } = loadVault('theriotcoder.github.io', ls));
  assert.ok(V.isLocked()); assert.deepStrictEqual(V.getCreds(), {});
  await assert.rejects(V.setCreds({ qrzUser: 'X' }), e => e.kind === 'locked');
  await assert.rejects(V.unlock('wrong passphrase!'));
  await V.unlock(PASS); assert.deepStrictEqual(V.getCreds(), CREDS);
});
test('HamVault: lockNow queued behind a running save (no corruption)', async () => {
  const { V, ls } = loadVault('localhost');
  await V.setCreds(CREDS); await V.lock(PASS);
  const p = V.setCreds({ hamqthUser: 'hq' }); V.lockNow(); await p; await V.whenIdle();
  assert.ok(V.isLocked());
  const { V: V2 } = loadVault('localhost', ls); await V2.unlock(PASS); assert.strictEqual(V2.getCreds().hamqthUser, 'hq');
});
test('HamVault: forget during a pending save cancels it', async () => {
  const { V, ls } = loadVault('localhost');
  await V.lock(PASS); const p = V.setCreds(CREDS); V.forgetCreds();
  await assert.rejects(p, e => e.kind === 'cancelled'); await V.whenIdle();
  assert.strictEqual(ls.getItem('hamlog:vault:creds'), null);
});
test('HamVault: biometric refused on github.io, offered elsewhere', async () => {
  let { V } = loadVault('theriotcoder.github.io'); assert.strictEqual(V.bioAllowed(), false);
  await V.setCreds(CREDS); await V.lock(PASS);
  await assert.rejects(V.bioSave({ credId: 'AAAA', prfSalt: 'QUJD', rpId: 'theriotcoder.github.io' }, new Uint8Array(32)));
  ({ V } = loadVault('localhost')); assert.strictEqual(V.bioAllowed(), true);
});
test('HamVault: redact hides stored secrets', async () => {
  const { V } = loadVault('localhost'); await V.setCreds(CREDS);
  assert.ok(V.redact('login failed for hunter2-secret').indexOf('hunter2') < 0);
});
test('HamVault: encrypted backup export/import with overwrite confirm', async () => {
  const { V } = loadVault('localhost'); await V.setCreds(CREDS);
  const t = await V.exportBackup(PASS); assert.ok(t.indexOf('hunter2') < 0);
  await V.setCreds({ qrzPass: 'changed-password' });
  await assert.rejects(V.importBackup(t, PASS), e => e.kind === 'cancelled');
  const r = await V.importBackup(t, PASS, () => true); assert.strictEqual(r.overwrote, 1); assert.strictEqual(V.getCreds().qrzPass, 'hunter2-secret');
});

(async () => {
  for (const [n, fn] of q) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; console.log('  ✗ ' + n + '\n      ' + (e && e.stack)); } }
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
