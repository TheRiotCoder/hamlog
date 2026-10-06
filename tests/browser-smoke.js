// Headless Chrome smoke test over raw CDP (no npm deps). Needs google-chrome + python3 on PATH.
// Run from anywhere: node --experimental-websocket tests/browser-smoke.js   (Node 22+: flag not needed)
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const PORT = 9333, APP = 'http://localhost:8765/';
fs.mkdirSync('/tmp/hamlog-shots', { recursive: true });
const DL = '/tmp/hamlog-dl'; fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
fs.rmSync('/tmp/chrome-hamlog', { recursive: true, force: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: require('path').join(__dirname, '..'), stdio: 'ignore' });
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-hamlog', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

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

  // 1. first load
  let ld = waitEvent('Page.loadEventFired'); await send('Page.navigate', { url: APP }); await ld; await sleep(1500);
  check('title', (await evalJs('document.title')).includes('HamLog'));
  check('modules loaded', await evalJs('!!(window.HamData && window.Adif && window.HamDB)'));
  check('SW active', await evalJs('navigator.serviceWorker.ready.then(r => !!r.active)'));
  check('manifest link + parse', await evalJs(`fetch('manifest.webmanifest').then(r=>r.json()).then(m=>m.icons.length===3 && m.display==='standalone')`));
  check('icons reachable', await evalJs(`Promise.all(['icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png'].map(u=>fetch(u).then(r=>r.ok && r.headers.get('content-type').includes('png')))).then(a=>a.every(Boolean))`));
  check('date/time auto-filled UTC', await evalJs(`(() => { const d = document.querySelector('#f-date').value, t = document.querySelector('#f-time').value; const n = new Date().toISOString(); return d === n.slice(0,10) && /^\\d\\d:\\d\\d:\\d\\d$/.test(t); })()`));
  check('default RST SSB 59', await evalJs(`document.querySelector('#f-rst_sent').value`) === '59', await evalJs(`document.querySelector('#f-mode').value`));

  // 2. settings
  await evalJs(`(() => { location.hash='#settings'; const s = (id,v) => { const e=document.querySelector(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); }; s('#s-my_call','k5test'); s('#s-my_grid','em20ab'); s('#s-tx_pwr','100'); document.querySelector('#settingsForm').requestSubmit(); })()`);
  await sleep(500);
  check('settings saved', await evalJs(`document.querySelector('#stationBadge').textContent`) === 'de K5TEST');

  // 3. log a QSO via keyboard-ish flow (type call, set freq, change mode, press Enter)
  await evalJs(`location.hash='#log'`); await sleep(200);
  await evalJs(`(() => { const set=(id,v)=>{const e=document.querySelector(id); e.focus(); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}; 
    set('#f-call','w1abc'); set('#f-freq','14074'); document.querySelector('#f-freq').dispatchEvent(new Event('blur'));
    const m=document.querySelector('#f-mode'); m.value='FT4'; m.dispatchEvent(new Event('change',{bubbles:true})); set('#f-name','Joe'); })()`);
  check('call uppercased', await evalJs(`document.querySelector('#f-call').value`) === 'W1ABC');
  check('kHz -> MHz + band derived', await evalJs(`document.querySelector('#f-freq').value + ' ' + document.querySelector('#f-band').value`) === '14.074 20m');
  check('RST switched to -10 for FT4', await evalJs(`document.querySelector('#f-rst_sent').value`) === '-10');
  check('time stamped on typing', await evalJs(`document.querySelector('#timeMode').textContent`) === 'set');
  // press Enter in the name field
  await evalJs(`document.querySelector('#f-name').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(600);
  check('Enter saved QSO', await evalJs(`document.querySelectorAll('#recentList .qso').length`) === 1);
  check('form reset, band/freq/mode remembered', await evalJs(`[document.querySelector('#f-call').value, document.querySelector('#f-band').value, document.querySelector('#f-freq').value, document.querySelector('#f-mode').value].join('|')`) === '|20m|14.074|FT4');
  check('saved in IndexedDB', await evalJs(`HamDB.getAll().then(a => a.length===1 && a[0].call==='W1ABC' && a[0].mode==='MFSK' && a[0].submode==='FT4' && a[0].station_callsign==='K5TEST')`));

  // 4. dupe warning + confirm (decline)
  await evalJs(`(() => { const e=document.querySelector('#f-call'); e.value='W1ABC'; e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  check('dupe warning shown', await evalJs(`!!document.querySelector('#callInfo .dupe')`));
  check('name pre-filled from previous QSO', await evalJs(`document.querySelector('#f-name').value`) === 'Joe');
  dialogAccept = false;
  await evalJs(`document.querySelector('#qsoForm').requestSubmit()`); await sleep(500);
  check('dupe confirm shown and declining does not save', dialogs.some(d => d.includes('Possible duplicate')) && await evalJs(`HamDB.getAll().then(a=>a.length)`) === 1);
  dialogAccept = true;
  // second distinct QSO on CW
  await evalJs(`(() => { const set=(id,v)=>{const e=document.querySelector(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}; set('#f-call','ve3xyz'); const m=document.querySelector('#f-mode'); m.value='CW'; m.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#qsoForm').requestSubmit(); })()`);
  await sleep(500);
  check('second QSO (CW, RST 599)', await evalJs(`HamDB.getAll().then(a => a.length===2 && a.some(q=>q.call==='VE3XYZ' && q.rst_sent==='599'))`));

  // 5. list search
  await evalJs(`location.hash='#list'`); await sleep(300);
  check('list shows 2, newest first', await evalJs(`[...document.querySelectorAll('#qsoList .q-call')].map(e=>e.textContent).join(',')`) === 'VE3XYZ,W1ABC');
  await evalJs(`(() => { const s=document.querySelector('#search'); s.value='joe'; s.dispatchEvent(new Event('input')); })()`); await sleep(300);
  check('search filters', await evalJs(`document.querySelectorAll('#qsoList .qso').length`) === 1);
  await evalJs(`(() => { const s=document.querySelector('#search'); s.value=''; s.dispatchEvent(new Event('input')); })()`); await sleep(300);
  // edit
  await evalJs(`document.querySelector('#qsoList [data-act=edit]').click()`); await sleep(300);
  check('edit opens form', await evalJs(`document.querySelector('#formTitle').textContent + '|' + document.querySelector('#f-call').value`) === 'Edit QSO|VE3XYZ');
  await evalJs(`(() => { const e=document.querySelector('#f-comment'); e.value='edited'; document.querySelector('#qsoForm').requestSubmit(); })()`); await sleep(500);
  check('edit saved & returned to list', await evalJs(`HamDB.getAll().then(a => a.length===2 && a.some(q=>q.comment==='edited')) .then(ok => ok && location.hash==='#list')`));

  // 6. QRZ export (download path) + mark uploaded
  await evalJs(`location.hash='#export'`); await sleep(300);
  check('2 new to upload', await evalJs(`document.querySelector('#newCount').textContent`) === '2');
  await evalJs(`document.querySelector('#btnDownloadNew').click()`); await sleep(1500);
  const files = fs.readdirSync(DL).filter(f => f.endsWith('.adi'));
  check('ADIF downloaded', files.length === 1, files);
  if (files.length) {
    const t = fs.readFileSync(DL + '/' + files[0], 'utf8');
    fs.copyFileSync(DL + '/' + files[0], '/tmp/hamlog-shots/sample-export.adi');
    check('ADIF content', t.includes('<EOH>') && t.includes('<CALL:5>W1ABC') && t.includes('<MODE:4>MFSK') && t.includes('<SUBMODE:3>FT4') &&
      t.includes('<STATION_CALLSIGN:6>K5TEST') && t.includes('<MY_GRIDSQUARE:6>EM20ab') && (t.match(/<EOR>/g) || []).length === 2);
  }
  check('mark button enabled', await evalJs(`!document.querySelector('#btnMarkUploaded').disabled`));
  await evalJs(`document.querySelector('#btnMarkUploaded').click()`); await sleep(500);
  check('marked uploaded -> 0 new', await evalJs(`document.querySelector('#newCount').textContent`) === '0' && await evalJs(`HamDB.getAll().then(a=>a.every(q=>q.uploaded_qrz))`));

  // 7. ADIF import via file input
  fs.writeFileSync('/tmp/import-test.adi', 'test\n<ADIF_VER:5>3.1.4<EOH>\n<CALL:5>G4ABC<QSO_DATE:8>20250101<TIME_ON:4>1200<BAND:3>40m<MODE:3>SSB<EOR>\n<CALL:5>W1ABC<QSO_DATE:8>' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '<TIME_ON:4>0000<BAND:3>20m<MODE:3>FT4<EOR>\n');
  await evalJs(`location.hash='#settings'`); await sleep(200);
  const doc = await send('DOM.getDocument', {}); const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#importAdif' });
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: ['/tmp/import-test.adi'] }); await sleep(800);
  check('ADIF import', await evalJs(`HamDB.getAll().then(a=>a.length)`) === 4, await evalJs(`document.querySelector('#importResult').textContent`));

  // 8. delete with confirm
  await evalJs(`location.hash='#list'`); await sleep(300);
  await evalJs(`document.querySelector('#qsoList [data-act=del]').click()`); await sleep(500);
  check('delete with confirm', dialogs.some(d => d.startsWith('confirm: Delete QSO')) && await evalJs(`HamDB.getAll().then(a=>a.length)`) === 3);

  check('installable: beforeinstallprompt fired (Install button visible)', await evalJs(`!document.querySelector('#btnInstall').hidden`));
  // time field accepts HHMM typing
  await evalJs(`location.hash='#log'`);
  await evalJs(`(() => { const t=document.querySelector('#f-time'); t.focus(); t.value='1423'; t.dispatchEvent(new Event('input',{bubbles:true})); t.blur(); })()`);
  check('time "1423" normalized to 14:23:00 (manual mode)', await evalJs(`document.querySelector('#f-time').value + '|' + document.querySelector('#timeMode').textContent`) === '14:23:00|manual');
  await evalJs(`document.querySelector('#btnClear').click()`);
  await sleep(3000);
  // dark-mode screenshots
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  for (const tab of ['log', 'list', 'export']) {
    await evalJs(`location.hash='#${tab}'`); await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`/tmp/hamlog-shots/shot-${tab}-dark.png`, Buffer.from(shot.data, 'base64'));
  }
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await evalJs(`location.hash='#log'`); await sleep(400);
  fs.writeFileSync('/tmp/hamlog-shots/shot-log-desktop-light.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  // 9. offline: stop the web server and reload
  server.kill('SIGKILL');
  await sleep(500);
  const before = problems.length;
  ld = waitEvent('Page.loadEventFired'); await send('Page.reload', { ignoreCache: false }); await ld; await sleep(1200);
  check('offline reload works (server stopped)', await evalJs(`!!document.querySelector('#qsoForm') && !!window.Adif`) && await evalJs(`HamDB.getAll().then(a=>a.length)`) === 3);
  check('SW controls page', await evalJs(`!!navigator.serviceWorker.controller`));
  const offlineProblems = problems.slice(before);

  console.log('\nDialogs:', dialogs);
  console.log('Console/log problems (online):', problems.slice(0, before));
  console.log('Console/log problems (offline phase):', offlineProblems);
  const fails = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  ws.close(); chrome.kill('SIGKILL'); server.kill();
  process.exit(fails || problems.slice(0, before).length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log('problems', problems); chrome.kill('SIGKILL'); process.exit(2); });
