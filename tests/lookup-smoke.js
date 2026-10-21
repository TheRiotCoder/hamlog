// Callsign lookup + login vault smoke (headless Chrome, raw CDP, QRZ/HamQTH/callook MOCKED via Fetch interception - no real network calls).
// Run from anywhere: node --experimental-websocket tests/browser-smoke.js   (Node 22+: flag not needed)
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const PORT = 9335, APP = process.env.HAMLOG_URL || 'http://localhost:8767/';
fs.mkdirSync('/tmp/hamlog-shots', { recursive: true });
const DL = '/tmp/hamlog-dl3'; fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
fs.rmSync('/tmp/chrome-hamlog3', { recursive: true, force: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python3', ['-m', 'http.server', '8767', '--bind', '127.0.0.1'], { cwd: require('path').join(__dirname, '..'), stdio: 'ignore' });
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-hamlog3', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

const problems = [], logs = [];
let ws, nextId = 1; const pending = new Map(); const listeners = [];
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + expr + ' -> ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
function waitEvent(name, ms = 10000) {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + name)), ms); listeners.push({ name, fn: p => { clearTimeout(t); res(p); }, once: true }); });
}
const results = [];
function check(name, ok, info) { results.push([ok, name, info]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }

(async () => {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch (e) {} await sleep(200); }
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let dialogAccept = true; const dialogs = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(p.method + ': ' + msg.error.message)) : p.res(msg.result); return; }
    const { method, params } = msg;
    if (method === 'Runtime.consoleAPICalled') {
      const text = params.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
      logs.push(params.type + ': ' + text);
      if (params.type === 'error' || params.type === 'warning' || params.type === 'assert') problems.push('console.' + params.type + ': ' + text);
    }
    if (method === 'Runtime.exceptionThrown') problems.push('exception: ' + (params.exceptionDetails.exception ? params.exceptionDetails.exception.description : params.exceptionDetails.text));
    if (method === 'Log.entryAdded' && (params.entry.level === 'error' || params.entry.level === 'warning')) problems.push('log.' + params.entry.level + ': ' + params.entry.text + ' ' + (params.entry.url || ''));
    if (method === 'Page.javascriptDialogOpening') { dialogs.push(params.type + ': ' + params.message); send('Page.handleJavaScriptDialog', { accept: dialogAccept, promptText: 'DELETE' }); }
    for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].name === method) { const l = listeners[i]; listeners.splice(i, 1); l.fn(params); }
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable'); await send('DOM.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }).catch(() => send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // ---- mock the lookup services (never touches the real QRZ) ----
  const hits = [], reqs = [];
  const KEYXML = '<QRZDatabase><Session><Key>MOCKKEY</Key><SubExp>non-subscriber</SubExp></Session></QRZDatabase>';
  const rec = c => c === 'DL1ABC' ? '<QRZDatabase><Callsign><call>DL1ABC</call><fname>HANS</fname><name>MUELLER</name><addr2>BERLIN</addr2><country>Germany</country></Callsign><Session><Key>MOCKKEY</Key><SubExp>non-subscriber</SubExp><Message>A subscription is required to access the complete record.</Message></Session></QRZDatabase>'
    : c === 'W1AW' ? '<QRZDatabase><Callsign><call>W1AW</call><fname>ARRL</fname><name>HQ</name><addr2>NEWINGTON</addr2><state>CT</state><country>United States</country></Callsign><Session><Key>MOCKKEY</Key><SubExp>non-subscriber</SubExp></Session></QRZDatabase>'
    : '<QRZDatabase><Session><Key>MOCKKEY</Key><Error>Not found: ' + c + '</Error></Session></QRZDatabase>';
  const CALLOOK = JSON.stringify({ status: 'VALID', name: 'ARRL INC', address: { line2: 'NEWINGTON, CT 06111' }, location: { gridsquare: 'FN31pr' } });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data); if (m.method !== 'Fetch.requestPaused') return;
    const rq = m.params.request, u = rq.url + (rq.method === 'POST' ? '?' + (rq.postData || '') : ''); hits.push(u); reqs.push([rq.method, rq.url]);
    let body = '';
    if (/xmldata\.qrz\.com/.test(u)) { const c = /callsign=([^;&]+)/.exec(u); body = c ? rec(decodeURIComponent(c[1])) : KEYXML; }
    else if (/callook\.info/.test(u)) body = /W1AW/.test(u) ? CALLOOK : JSON.stringify({ status: 'INVALID' });
    else body = '<HamQTH><session><error>Wrong user name or password</error></session></HamQTH>';
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: /callook/.test(u) ? 'application/json' : 'text/xml' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(body).toString('base64') });
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*xmldata.qrz.com*' }, { urlPattern: '*hamqth.com*' }, { urlPattern: '*callook.info*' }] });

  const setv = (sel, v) => evalJs(`(() => { const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const click = sel => evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const val = sel => evalJs(`document.querySelector(${JSON.stringify(sel)}).value`);
  const submit = sel => evalJs(`document.querySelector(${JSON.stringify(sel)}).requestSubmit()`);
  const allStore = () => evalJs(`JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage))`);
  const PW = 'qrz-Secret-Pw-42', VPASS = 'my vault passphrase 1';
  const live = !!process.env.HAMLOG_URL, ghio = /github\.io/.test(APP);
  // WebAuthn virtual platform authenticator with PRF (used only where biometric unlock is offered)
  await send('WebAuthn.enable', { enableUI: false });
  const auth = await send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });

  let ld = waitEvent('Page.loadEventFired'); await send('Page.navigate', { url: APP + '#log' }); await ld; await sleep(1200);
  await evalJs(`localStorage.clear(); sessionStorage.clear(); true`);
  ld = waitEvent('Page.loadEventFired'); await send('Page.reload', { ignoreCache: true }); await ld; await sleep(1200);
  check('version 1.3.0', await evalJs(`fetch('sw.js',{cache:'no-store'}).then(r=>r.text()).then(t=>t.includes('hamlog-v1.3.0'))`));
  check('modules loaded', await evalJs(`!!(window.HamVault && window.HamLookup && window.HamLookupUI && window.HamVaultCrypto)`));
  check('lookup card present, enabled by default', await evalJs(`!!document.querySelector('#lookupCard') && document.querySelector('#lk-enabled').checked`));
  const host = await evalJs('location.hostname');
  if (ghio) check('biometric NOT offered on ' + host + ' (shared-origin note)', await evalJs(`document.querySelector('#btnBioEnroll').hidden && /shares that one origin/.test(document.querySelector('#bioNote').textContent) && HamVault.bioAllowed()===false`));
  else check('biometric allowed on ' + host + ' (own origin); github.io still refused', await evalJs(`HamVault.bioAllowed()===true && HamVaultCrypto.sharedOrigin('theriotcoder.github.io')===true`));
  check(ghio ? 'moved notice shown on the github.io mirror, links to pages.dev' : 'no moved notice on ' + host, ghio
    ? await evalJs(`!document.querySelector('#movedBar').hidden && /hamlog-azm\.pages\.dev/.test(document.querySelector('#movedLink').href) && /encrypted login backup/.test(document.querySelector('#movedBar').textContent)`)
    : await evalJs(`document.querySelector('#movedBar').hidden`));
  check('password-manager-friendly forms', await evalJs(`document.querySelector('#cr-qrzUser').autocomplete==='username' && document.querySelector('#cr-qrzPass').autocomplete==='current-password' && document.querySelector('#cr-qrzPass').type==='password' && document.querySelector('#vaultNewPass').autocomplete==='new-password'`));

  // no login: callook (US) + prefix
  await evalJs(`location.hash='#log'`); await sleep(200);
  await setv('#f-call', 'W1AW'); await sleep(1300);
  check('no login: callook fills name/qth/state/grid, prefix fills country', JSON.stringify(await evalJs(`['name','qth','state','country','gridsquare'].map(k=>document.querySelector('#f-'+k).value)`)) === JSON.stringify(['Arrl Inc', 'Newington', 'CT', 'United States', 'FN31pr']));
  check('chip shows sources', /callook/.test(await evalJs(`document.querySelector('#lookupChip').textContent`)), await evalJs(`document.querySelector('#lookupChip').textContent`));
  check('filled fields marked prefilled + source title', await evalJs(`document.querySelector('#f-name').classList.contains('prefilled') && /callook/.test(document.querySelector('#f-name').title)`));
  check('changing call clears looked-up values', await (async () => { await setv('#f-call', 'W1A'); await sleep(100); return evalJs(`document.querySelector('#f-name').value===''`); })());

  // save QRZ login (session-only first)
  await evalJs(`location.hash='#settings'`); await sleep(300);
  await setv('#cr-qrzUser', 'N0CALL'); await setv('#cr-qrzPass', PW); await submit('#qrzCredForm'); await sleep(300);
  check('no passphrase: session-only, not in localStorage', await evalJs(`HamVault.credMode()==='session'`) && !(await evalJs(`JSON.stringify(Object.entries(localStorage))`)).includes(PW));
  check('password field cleared after save', (await val('#cr-qrzPass')) === '');
  await setv('#vaultNewPass', VPASS); await setv('#vaultNewPass2', VPASS); await submit('#vaultPassForm'); await sleep(2500);
  check('passphrase: encrypted, no plaintext anywhere in storage', await evalJs(`HamVault.credMode()==='encrypted'`) && !(await allStore()).includes(PW), await evalJs(`HamVault.credMode()`));
  check('storage keys namespaced hamlog:', await evalJs(`Object.keys(localStorage).every(k=>k.startsWith('hamlog:'))`), await evalJs(`Object.keys(localStorage)`));

  // QRZ lookup (free account record) - typed values preserved
  await evalJs(`location.hash='#log'`); await sleep(200);
  await setv('#f-name', 'Typed Name'); await setv('#f-call', 'DL1ABC'); await sleep(1500);
  check('QRZ: blank fields filled (qth, country)', (await val('#f-qth')) === 'Berlin' && (await val('#f-country')) === 'Germany', [await val('#f-qth'), await val('#f-country')]);
  check('QRZ: typed name NOT overwritten', (await val('#f-name')) === 'Typed Name');
  check('QRZ: login + lookup via mocked xmldata.qrz.com, key reused', hits.filter(u => /qrz.*username=/.test(u)).length === 1 && hits.some(u => /s=MOCKKEY&callsign=DL1ABC/.test(u)));
  check('QRZ: POST only, password never in a request URL', reqs.filter(r => /qrz/.test(r[1])).every(r => r[0] === 'POST' && !r[1].includes(PW) && !/username|password/.test(r[1])));
  check('QRZ session key kept in sessionStorage', await evalJs(`sessionStorage.getItem('hamlog:lookup:qrzkey')==='"MOCKKEY"'`));
  check('chip names QRZ.com', /QRZ/.test(await evalJs(`document.querySelector('#lookupChip').textContent`)));
  check('no credential in console logs', !logs.join('\n').includes(PW));
  const nHits = hits.length;
  await setv('#f-name', ''); await setv('#f-call', 'DL1AB'); await sleep(100); await setv('#f-call', 'DL1ABC'); await sleep(1300);
  check('cache: repeat lookup makes no request', hits.length === nHits && (await val('#f-qth')) === 'Berlin');
  await setv('#f-call', 'DL9ZZZ'); await sleep(1300);
  check('not found: prefix country only', (await val('#f-country')) === 'Germany' && (await val('#f-qth')) === '');

  // lock / reload / unlock
  await evalJs(`location.hash='#settings'`); await sleep(200);
  await click('#btnLockNow'); await sleep(300);
  check('lock now: locked, unlock form shown, creds hidden', await evalJs(`HamVault.isLocked() && !document.querySelector('#vaultUnlockBox').hidden && document.querySelector('#credBox').hidden`));
  ld = waitEvent('Page.loadEventFired'); await send('Page.reload', {}); await ld; await sleep(1200);
  check('reload: still locked', await evalJs(`HamVault.isLocked()`));
  await setv('#vaultUnlockPass', 'wrong passphrase xx'); await submit('#vaultUnlockForm'); await sleep(2500);
  check('wrong passphrase rejected', await evalJs(`HamVault.isLocked()`) && (await evalJs(`document.querySelector('#vaultMsg').textContent`)).length > 0);
  await setv('#vaultUnlockPass', VPASS); await submit('#vaultUnlockForm'); await sleep(2500);
  check('unlock restores login', await evalJs(`!HamVault.isLocked() && HamVault.getCreds().qrzUser==='N0CALL'`) && (await val('#cr-qrzUser')) === 'N0CALL' && (await val('#cr-qrzPass')) === '');
  if (!ghio) {   // biometric (WebAuthn PRF) enrol -> lock -> unlock with the virtual authenticator
    await evalJs(`document.querySelector('#vaultDetails').open=true`); await sleep(1500);
    check('biometric option offered (Enable biometric unlock visible)', await evalJs(`!document.querySelector('#btnBioEnroll').hidden`), await evalJs(`document.querySelector('#bioNote').textContent`));
    await click('#btnBioEnroll'); await sleep(2500);
    check('biometric enrolled (PRF record stored, no plaintext)', await evalJs(`!!HamVault.bioInfo() && !!localStorage.getItem('hamlog:vault:bio')`) && !(await allStore()).includes(PW), await evalJs(`document.querySelector('#vaultMsg').textContent`));
    await click('#btnLockNow'); await sleep(300);
    check('locked; Unlock with biometrics shown', await evalJs(`HamVault.isLocked() && !document.querySelector('#btnBioUnlock').hidden`));
    await click('#btnBioUnlock'); await sleep(2500);
    check('biometric unlock restores login', await evalJs(`!HamVault.isLocked() && HamVault.getCreds().qrzPass===${JSON.stringify(PW)}`), await evalJs(`document.querySelector('#vaultMsg').textContent`));
  }
  // 1.2.1: session keys cleared by every way the logins go away
  const KEYQ = `sessionStorage.getItem('hamlog:lookup:qrzkey')`;
  const primeKey = async () => { await evalJs(`HamLookupUI._client.lookup('W1AW',{force:true})`); return evalJs(`${KEYQ}==='"MOCKKEY"'`); };
  check('session key present after unlock + lookup', await primeKey());
  check('auto-lock (idle) locks + clears session key', (await evalJs(`HamLookupUI._checkLock({now: Date.now(), lastActive: Date.now() - 16*60e3, hiddenSince: null})`)) === 'idle' && await evalJs(`HamVault.isLocked() && ${KEYQ}===null`));
  await setv('#vaultUnlockPass', VPASS); await submit('#vaultUnlockForm'); await sleep(2500);
  check('session key present again', await primeKey());
  check('auto-lock (hidden) locks + clears session key', (await evalJs(`HamLookupUI._checkLock({now: Date.now(), lastActive: Date.now(), hiddenSince: Date.now() - 6*60e3})`)) === 'hidden' && await evalJs(`HamVault.isLocked() && ${KEYQ}===null`));
  await setv('#vaultUnlockPass', VPASS); await submit('#vaultUnlockForm'); await sleep(2500);
  check('cache warning visible near Clear lookup cache', await evalJs(`(() => { const n=document.querySelector('#lk-cacheNote'), b=document.querySelector('#lk-clearCache'); return !!n.offsetParent && !!b.offsetParent && /unencrypted/i.test(n.textContent); })()`));
  // encrypted backup
  await setv('#vaultBackupPass', 'backup pass phrase'); await click('#btnVaultExport'); await sleep(2500);
  const bk = fs.readdirSync(DL).filter(f => /hamlog-logins-encrypted/.test(f));
  check('encrypted backup downloaded, no plaintext', bk.length === 1 && !fs.readFileSync(DL + '/' + bk[0], 'utf8').includes(PW) && /hamlog-credentials-backup/.test(fs.readFileSync(DL + '/' + bk[0], 'utf8')));
  check('JSON log backup does not include logins', !(await evalJs(`HamDB.getAll().then(a=>JSON.stringify(a))`)).includes(PW));
  // remove passphrase -> session key cleared (logins become session-only)
  await evalJs(`document.querySelector('#vaultDetails').open=true`);
  check('session key present before remove-passphrase', await primeKey());
  await click('#btnRemovePass'); await sleep(800);
  check('remove passphrase clears session key', await evalJs(`HamVault.credMode()==='session' && ${KEYQ}===null`));
  // forget logins without / with the cache checkbox
  check('session key present before forget', await primeKey());
  const cacheN = () => evalJs(`Object.keys(JSON.parse(localStorage.getItem('hamlog:lookup:cache')||'{}')).length`);
  const n0 = await cacheN();
  await click('#btnForgetCreds'); await sleep(300);
  check('forget clears session key, keeps cache when unchecked', await evalJs(`HamVault.credMode()==='none' && ${KEYQ}===null`) && (await cacheN()) === n0 && n0 > 0, n0);
  await setv('#cr-qrzUser', 'N0CALL'); await setv('#cr-qrzPass', PW); await submit('#qrzCredForm'); await sleep(300);
  await evalJs(`document.querySelector('#lk-forgetCache').checked=true`); await click('#btnForgetCreds'); await sleep(300);
  check('forget with checkbox also clears cache', (await cacheN()) === 0 && await evalJs(`HamVault.credMode()==='none'`));
  await primeKey(); await click('#lk-clearCache'); await sleep(100);
  check('Clear lookup cache button works', (await cacheN()) === 0 && /cleared/.test(await evalJs(`document.querySelector('#lk-cacheMsg').textContent`)));
  // toggle off
  await click('#lk-enabled'); await sleep(100);
  await evalJs(`location.hash='#log'`); await setv('#f-call', 'W1AW'); await sleep(1300);
  check('lookup off: nothing filled, chip hidden', (await val('#f-name')) === '' && await evalJs(`document.querySelector('#lookupChip').hidden`));
  await evalJs(`location.hash='#settings'`); await click('#lk-enabled');
  // offline
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await evalJs(`location.hash='#log'`); await setv('#f-call', 'JA1XYZ'); await sleep(1300);
  check('offline: prefix country, offline chip, no error', (await val('#f-country')) === 'Japan' && /Offline/.test(await evalJs(`document.querySelector('#lookupChip').textContent`)), await evalJs(`document.querySelector('#lookupChip').textContent`));
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // phone widths
  for (const w of [320, 360, 412]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 2, mobile: true });
    await evalJs(`location.hash='#settings'`); await sleep(300);
    await evalJs(`document.querySelector('#vaultDetails').open=true`);
    const wide = await evalJs(`[...document.querySelectorAll('#tab-settings *')].filter(e=>e.offsetParent&&e.getBoundingClientRect().right>${w}+1).slice(0,5).map(e=>e.tagName+'#'+e.id+'.'+e.className+':'+Math.round(e.getBoundingClientRect().right))`);
    check(w + 'px: settings has no horizontal overflow', wide.length === 0, wide);
    await send('Page.captureScreenshot', { format: 'png' }).then(s => fs.writeFileSync(`/tmp/hamlog-shots/lookup-${w}.png`, Buffer.from(s.data, 'base64')));
    await evalJs(`location.hash='#log'`); await sleep(200);
    const wl = await evalJs(`[...document.querySelectorAll('#tab-log *')].filter(e=>e.offsetParent&&e.getBoundingClientRect().right>${w}+1).slice(0,5).map(e=>e.tagName+'#'+e.id+':'+Math.round(e.getBoundingClientRect().right))`);
    check(w + 'px: log form no overflow', wl.length === 0, wl);
  }
  check('no real network to lookup services (all intercepted)', hits.every(u => /qrz|hamqth|callook/.test(u)));

  // navigation through the service worker, incl. /index.html (Cloudflare Pages redirects it to /; 1.3.0 never serves a redirected response)
  for (const u of [APP, APP + 'index.html', APP + '#log']) {
    ld = waitEvent('Page.loadEventFired'); await send('Page.navigate', { url: u }); await ld; await sleep(800);
    check('SW navigation ok: ' + u.replace(APP, '/'), await evalJs(`!!navigator.serviceWorker.controller && !!document.querySelector('#f-call') && !!window.HamLookupUI`));
  }
  check('SW cache holds no redirected response', await evalJs(`caches.keys().then(ks=>Promise.all(ks.map(k=>caches.open(k).then(c=>c.keys().then(rs=>Promise.all(rs.map(r=>c.match(r).then(x=>x.redirected)))))))).then(a=>a.flat().every(x=>!x))`));
  for (let i = problems.length - 1; i >= 0; i--) if (/favicon\.ico|ERR_INTERNET_DISCONNECTED|net::ERR/.test(problems[i])) problems.splice(i, 1);
  console.log('Console/log problems:', problems);
  const fails = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  ws.close(); chrome.kill('SIGKILL'); server.kill();
  process.exit(fails || problems.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log('problems', problems); chrome.kill('SIGKILL'); process.exit(2); });
