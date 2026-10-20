/* HamLog 1.2 – callsign lookup UI + login vault controls. Credentials live only in HamVault (never logged, never in the JSON log backup). */
(function () {
  'use strict';
  const L = window.HamLookup, V = window.HamVault, B = window.HamBio;
  if (!L || !V) return;
  const P = 'hamlog:lookup:';   // namespaced: cannot collide with satpass / garmin-lens on the shared *.github.io origin
  const CFG_DEFAULT = { enabled: true, qrz: true, hamqth: true, callook: true, prefix: true };
  const $ = s => document.querySelector(s);
  let api = null, timer = null, seq = 0, lastActive = Date.now(), hiddenSince = null;
  const js = (st, k, d) => { try { const v = st.getItem(P + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const put = (st, k, v) => { try { if (v == null) st.removeItem(P + k); else st.setItem(P + k, JSON.stringify(v)); } catch (e) { /* storage full/blocked: lookups still work */ } };
  let cfg = Object.assign({}, CFG_DEFAULT, js(localStorage, 'cfg', {}));
  const client = L.createClient({
    fetch: (u, i) => window.fetch(u, i),
    getCreds: () => V.getCreds(),
    cfg: () => cfg,
    store: { get: k => js(localStorage, k, null), set: (k, v) => put(localStorage, k, v) },
    session: { get: k => js(sessionStorage, k, null), set: (k, v) => put(sessionStorage, k, v) },
    agent: 'HamLog-1.2.0', redact: t => V.redact(t)
  });
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const online = () => navigator.onLine !== false;

  function chip(text, kind, title) {
    const c = $('#lookupChip'); if (!c) return;
    if (!text) { c.hidden = true; c.textContent = ''; return; }
    c.hidden = false; c.textContent = text; c.className = 'chip lk-' + (kind || 'info'); c.title = title || '';
  }
  function srcSummary(r) {
    const by = {}; for (const k in r.sources) (by[r.sources[k]] = by[r.sources[k]] || []).push(k === 'grid' ? 'grid' : k);
    return Object.keys(by).map(s => L.LABEL[s].replace(/ \(.*\)/, '') + ': ' + by[s].join(', ')).join(' · ');
  }
  function toForm(r) { const f = r.fields, o = {}, s = {}; const map = { name: 'name', qth: 'qth', state: 'state', country: 'country', grid: 'gridsquare' };
    for (const k in map) if (f[k]) { o[map[k]] = f[k]; s[map[k]] = L.LABEL[r.sources[k]] || 'lookup'; } return { o, s }; }

  async function run(call) {
    const my = ++seq;
    if (V.isLocked() && cfg.qrz) chip('…', 'busy');
    else chip('Looking up ' + call + '…', 'busy');
    const r = await client.lookup(call, { online: online() });
    if (my !== seq || !api) return;
    const { o, s } = toForm(r);
    const filled = api.fillBlanks(call, o, s);
    const locked = V.isLocked() ? ' · logins locked' : '';
    const notes = r.notes.join('\n');
    if (!Object.keys(r.fields).length) chip((r.offline ? 'Offline – no lookup' : 'No lookup data') + locked, 'muted', notes);
    else if (r.offline || (Object.keys(r.sources).every(k => r.sources[k] === 'prefix'))) chip((r.offline ? 'Offline · ' : '') + srcSummary(r) + locked, 'muted', notes);
    else chip((r.cached ? 'Cached · ' : '') + srcSummary(r) + (filled.length ? '' : ' (fields already filled)') + locked, 'ok', notes);
  }
  function onCall(call) {
    clearTimeout(timer); seq++;
    if (!cfg.enabled || !call || call.length < 3 || !/\d/.test(call)) { chip(''); return; }
    timer = setTimeout(() => { run(call).catch(() => chip('')); }, 650);
  }

  /* ---------- settings ---------- */
  function msg(t, bad) { const m = $('#vaultMsg'); if (m) { m.textContent = t || ''; m.classList.toggle('warn', !!bad); } }
  const fail = e => msg(V.redact(e && e.message ? e.message : 'Failed'), true);
  function renderVault() {
    const mode = V.credMode(), c = V.getCreds(), st = $('#vaultStatus');
    const T = { locked: '🔒 Logins are encrypted and locked. Unlock to use QRZ/HamQTH lookups.', encrypted: '🔓 Logins are encrypted on this device (unlocked).',
      session: '⚠ Logins are session-only (this tab). Set a passphrase to keep them encrypted on this device.', 'session-lost': 'Session-only logins were cleared when the tab closed. Enter them again.',
      'legacy-plain': 'Unencrypted logins found – set a passphrase.', none: 'No logins saved. callook.info and the offline prefix table work without one.' };
    st.textContent = T[mode] || '';
    $('#vaultUnlockBox').hidden = mode !== 'locked';
    $('#credBox').hidden = mode === 'locked';
    if (mode !== 'locked') {
      $('#cr-qrzUser').value = c.qrzUser || ''; $('#cr-hamqthUser').value = c.hamqthUser || '';
      $('#cr-qrzPass').value = ''; $('#cr-hamqthPass').value = '';
      $('#cr-qrzPass').placeholder = c.qrzPass ? '•••••• saved' : ''; $('#cr-hamqthPass').placeholder = c.hamqthPass ? '•••••• saved' : '';
    }
    const hp = V.hasPassphrase();
    $('#btnSetPass').textContent = hp ? 'Change passphrase' : 'Encrypt logins with passphrase';
    $('#btnLockNow').disabled = !hp || mode === 'locked'; $('#btnRemovePass').disabled = !hp || mode === 'locked';
    const vc = V.vaultCfg(); $('#vaultIdle').value = String(vc.idleMin); $('#vaultHidden').value = String(vc.hiddenMin);
    if (![...$('#vaultIdle').options].some(o => o.value === String(vc.idleMin))) $('#vaultIdle').add(new Option(vc.idleMin + ' min', vc.idleMin, true, true));
    if (![...$('#vaultHidden').options].some(o => o.value === String(vc.hiddenMin))) $('#vaultHidden').add(new Option(vc.hiddenMin + ' min', vc.hiddenMin, true, true));
    renderBio();
  }
  function renderBio() {
    const note = $('#bioNote'), en = $('#btnBioEnroll'), rm = $('#btnBioRemove'), un = $('#btnBioUnlock');
    en.hidden = rm.hidden = un.hidden = true;
    if (!V.bioAllowed()) { note.textContent = 'Biometric unlock is turned off on ' + location.hostname + ': every GitHub Pages app of this account shares that one origin, so a passkey and its stored key would be reachable by the other apps there. Use your passphrase; a password manager can fill it.'; return; }
    const info = V.bioInfo();
    if (info) { rm.hidden = false; un.hidden = !V.isLocked(); note.textContent = 'Biometric unlock is set up on this device.'; return; }
    note.textContent = '';
    if (!B || !V.hasPassphrase() || V.isLocked()) return;
    B.supported().then(s => { if (s.ok) en.hidden = false; else note.textContent = 'Biometric unlock not available: ' + s.reason + '.'; });
  }
  function renderCfg() {
    for (const k of ['enabled', 'qrz', 'hamqth', 'callook', 'prefix']) $('#lk-' + k).checked = !!cfg[k];
    $('#lk-sources').disabled = !cfg.enabled;
  }

  function saveCreds(form, u, p) {
    return ev => {
      ev.preventDefault();
      const patch = { [u]: $('#cr-' + u).value.trim() }; const pw = $('#cr-' + p).value;
      if (pw) patch[p] = pw; else if (!patch[u]) patch[p] = '';
      V.setCreds(patch).then(() => { client.clearSession(); renderVault(); msg(V.hasPassphrase() ? 'Saved (encrypted).' : 'Saved for this tab only – set a passphrase to keep it.'); }, fail);
    };
  }
  function bind() {
    for (const k of ['enabled', 'qrz', 'hamqth', 'callook', 'prefix']) $('#lk-' + k).addEventListener('change', e => { cfg[k] = e.target.checked; put(localStorage, 'cfg', cfg); renderCfg(); if (!cfg.enabled) chip(''); });
    $('#qrzCredForm').addEventListener('submit', saveCreds('qrz', 'qrzUser', 'qrzPass'));
    $('#hamqthCredForm').addEventListener('submit', saveCreds('hamqth', 'hamqthUser', 'hamqthPass'));
    $('#vaultUnlockForm').addEventListener('submit', ev => { ev.preventDefault(); const i = $('#vaultUnlockPass');
      V.unlock(i.value).then(() => { i.value = ''; msg('Unlocked.'); }, e => { i.value = ''; fail(e); }); });
    $('#vaultPassForm').addEventListener('submit', ev => { ev.preventDefault(); const a = $('#vaultNewPass'), b = $('#vaultNewPass2');
      if (a.value !== b.value) { msg('The two passphrases do not match.', true); return; }
      V.lock(a.value).then(r => { a.value = b.value = ''; msg('Logins encrypted on this device.' + (r.bioRemoved ? ' Biometric unlock was removed; enable it again.' : '')); }, fail); });
    $('#btnLockNow').addEventListener('click', () => { V.lockNow(); client.clearSession(); msg('Locked.'); });
    $('#btnRemovePass').addEventListener('click', () => { if (!confirm('Remove the passphrase? Logins will be kept for this tab only and the encrypted copy is deleted.')) return; V.removePassphrase().then(() => msg('Passphrase removed; logins are session-only.'), fail); });
    $('#btnForgetCreds').addEventListener('click', () => { if (!confirm('Forget all saved logins on this device?')) return; V.forgetCreds(); client.clearSession(); msg('Logins forgotten.'); });
    $('#vaultIdle').addEventListener('change', e => V.setVaultCfg({ idleMin: +e.target.value }));
    $('#vaultHidden').addEventListener('change', e => V.setVaultCfg({ hiddenMin: +e.target.value }));
    $('#btnBioEnroll').addEventListener('click', () => { B.enroll().then(m => { const prf = m.prf; delete m.prf; return V.bioSave(m, prf); }).then(() => msg('Biometric unlock enabled.'), fail); });
    $('#btnBioRemove').addEventListener('click', () => { V.bioRemove(); msg('Biometric unlock removed.'); });
    $('#btnBioUnlock').addEventListener('click', () => { V.bioUnlock(rec => B.assertPrf(rec)).then(() => msg('Unlocked.'), fail); });
    $('#btnVaultExport').addEventListener('click', () => { const i = $('#vaultBackupPass');
      V.exportBackup(i.value).then(text => { i.value = ''; api.downloadText(text, 'hamlog-logins-encrypted-' + api.fileStamp() + '.json', 'application/json'); msg('Encrypted backup saved.'); }, fail); });
    $('#vaultImport').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const i = $('#vaultBackupPass');
      f.text().then(t => V.importBackup(t, i.value, info => confirm('Replace ' + info.overwrites.length + ' saved login field(s) with the backup?'))).then(r => { i.value = ''; client.clearSession(); msg('Imported ' + r.imported + ' login field(s).'); }, fail); });
    $('#lk-testBtn').addEventListener('click', async () => { const call = String($('#lk-testCall').value || '').toUpperCase().trim(); if (!call) return;
      const out = $('#lk-testOut'); out.textContent = 'Looking up…';
      const r = await client.lookup(call, { online: online(), force: true });
      const rows = Object.keys(r.fields).map(k => '<div><b>' + esc(k) + '</b>: ' + esc(r.fields[k]) + ' <span class="muted">(' + esc(L.LABEL[r.sources[k]]) + ')</span></div>');
      out.innerHTML = (rows.join('') || '<div>No data.</div>') + (r.notes.length ? '<div class="muted">' + r.notes.map(esc).join('<br>') + '</div>' : ''); });
    $('#lk-clearCache').addEventListener('click', () => { put(localStorage, 'cache', null); msg('Lookup cache cleared.'); });
    // auto-lock
    ['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, () => { lastActive = Date.now(); }, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => { hiddenSince = document.hidden ? Date.now() : null; checkLock(); });
    setInterval(checkLock, 15000);
  }
  function checkLock() {
    if (V.isLocked() || !V.hasPassphrase()) return;
    if (V.lockDue({ now: Date.now(), lastActive, hiddenSince })) { V.lockNow(); client.clearSession(); }
  }

  function init(a) {
    api = a; renderCfg(); bind(); renderVault();
    V.onChange(renderVault);
    if (V.credMode() === 'legacy-plain') V.dropPlaintextCopy();
  }
  window.HamLookupUI = { init, onCall, _client: client, _checkLock: checkLock };
})();
