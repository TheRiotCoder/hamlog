// Field tab (contest / POTA / SOTA) + v1->v2 migration smoke test, headless Chrome over raw CDP (no npm deps). Needs google-chrome + python3 on PATH.
// Run from anywhere: node --experimental-websocket tests/browser-smoke.js   (Node 22+: flag not needed)
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const PORT = 9334, APP = process.env.HAMLOG_URL || 'http://localhost:8766/';
fs.mkdirSync('/tmp/hamlog-shots', { recursive: true });
const DL = '/tmp/hamlog-dl2'; fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
fs.rmSync('/tmp/chrome-hamlog2', { recursive: true, force: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], { cwd: require('path').join(__dirname, '..'), stdio: 'ignore' });
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-hamlog2', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

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
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*xmldata.qrz.com*', '*hamqth.com*', '*callook.info*'] }); // 1.2 lookup: keep these runs offline-deterministic (lookup must fail silently) await send('DOM.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }).catch(() => send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });


  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const setv = (sel, v) => evalJs(`(() => { const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const click = sel => evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const key = async (k, code, vk, text) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
  const type = async t => { await send('Input.insertText', { text: t }); await sleep(60); };
  const newFiles = (() => { let seen = new Set(); return ext => { const f = fs.readdirSync(DL).filter(x => x.endsWith(ext) && !seen.has(x)); f.forEach(x => seen.add(x)); return f; }; })();

  // ---- 1. MIGRATION: build a HamLog 1.0 (IndexedDB v1) database first, then load 1.1 ----
  let ld = waitEvent('Page.loadEventFired'); await send('Page.navigate', { url: APP + 'icons/favicon-32.png' }); await ld; await sleep(300);
  const OLD = [
    { id: 'old-1', call: 'W5OLD', qso_date: '20250101', time_on: '120000', band: '40m', freq: '7.2', mode: 'SSB', submode: '', rst_sent: '59', rst_rcvd: '57', name: 'Old Timer', qth: '', state: 'LA', country: '', gridsquare: 'EM40', comment: 'from 1.0', station_callsign: 'K5TEST', operator: '', my_gridsquare: 'EM20ab', tx_pwr: '100', extra: { DXCC: '291' }, created: '2025-01-01T12:00:00Z', updated: '2025-01-01T12:00:00Z', uploaded_qrz: '2025-01-02T00:00:00Z' },
    { id: 'old-2', call: 'DL1OLD', qso_date: '20250102', time_on: '130000', band: '20m', freq: '', mode: 'CW', submode: '', rst_sent: '599', rst_rcvd: '599', name: '', qth: '', state: '', country: 'Germany', gridsquare: '', comment: '', station_callsign: 'K5TEST', operator: '', my_gridsquare: '', tx_pwr: '', extra: {}, created: '2025-01-02T13:00:00Z', updated: '2025-01-02T13:00:00Z', uploaded_qrz: null }
  ];
  await evalJs(`new Promise((res, rej) => { const r = indexedDB.open('hamlog', 1);
    r.onupgradeneeded = () => { const db = r.result; const s = db.createObjectStore('qsos', { keyPath: 'id' }); s.createIndex('call','call'); s.createIndex('qso_date','qso_date'); db.createObjectStore('meta', { keyPath: 'key' }); };
    r.onsuccess = () => { const db = r.result; const t = db.transaction(['qsos','meta'], 'readwrite');
      ${JSON.stringify(OLD)}.forEach(q => t.objectStore('qsos').put(q));
      t.objectStore('meta').put({ key: 'settings', value: { my_call: 'K5TEST', my_grid: 'EM20ab', operator: '', tx_pwr: '100', theme: 'auto', autofill_prev: true } });
      t.objectStore('meta').put({ key: 'lastUpload', value: { at: '2025-01-02T00:00:00Z', count: 1 } });
      t.oncomplete = () => { db.close(); res(true); }; t.onerror = () => rej(t.error); }; r.onerror = () => rej(r.error); })`);
  ld = waitEvent('Page.loadEventFired'); await send('Page.navigate', { url: APP + '#log' }); await ld; await sleep(1500);
  check('migration: DB upgraded to v2 with sessions store', await evalJs(`HamDB.open().then(db => db.version + ':' + [...db.objectStoreNames].sort().join(','))`) === '2:meta,qsos,sessions');
  check('migration: upgradedFrom = 1', await evalJs(`HamDB.upgradedFrom()`) === 1);
  check('migration: 1.0 QSOs intact, field for field', await evalJs(`HamDB.getAll().then(a => JSON.stringify(a.sort((x,y)=>x.id<y.id?-1:1)))`) === JSON.stringify(OLD));
  check('migration: settings + upload history kept', await evalJs(`Promise.all([HamDB.getMeta('settings'), HamDB.getMeta('lastUpload')]).then(([s,u]) => s.my_call==='K5TEST' && u.count===1)`));
  check('migration: old QSOs shown in logbook', await evalJs(`document.querySelector('#countBadge').textContent`) === '2');
  check('CSP meta present', (await evalJs(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`)).includes("script-src 'self'"));

  // ---- 2. CONTEST: ARRL Sweepstakes, keyboard-first ----
  await evalJs(`location.hash='#ops'`); await sleep(300);
  check('Field tab visible', await evalJs(`!document.querySelector('#tab-ops').hidden`));
  await setv('#o-type', 'CONTEST'); await setv('#o-contest', 'ARRL-SS'); await setv('#o-exch', 'a 79 la'); await setv('#o-loc', 'LA');
  await click('#o-start'); await sleep(400);
  check('contest session started', await evalJs(`!document.querySelector('#o-form').hidden && document.querySelector('#o-sent').textContent`) === '1 A 79 LA');
  await setv('#o-band', '20m'); await setv('#o-mode', 'CW');
  await evalJs(`document.querySelector('#o-call').focus()`);
  await type('w1aw'); await key(' ', 'Space', 32, ' '); await sleep(100);
  check('Space in call jumps to exchange', await evalJs(`document.activeElement.id`) === 'o-rcvd');
  await type('43 M 31 CT'); await key('Enter', 'Enter', 13, '\r'); await sleep(600);
  check('Enter logged contest QSO', await evalJs(`HamDB.getAll().then(a => { const q = a.find(x => x.call==='W1AW'); return q && [q.contest_id, q.stx, q.stx_string, q.srx, q.srx_string, q.band, q.mode].join('|'); })`) === 'ARRL-SS-CW|1|A 79 LA|43|M 31 CT|20m|CW');
  check('serial auto-incremented', await evalJs(`document.querySelector('#o-sent').textContent`) === '2 A 79 LA');
  check('focus back on call', await evalJs(`document.activeElement.id`) === 'o-call');
  await type('n5ko'); await key('Enter', 'Enter', 13, '\r'); await sleep(100);
  check('Enter with empty exchange jumps to exchange', await evalJs(`document.activeElement.id`) === 'o-rcvd');
  await type('3 B 74 STX'); await key('Enter', 'Enter', 13, '\r'); await sleep(600);
  check('second contest QSO stx=2', await evalJs(`HamDB.getAll().then(a => a.find(x=>x.call==='N5KO').stx)`) === '2');
  await evalJs(`document.querySelector('#o-call').focus()`); await type('W1AW');
  await setv('#o-band', '40m'); await sleep(150);
  check('real-time dupe: SS counts each station once (other band)', (await evalJs(`document.querySelector('#o-dupe').textContent`)).startsWith('DUPE'));
  await evalJs(`document.querySelector('#o-rcvd').value='44 M 31 CT'`);
  dialogAccept = false; await evalJs(`document.querySelector('#o-form').requestSubmit()`); await sleep(500); dialogAccept = true;
  check('dupe confirm shown; declining does not save', dialogs.some(d => d.includes('DUPE: W1AW')) && await evalJs(`HamDB.getAll().then(a=>a.filter(x=>x.call==='W1AW').length)`) === 1);
  await key('Escape', 'Escape', 27); await sleep(100);
  check('Esc clears entry', await evalJs(`document.querySelector('#o-call').value + document.querySelector('#o-rcvd').value`) === '');
  await type('K5NEW'); await sleep(100);
  check('new station shows New', (await evalJs(`document.querySelector('#o-dupe').textContent`)).includes('New'));
  await evalJs(`document.querySelector('#o-rcvd').value='9 Z 99'`); await evalJs(`document.querySelector('#o-form').requestSubmit()`); await sleep(300);
  check('bad exchange rejected with message', await evalJs(`!document.querySelector('#o-err').hidden`) && await evalJs(`HamDB.getAll().then(a=>a.some(x=>x.call==='K5NEW'))`) === false);
  await key('Escape', 'Escape', 27);
  const statTxt = await evalJs(`[...document.querySelectorAll('#o-stats .stat')].map(e => e.querySelector('b').textContent + ' ' + e.querySelector('span').textContent).join(' | ')`);
  check('running QSO / mult / rate / estimate', /2 QSOs/.test(statTxt) && /2 sections/.test(statTxt) && /2 QSOs last 60 min/.test(statTxt) && /8 est. score/.test(statTxt), statTxt);
  check('approximate scoring disclosed', (await evalJs(`document.querySelector('#o-note').textContent`)).startsWith('Approximate'));
  await click('#o-expCab'); await sleep(1200);
  let f = newFiles('.log'); check('Cabrillo downloaded', f.length === 1, f);
  if (f.length) {
    const t = fs.readFileSync(DL + '/' + f[0], 'utf8'); fs.copyFileSync(DL + '/' + f[0], '/tmp/hamlog-shots/sample.cabrillo.log');
    const q = t.split('\r\n').filter(l => l.startsWith('QSO:'));
    check('Cabrillo content', t.startsWith('START-OF-LOG: 3.0') && t.includes('CONTEST: ARRL-SS-CW') && t.includes('CALLSIGN: K5TEST') && t.includes('LOCATION: LA') &&
      q.length === 2 && /K5TEST\s+1 A 79 LA W1AW\s+43 M 31 CT$/.test(q[0]) && /K5TEST\s+2 A 79 LA N5KO\s+3 B 74 STX$/.test(q[1]) && t.trim().endsWith('END-OF-LOG:'), q);
  }
  await click('#o-expAdif'); await sleep(1200);
  f = newFiles('.adi'); check('contest ADIF downloaded', f.length === 1, f);
  if (f.length) { const t = fs.readFileSync(DL + '/' + f[0], 'utf8'); check('contest ADIF fields', t.includes('<CONTEST_ID:10>ARRL-SS-CW') && t.includes('<STX:1>1') && t.includes('<SRX:2>43') && t.includes('<STX_STRING:7>A 79 LA') && t.includes('<SRX_STRING:7>M 31 CT') && !t.includes('W5OLD')); }
  await click('#o-end'); await sleep(400);
  check('session ended (QSOs stay in log)', await evalJs(`document.querySelector('#o-form').hidden`) && await evalJs(`HamDB.getAll().then(a=>a.length)`) === 4);

  // ---- 3. POTA activation ----
  await setv('#o-type', 'POTA'); await setv('#o-myref', 'us0001');
  await click('#o-start'); await sleep(300);
  check('invalid park rejected', (await evalJs(`document.querySelector('#o-setupErr').textContent`)).includes('not a valid POTA park'));
  await setv('#o-myref', 'us-0001'); await click('#o-start'); await sleep(2500);
  check('POTA session started', await evalJs(`!document.querySelector('#o-form').hidden && !document.querySelector('#o-actEntry').hidden`));
  const refInfo = await evalJs(`document.querySelector('#o-refInfo').textContent`);
  check('park name lookup (public API, CORS) or graceful offline note', /US-0001: (Acadia|.*lookup failed)/.test(refInfo), refInfo);
  await setv('#o-mode', 'SSB');
  await evalJs(`document.querySelector('#o-call').focus()`); await type('kb2fmh'); await key('Enter', 'Enter', 13, '\r'); await sleep(600);
  check('activator Enter logs directly (their park optional)', await evalJs(`HamDB.getAll().then(a => { const q=a.find(x=>x.call==='KB2FMH'); return q && [q.my_sig, q.my_sig_info, q.rst_sent, q.sig_info||''].join('|'); })`) === 'POTA|US-0001|59|');
  await type('N0P2P'); await key(' ', 'Space', 32, ' '); await type('us-1234, US-5678'); await sleep(100);
  check('park-to-park flag shown', (await evalJs(`document.querySelector('#o-flag').textContent`)).includes('Park-to-park'));
  await key('Enter', 'Enter', 13, '\r'); await sleep(600);
  check('2-fer P2P saved as one entry per park', await evalJs(`HamDB.getAll().then(a => a.filter(x=>x.call==='N0P2P').map(x=>x.sig + ':' + x.sig_info).sort().join(','))`) === 'POTA:US-1234,POTA:US-5678');
  check('activation progress 3/10', (await evalJs(`document.querySelector('#o-stats').textContent`)).includes('3/10'));
  await click('#o-expPota'); await sleep(1500);
  f = newFiles('.adi'); check('POTA file named CALL@PARK-YYYYMMDD.adi', f.length === 1 && f[0] === 'K5TEST@US-0001-' + today + '.adi', f);
  if (f.length) { const t = fs.readFileSync(DL + '/' + f[0], 'utf8'); fs.copyFileSync(DL + '/' + f[0], '/tmp/hamlog-shots/sample-pota.adi');
    check('POTA ADIF fields', (t.match(/<MY_SIG:4>POTA/g) || []).length === 3 && (t.match(/<MY_SIG_INFO:7>US-0001/g) || []).length === 3 && t.includes('<SIG:4>POTA<') === false && t.includes('<SIG_INFO:7>US-1234') && t.includes('<SIG_INFO:7>US-5678') && t.includes('<STATION_CALLSIGN:6>K5TEST') && !t.includes('W1AW')); }
  await click('#o-end'); await sleep(300);

  // ---- 4. SOTA activation + CSV ----
  await setv('#o-type', 'SOTA'); await setv('#o-myref', 'w7w/lc-001'); await click('#o-start'); await sleep(2500);
  await setv('#o-mode', 'CW'); await setv('#o-band', '40m');
  await evalJs(`document.querySelector('#o-call').focus()`); await type('G3WGV'); await key(' ', 'Space', 32, ' '); await type('g/ld-008'); await key('Enter', 'Enter', 13, '\r'); await sleep(600);
  check('S2S saved with MY_SOTA_REF/SOTA_REF', await evalJs(`HamDB.getAll().then(a => { const q=a.find(x=>x.call==='G3WGV'); return q && q.my_sota_ref + '|' + q.sota_ref; })`) === 'W7W/LC-001|G/LD-008');
  const sst = await evalJs(`document.querySelector('#o-stats').textContent`);
  check('SOTA progress 1/4 + summit points shown', sst.includes('1/4') && /summit points/.test(sst), sst.replace(/\s+/g, ' '));
  await click('#o-expSota'); await sleep(1200);
  f = newFiles('.csv'); check('SOTA CSV downloaded', f.length === 1, f);
  if (f.length) { const t = fs.readFileSync(DL + '/' + f[0], 'utf8'); check('SOTA CSV V2 line', new RegExp('^V2,K5TEST,W7W/LC-001,\\d\\d/\\d\\d/\\d\\d,\\d{4},7MHz,CW,G3WGV,G/LD-008,\\r\\n$').test(t), t); }

  // ---- 5. phone widths: overflow + tap targets on the Field tab ----
  for (const w of [320, 360, 390, 412]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 2, mobile: true }); await sleep(300);
    await evalJs(`location.hash='#ops'; window.scrollTo(0,0)`); await sleep(200);
    const r = await evalJs(`(() => { const over = document.documentElement.scrollWidth > window.innerWidth + 1;
      const small = [...document.querySelectorAll('#tab-ops button, #tab-ops input, #tab-ops select, .tabs button')].filter(e => e.offsetParent && e.type !== 'checkbox')
        .map(e => { const b = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0,12), Math.round(b.width), Math.round(b.height)]; }).filter(x => x[1] < 44 || x[2] < 44);
      return { over, sw: document.documentElement.scrollWidth, small }; })()`);
    check(`${w}px: no horizontal overflow, all tap targets >= 44px`, !r.over && r.small.length === 0, r);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(`/tmp/hamlog-shots/field-${w}.png`, Buffer.from(shot.data, 'base64'));
  }
  // session persists across reload
  ld = waitEvent('Page.loadEventFired'); await send('Page.reload', {}); await ld; await sleep(1200);
  await evalJs(`location.hash='#ops'`); await sleep(300);
  check('active session survives reload', (await evalJs(`document.querySelector('#o-activePill').textContent`)).includes('W7W/LC-001'));
  // ---- 6. offline ----
  server.kill('SIGKILL'); await sleep(400);
  const before = problems.length;
  ld = waitEvent('Page.loadEventFired'); await send('Page.reload', {}); await ld; await sleep(1200);
  check('offline: Field tab + field.js/ops.js from cache', await evalJs(`!!window.HamField && !!window.HamOps && !!document.querySelector('#o-call')`));
  await evalJs(`location.hash='#ops'`); await sleep(200);
  await evalJs(`document.querySelector('#o-call').focus()`); await type('K7OFF'); await key('Enter', 'Enter', 13, '\r'); await sleep(600);
  check('offline: logging still works', await evalJs(`HamDB.getAll().then(a=>a.some(x=>x.call==='K7OFF' && x.my_sota_ref==='W7W/LC-001'))`));
  check('total QSOs (2 old + 2 contest + 3 POTA + 2 SOTA), old ones untouched', await evalJs(`HamDB.getAll().then(a => a.length===9 && JSON.stringify(a.filter(x=>x.id.startsWith('old-')).sort((x,y)=>x.id<y.id?-1:1))===${JSON.stringify(JSON.stringify(OLD))})`));

  console.log('\nDialogs:', dialogs);
  // the migration step opens a PNG directly, so Chrome asks for /favicon.ico once; that 404 is expected
  for (let i = problems.length - 1; i >= 0; i--) if (/favicon\.ico|inline style.*favicon-32\.png/.test(problems[i])) problems.splice(i, 1);
  console.log('Console/log problems (online):', problems.slice(0, before));
  console.log('Console/log problems (offline phase):', problems.slice(before));
  const fails = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  ws.close(); chrome.kill('SIGKILL'); server.kill();
  process.exit(fails || problems.slice(0, before).length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log('problems', problems); chrome.kill('SIGKILL'); process.exit(2); });
