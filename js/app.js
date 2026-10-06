/* HamLog – UI controller. Depends on HamData, Adif, HamDB (loaded before this file). */
(function () {
  'use strict';
  const H = window.HamData, A = window.Adif, DB = window.HamDB;
  const APP_VERSION = '1.0.0';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const DEFAULT_SETTINGS = { my_call: '', my_grid: '', operator: '', tx_pwr: '', theme: 'auto', autofill_prev: true };
  const PREFILL_FIELDS = ['name', 'qth', 'state', 'country', 'gridsquare'];
  const LIST_PAGE = 100;

  const state = {
    qsos: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    last: { band: '20m', freq: '', modeKey: 'SSB' },
    pending: null,      // { ids, filename, at, which } – last export awaiting "mark as uploaded"
    lastUpload: null,   // { at, count }
    editingId: null,
    returnTab: 'log',
    timeMode: 'live',   // live | stamped | manual
    rstAuto: { sent: true, rcvd: true },
    prefilled: {},
    listLimit: LIST_PAGE,
    deferredInstall: null,
    storageOk: true,
    updating: false
  };

  /* ---------------- utilities ---------------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256 | 0; });
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(d) { return H.adifToDateInput(d) || d || ''; }
  function fmtTime(t) { return t ? String(t).slice(0, 2) + ':' + String(t).slice(2, 4) : ''; }
  function fileStamp() {
    const p = H.nowUtcParts(new Date());
    return p.date.replace(/-/g, '') + '-' + p.time.slice(0, 5).replace(':', '') + 'Z';
  }
  function fmtLocal(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  const isTouch = () => window.matchMedia && matchMedia('(pointer: coarse)').matches;

  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 5000 : 2800);
  }
  function storageError(err) {
    state.storageOk = false;
    const el = $('#storageError');
    el.textContent = 'Storage problem: ' + (err && err.message ? err.message : err) +
      '. Your QSOs may not be saved (private browsing mode can block storage).';
    el.hidden = false;
  }

  /* ---------------- file output: Web Share with files, fallback download ---------------- */
  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 10000);
  }
  /** Must be called synchronously from a click handler (no awaits before it) so share keeps user activation. */
  async function shareOrDownload(text, filename, preferShare, shareMime) {
    if (preferShare && navigator.canShare && navigator.share && typeof File === 'function') {
      let file = null;
      try { file = new File([text], filename, { type: shareMime || 'text/plain' }); } catch (e) { file = null; }
      if (file && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return 'shared';
        } catch (e) {
          if (e && e.name === 'AbortError') return 'cancelled';
          // NotAllowedError etc. -> fall back to download
        }
      }
    }
    downloadText(text, filename);
    return 'downloaded';
  }

  /* ---------------- tabs ---------------- */
  const TABS = ['log', 'list', 'export', 'settings'];
  function showTab(name, opts) {
    if (TABS.indexOf(name) < 0) name = 'log';
    for (const t of TABS) $('#tab-' + t).hidden = t !== name;
    $$('.tab-btn').forEach(b => { if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (name === 'list') renderList();
    if (name === 'export') renderExport();
    if (name === 'settings') renderSettingsInfo();
    if (!(opts && opts.noScroll)) window.scrollTo(0, 0);
  }

  /* ---------------- form refs ---------------- */
  const F = {};
  ['call', 'date', 'time', 'band', 'freq', 'mode', 'rst_sent', 'rst_rcvd', 'name', 'qth', 'state', 'country', 'gridsquare',
    'comment', 'station_callsign', 'operator', 'my_gridsquare', 'tx_pwr', 'uploaded'].forEach(k => { F[k] = document.getElementById('f-' + k); });
  const form = $('#qsoForm');

  function fillSelects() {
    F.band.innerHTML = '<option value="">Band…</option>' + H.BANDS.map(b => `<option value="${b.band}">${b.band}</option>`).join('');
    const groups = {};
    for (const m of H.MODES) (groups[m.group] = groups[m.group] || []).push(m);
    F.mode.innerHTML = Object.keys(groups).map(g =>
      `<optgroup label="${g}">` + groups[g].map(m => `<option value="${m.key}">${esc(m.label)}</option>`).join('') + '</optgroup>').join('');
    $('#filterBand').innerHTML = '<option value="">All bands</option>' + H.BANDS.map(b => `<option value="${b.band}">${b.band}</option>`).join('');
  }

  function currentModePair() {
    const v = F.mode.value || '';
    if (v.indexOf('custom|') === 0) { const p = v.split('|'); return { mode: p[1] || '', submode: p[2] || '' }; }
    const m = H.modeByKey(v);
    return m ? { mode: m.mode, submode: m.submode } : { mode: '', submode: '' };
  }
  function removeCustomModes() { $$('option[data-custom]', F.mode).forEach(o => o.remove()); }
  function setModeSelect(mode, submode) {
    removeCustomModes();
    const key = H.modeKeyFor(mode, submode);
    if (key) { F.mode.value = key; return; }
    if (!mode) { F.mode.value = 'SSB'; return; }
    const o = document.createElement('option');
    o.value = 'custom|' + mode + '|' + (submode || '');
    o.textContent = (submode ? mode + '/' + submode : mode) + ' (imported)';
    o.dataset.custom = '1';
    F.mode.insertBefore(o, F.mode.firstChild);
    F.mode.value = o.value;
  }

  function setNow() {
    const p = H.nowUtcParts(new Date());
    F.date.value = p.date;
    F.time.value = p.time;
  }
  function updateTimeIndicator() {
    const el = $('#timeMode');
    if (state.editingId) { el.textContent = ''; el.className = 'tmode'; return; }
    const map = { live: ['live', 'tmode live'], stamped: ['set', 'tmode'], manual: ['manual', 'tmode'] };
    const v = map[state.timeMode] || map.live;
    el.textContent = v[0]; el.className = v[1];
    el.title = state.timeMode === 'live' ? 'Follows the clock until you start typing a callsign'
      : state.timeMode === 'stamped' ? 'Stamped when you started typing the callsign' : 'Set by you';
  }

  function applyRstDefaults(force) {
    const p = currentModePair();
    const d = H.defaultRst(p.mode, p.submode);
    if (force || state.rstAuto.sent) { F.rst_sent.value = d; state.rstAuto.sent = true; }
    if (force || state.rstAuto.rcvd) { F.rst_rcvd.value = d; state.rstAuto.rcvd = true; }
  }

  function stationFromSettings() {
    const s = state.settings;
    F.station_callsign.value = s.my_call || '';
    F.operator.value = s.operator || '';
    F.my_gridsquare.value = s.my_grid || '';
    F.tx_pwr.value = s.tx_pwr || '';
    updateStationSummary();
  }
  function updateStationSummary() {
    const parts = [F.station_callsign.value, F.my_gridsquare.value, F.tx_pwr.value ? F.tx_pwr.value + ' W' : ''].filter(Boolean);
    $('#stationSummary').textContent = parts.length ? '(' + parts.join(' · ') + ')' : '(not set – see Settings)';
  }

  function clearErrors() {
    $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
    const box = $('#formErrors'); box.hidden = true; box.textContent = '';
  }
  function showErrors(errors) {
    const box = $('#formErrors');
    box.innerHTML = errors.map(e => esc(e[1])).join('<br>');
    box.hidden = false;
    for (const e of errors) if (F[e[0]]) F[e[0]].classList.add('invalid');
    const first = F[errors[0][0]];
    if (first) first.focus();
  }

  function resetForm(focus) {
    state.editingId = null;
    clearErrors();
    removeCustomModes();
    ['call', 'name', 'qth', 'state', 'country', 'gridsquare', 'comment'].forEach(k => { F[k].value = ''; F[k].classList.remove('prefilled'); });
    F.band.value = state.last.band || '';
    F.freq.value = state.last.freq || '';
    F.mode.value = H.modeByKey(state.last.modeKey) ? state.last.modeKey : 'SSB';
    applyRstDefaults(true);
    stationFromSettings();
    F.uploaded.checked = false;
    state.prefilled = {};
    state.timeMode = 'live';
    setNow();
    updateTimeIndicator();
    $('#formTitle').textContent = 'New QSO';
    $('#btnSave').textContent = 'Save QSO';
    $('#editBadge').hidden = true;
    $('#btnCancelEdit').hidden = true;
    $('#btnDeleteEdit').hidden = true;
    $('#btnClear').hidden = false;
    $('#uploadedRow').hidden = true;
    updateCallInfo();
    updateFreqHint();
    if (focus) F.call.focus();
  }

  function startEdit(id, fromTab) {
    const q = state.qsos.find(x => x.id === id);
    if (!q) return;
    clearErrors();
    state.editingId = id;
    state.returnTab = fromTab || 'list';
    state.prefilled = {};
    F.call.value = q.call || '';
    F.date.value = H.adifToDateInput(q.qso_date);
    F.time.value = H.adifToTimeInput(q.time_on);
    F.band.value = q.band || '';
    if (q.band && F.band.value !== q.band) F.band.value = '';
    F.freq.value = q.freq || '';
    setModeSelect(q.mode, q.submode);
    F.rst_sent.value = q.rst_sent || '';
    F.rst_rcvd.value = q.rst_rcvd || '';
    state.rstAuto = { sent: false, rcvd: false };
    ['name', 'qth', 'state', 'country', 'gridsquare', 'comment', 'station_callsign', 'operator', 'my_gridsquare', 'tx_pwr'].forEach(k => {
      F[k].value = q[k] || ''; F[k].classList.remove('prefilled');
    });
    updateStationSummary();
    F.uploaded.checked = !!q.uploaded_qrz;
    state.timeMode = 'manual';
    updateTimeIndicator();
    $('#formTitle').textContent = 'Edit QSO';
    $('#btnSave').textContent = 'Update QSO';
    $('#editBadge').hidden = false;
    $('#btnCancelEdit').hidden = false;
    $('#btnDeleteEdit').hidden = false;
    $('#btnClear').hidden = true;
    $('#uploadedRow').hidden = false;
    showTab('log');
    updateCallInfo();
    updateFreqHint();
    if (!isTouch()) F.call.focus();
  }

  function cancelEdit() {
    const ret = state.returnTab;
    resetForm(false);
    if (ret && ret !== 'log') showTab(ret);
  }

  /* ---------------- call info / dupes / prefill ---------------- */
  function qsosForCall(call) { return state.qsos.filter(q => q.call === call && q.id !== state.editingId); }
  function latestFor(list) { return list.reduce((a, b) => (!a || H.sortKey(b) > H.sortKey(a) ? b : a), null); }

  function handlePrefill() {
    for (const k of Object.keys(state.prefilled)) {
      if (F[k].value === state.prefilled[k]) F[k].value = '';
      F[k].classList.remove('prefilled');
    }
    state.prefilled = {};
    if (!state.settings.autofill_prev || state.editingId) return;
    const call = H.normalizeCall(F.call.value);
    if (call.length < 3) return;
    const prev = latestFor(qsosForCall(call));
    if (!prev) return;
    for (const k of PREFILL_FIELDS) {
      if (!F[k].value && prev[k]) { F[k].value = prev[k]; state.prefilled[k] = prev[k]; F[k].classList.add('prefilled'); }
    }
  }

  function updateCallInfo() {
    const el = $('#callInfo');
    const call = H.normalizeCall(F.call.value);
    if (call.length < 3) { el.innerHTML = ''; return; }
    const prev = qsosForCall(call);
    const mp = currentModePair();
    const cand = { call, band: F.band.value, qso_date: H.dateInputToAdif(F.date.value), mode: mp.mode, submode: mp.submode };
    const dupes = H.findDupes(state.qsos, cand, state.editingId);
    let html = '';
    if (dupes.length) {
      html += `<span class="dupe">⚠ Dupe: ${esc(call)} already logged on ${esc(cand.band)} ${esc(H.modeLabel(mp.mode, mp.submode))} on ${esc(fmtDate(cand.qso_date))} UTC (at ${dupes.map(d => fmtTime(d.time_on)).join(', ')}Z)</span>`;
    }
    if (prev.length) {
      const last = latestFor(prev);
      html += `<span class="prev">Worked ${prev.length}× before · last ${esc(fmtDate(last.qso_date))} ${esc(last.band || '')} ${esc(H.modeLabel(last.mode, last.submode))}${last.name ? ' · ' + esc(last.name) : ''}</span>`;
      if (Object.keys(state.prefilled).length) html += ' <span class="prev">(details pre-filled, dashed)</span>';
    } else if (!dupes.length) {
      html += '<span class="prev">New call – not in your log yet</span>';
    }
    el.innerHTML = html;
  }

  function updateFreqHint() {
    const el = $('#freqHint');
    const p = H.parseFreq(F.freq.value);
    F.freq.classList.remove('invalid');
    if (!F.freq.value.trim()) { el.textContent = ''; return; }
    if (!p.mhz) { el.textContent = 'Enter frequency in MHz, e.g. 14.074'; return; }
    const b = H.bandFromFreq(p.mhz);
    if (!b) { el.textContent = '⚠ ' + p.text + ' MHz is outside the amateur bands listed (160m–70cm)'; return; }
    el.textContent = p.fromKhz ? '= ' + p.text + ' MHz (' + b + ')' : '';
  }

  /* ---------------- save ---------------- */
  function collectForm() {
    const errors = [];
    const call = H.normalizeCall(F.call.value);
    if (!call) errors.push(['call', 'Callsign is required.']);
    else if (!H.isValidCall(call)) errors.push(['call', 'Callsign "' + call + '" does not look valid (letters, digits and / only).']);
    const qso_date = H.dateInputToAdif(F.date.value);
    if (!H.isValidAdifDate(qso_date)) errors.push(['date', 'Date must be a valid UTC date.']);
    const time_on = H.timeInputToAdif(F.time.value);
    if (!H.isValidAdifTime(time_on)) errors.push(['time', 'Time must be HH:MM or HH:MM:SS (UTC).']);
    let band = F.band.value;
    let freq = '';
    if (F.freq.value.trim()) {
      const p = H.parseFreq(F.freq.value);
      if (!p.mhz) errors.push(['freq', 'Frequency must be a number in MHz.']);
      else {
        freq = p.text;
        const fb = H.bandFromFreq(p.mhz);
        if (fb) band = fb;
        else if (band) errors.push(['freq', p.text + ' MHz is not inside the ' + band + ' band.']);
      }
    }
    if (!band) errors.push(['band', 'Pick a band (or enter a frequency).']);
    const mp = currentModePair();
    if (!mp.mode) errors.push(['mode', 'Pick a mode.']);
    const grid = F.gridsquare.value.trim() ? H.normalizeGrid(F.gridsquare.value) : '';
    if (grid && !H.isValidGrid(grid)) errors.push(['gridsquare', 'Grid square should look like EM10 or EM10dk.']);
    const myGrid = F.my_gridsquare.value.trim() ? H.normalizeGrid(F.my_gridsquare.value) : '';
    if (myGrid && !H.isValidGrid(myGrid)) errors.push(['my_gridsquare', 'My grid should look like EM20 or EM20ab.']);
    const pwr = F.tx_pwr.value.trim().replace(/\s*w$/i, '').replace(',', '.');
    if (pwr && !/^\d*\.?\d+$/.test(pwr)) errors.push(['tx_pwr', 'Power must be a number of watts.']);
    const sc = H.normalizeCall(F.station_callsign.value);
    if (sc && !H.isValidCall(sc)) errors.push(['station_callsign', 'Station callsign does not look valid.']);
    if (errors.some(e => ['station_callsign', 'my_gridsquare', 'tx_pwr'].indexOf(e[0]) >= 0)) $('#stationDetails').open = true;
    const data = {
      call, qso_date, time_on, band, freq, mode: mp.mode, submode: mp.submode,
      rst_sent: F.rst_sent.value.trim().toUpperCase(), rst_rcvd: F.rst_rcvd.value.trim().toUpperCase(),
      name: F.name.value.trim(), qth: F.qth.value.trim(), state: F.state.value.trim().toUpperCase(),
      country: F.country.value.trim(), gridsquare: grid, comment: F.comment.value.trim(),
      station_callsign: sc, operator: H.normalizeCall(F.operator.value), my_gridsquare: myGrid, tx_pwr: pwr
    };
    return { errors, data };
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearErrors();
    const { errors, data } = collectForm();
    if (errors.length) { showErrors(errors); return; }
    const dupes = H.findDupes(state.qsos, data, state.editingId);
    if (dupes.length && !confirm('Possible duplicate: ' + data.call + ' is already logged on ' + data.band + ' ' +
      H.modeLabel(data.mode, data.submode) + ' on ' + fmtDate(data.qso_date) + ' (UTC).\n\nSave anyway?')) {
      F.call.focus();
      return;
    }
    const now = new Date().toISOString();
    const wasEditing = !!state.editingId;
    let q;
    if (wasEditing) {
      const old = state.qsos.find(x => x.id === state.editingId);
      q = Object.assign({}, old, data, { updated: now });
      q.uploaded_qrz = F.uploaded.checked ? (old.uploaded_qrz || now) : null;
    } else {
      q = Object.assign({ id: uuid() }, data, { extra: {}, created: now, updated: now, uploaded_qrz: null });
    }
    try {
      await DB.put(q);
    } catch (err) {
      toast('Could not save: ' + (err.message || err), 'error');
      return;
    }
    const i = state.qsos.findIndex(x => x.id === q.id);
    if (i >= 0) state.qsos[i] = q; else state.qsos.push(q);
    if (!wasEditing) {
      state.last = { band: q.band, freq: q.freq, modeKey: H.modeKeyFor(q.mode, q.submode) || 'SSB' };
      DB.setMeta('last', state.last).catch(() => {});
      requestPersist(false);
    }
    toast((wasEditing ? 'Updated ' : 'Saved ') + q.call + ' · ' + q.band + ' ' + H.modeLabel(q.mode, q.submode), 'ok');
    const ret = state.returnTab;
    resetForm(!wasEditing);
    renderAll();
    if (wasEditing && ret && ret !== 'log') showTab(ret);
  }

  async function deleteQso(id) {
    const q = state.qsos.find(x => x.id === id);
    if (!q) return;
    if (!confirm('Delete QSO with ' + q.call + ' on ' + fmtDate(q.qso_date) + ' ' + fmtTime(q.time_on) + 'Z (' + q.band + ' ' +
      H.modeLabel(q.mode, q.submode) + ')?\n\nThis cannot be undone.')) return false;
    try { await DB.del(id); } catch (err) { toast('Delete failed: ' + (err.message || err), 'error'); return false; }
    state.qsos = state.qsos.filter(x => x.id !== id);
    if (state.editingId === id) resetForm(false);
    toast('Deleted ' + q.call);
    renderAll();
    return true;
  }

  /* ---------------- rendering ---------------- */
  function sortedQsos() {
    return state.qsos.slice().sort((a, b) => {
      const ka = H.sortKey(a), kb = H.sortKey(b);
      if (ka !== kb) return ka < kb ? 1 : -1;
      return String(b.created || '').localeCompare(String(a.created || ''));
    });
  }
  function dupeCounts() {
    const m = new Map();
    for (const q of state.qsos) { const k = H.dupeKey(q); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }
  function qsoItem(q, isDupe) {
    const rst = [q.rst_sent ? 'S ' + q.rst_sent : '', q.rst_rcvd ? 'R ' + q.rst_rcvd : ''].filter(Boolean).join(' ');
    const where = [q.name, q.qth, q.state, q.country, q.gridsquare].filter(Boolean).join(', ');
    const sub = [fmtDate(q.qso_date) + ' ' + fmtTime(q.time_on) + 'Z', q.freq ? q.freq + ' MHz' : '', rst, where, q.comment ? '“' + q.comment + '”' : '']
      .filter(Boolean).map(esc).join(' · ');
    return `<li class="qso" data-id="${esc(q.id)}">
      <div class="q-main"><span class="q-call">${esc(q.call)}</span>
        <span class="q-tag">${esc(q.band || '?')}</span><span class="q-tag">${esc(H.modeLabel(q.mode, q.submode))}</span>
        ${isDupe ? '<span class="q-tag dupe">DUPE</span>' : ''}
        ${q.uploaded_qrz ? '<span class="q-tag up" title="Uploaded to QRZ ' + esc(fmtLocal(q.uploaded_qrz)) + '">QRZ ✓</span>' : ''}</div>
      <div class="q-sub">${sub}</div>
      <div class="q-actions"><button type="button" class="btn small" data-act="edit" aria-label="Edit ${esc(q.call)}">Edit</button>
        <button type="button" class="btn small danger" data-act="del" aria-label="Delete ${esc(q.call)}">✕</button></div>
    </li>`;
  }

  function renderRecent() {
    const dc = dupeCounts();
    const rec = state.qsos.slice().sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))).slice(0, 5);
    $('#recentList').innerHTML = rec.length ? rec.map(q => qsoItem(q, dc.get(H.dupeKey(q)) > 1)).join('')
      : '<li class="empty">Nothing logged yet.</li>';
  }

  function renderModeFilter() {
    const sel = $('#filterMode');
    const cur = sel.value;
    const set = new Map();
    for (const q of state.qsos) { const k = H.dupeMode(q); if (!set.has(k)) set.set(k, H.modeLabel(q.mode, q.submode)); }
    const opts = Array.from(set.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    sel.innerHTML = '<option value="">All modes</option>' + opts.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('');
    if (set.has(cur)) sel.value = cur;
  }

  function renderList() {
    renderModeFilter();
    const tokens = $('#search').value.trim().toUpperCase().split(/\s+/).filter(Boolean);
    const band = $('#filterBand').value, mode = $('#filterMode').value, status = $('#filterStatus').value;
    const dc = dupeCounts();
    const rows = sortedQsos().filter(q => {
      if (band && q.band !== band) return false;
      if (mode && H.dupeMode(q) !== mode) return false;
      if (status === 'new' && q.uploaded_qrz) return false;
      if (status === 'up' && !q.uploaded_qrz) return false;
      if (status === 'dupe' && !(dc.get(H.dupeKey(q)) > 1)) return false;
      if (tokens.length) {
        const hay = [q.call, q.name, q.qth, q.state, q.country, q.gridsquare, q.comment, q.band, H.modeLabel(q.mode, q.submode),
          fmtDate(q.qso_date), q.freq].join(' ').toUpperCase();
        for (const t of tokens) if (hay.indexOf(t) < 0) return false;
      }
      return true;
    });
    $('#listCount').textContent = rows.length === state.qsos.length ? plural(state.qsos.length, 'QSO') + ', newest first'
      : rows.length + ' of ' + plural(state.qsos.length, 'QSO');
    $('#qsoList').innerHTML = rows.slice(0, state.listLimit).map(q => qsoItem(q, dc.get(H.dupeKey(q)) > 1)).join('');
    $('#btnMore').hidden = rows.length <= state.listLimit;
    $('#btnMore').textContent = 'Show more (' + (rows.length - state.listLimit) + ' left)';
    $('#emptyList').hidden = state.qsos.length > 0;
  }

  function newQsos() { return state.qsos.filter(q => !q.uploaded_qrz); }

  function renderExport() {
    const n = newQsos().length;
    $('#newCount').textContent = n;
    $('#newPlural').textContent = n === 1 ? '' : 's';
    $$('.nNew').forEach(el => { el.textContent = n; });
    $('#noCallWarn').hidden = !!state.settings.my_call;
    const p = state.pending;
    const mark = $('#btnMarkUploaded');
    if (p && p.ids && p.ids.length) {
      const remaining = p.ids.filter(id => { const q = state.qsos.find(x => x.id === id); return q && !q.uploaded_qrz; }).length;
      mark.disabled = remaining === 0;
      mark.textContent = 'Mark ' + plural(remaining, 'QSO') + ' as uploaded';
      $('#pendingInfo').textContent = 'Last export: ' + p.filename + ' (' + plural(p.ids.length, 'QSO') + ', ' + fmtLocal(p.at) + '). Only QSOs in that file get marked.';
      $('#btnDiscardPending').hidden = false;
    } else {
      mark.disabled = true;
      mark.textContent = 'Mark as uploaded';
      $('#pendingInfo').textContent = 'Export a file first (step 1).';
      $('#btnDiscardPending').hidden = true;
    }
    $('#lastUploadInfo').textContent = state.lastUpload ? 'Last marked upload: ' + plural(state.lastUpload.count, 'QSO') + ' on ' + fmtLocal(state.lastUpload.at) + '.' : '';
  }

  function renderHeader() {
    const sb = $('#stationBadge');
    sb.hidden = !state.settings.my_call;
    sb.textContent = 'de ' + state.settings.my_call;
    $('#countBadge').textContent = state.qsos.length ? String(state.qsos.length) : '';
    const n = newQsos().length;
    $('#newBadge').hidden = n === 0;
    $('#newBadge').textContent = n;
  }

  function renderAll() {
    renderHeader();
    renderRecent();
    if (!$('#tab-list').hidden) renderList();
    if (!$('#tab-export').hidden) renderExport();
    updateCallInfo();
  }

  /* ---------------- export / QRZ flow ---------------- */
  function exportDefaults() {
    const s = state.settings;
    return { station_callsign: s.my_call, operator: s.operator, my_gridsquare: s.my_grid, tx_pwr: s.tx_pwr };
  }
  function buildAdif(list) {
    const sorted = list.slice().sort((a, b) => (H.sortKey(a) < H.sortKey(b) ? -1 : H.sortKey(a) > H.sortKey(b) ? 1 : 0));
    return A.exportAdif(sorted, { programId: 'HamLog', programVersion: APP_VERSION, defaults: exportDefaults() });
  }
  function adifName(which) {
    const call = (state.settings.my_call || 'hamlog').replace(/[^A-Za-z0-9]+/g, '-');
    return call + '_' + which + '_' + fileStamp() + '.adi';
  }

  /** QRZ export. Synchronous until share/download so the browser keeps the user gesture. */
  function exportForQrz(which, preferShare) {
    const list = which === 'new' ? newQsos() : state.qsos.slice();
    if (!list.length) {
      toast(which === 'new' ? 'Nothing new to upload – every QSO is marked as uploaded.' : 'Your log is empty.');
      return;
    }
    const text = buildAdif(list);
    const filename = adifName(which);
    shareOrDownload(text, filename, preferShare).then(res => {
      if (res === 'cancelled') { toast('Share cancelled'); return; }
      state.pending = { ids: list.map(q => q.id), filename, at: new Date().toISOString(), which };
      DB.setMeta('pending', state.pending).catch(() => {});
      renderExport();
      toast((res === 'shared' ? 'Shared ' : 'Downloaded ') + filename + ' (' + plural(list.length, 'QSO') + '). Now import it on QRZ.', 'ok');
    });
  }

  async function markPendingUploaded() {
    const p = state.pending;
    if (!p) return;
    const now = new Date().toISOString();
    const changed = [];
    for (const id of p.ids) {
      const q = state.qsos.find(x => x.id === id);
      if (q && !q.uploaded_qrz) { q.uploaded_qrz = now; q.updated = now; changed.push(q); }
    }
    try { await DB.putMany(changed); } catch (err) { toast('Could not update: ' + (err.message || err), 'error'); return; }
    state.pending = null;
    state.lastUpload = { at: now, count: changed.length };
    await DB.setMeta('pending', null).catch(() => {});
    await DB.setMeta('lastUpload', state.lastUpload).catch(() => {});
    toast('Marked ' + plural(changed.length, 'QSO') + ' as uploaded to QRZ', 'ok');
    renderAll();
    renderExport();
  }

  async function setAllUploaded(flag) {
    const n = state.qsos.length;
    if (!n) { toast('Your log is empty.'); return; }
    if (!confirm(flag ? 'Mark all ' + n + ' QSOs as uploaded to QRZ?' : 'Mark all ' + n + ' QSOs as NOT uploaded? The next "new" export will contain your whole log.')) return;
    const now = new Date().toISOString();
    const changed = [];
    for (const q of state.qsos) {
      if (flag && !q.uploaded_qrz) { q.uploaded_qrz = now; q.updated = now; changed.push(q); }
      if (!flag && q.uploaded_qrz) { q.uploaded_qrz = null; q.updated = now; changed.push(q); }
    }
    try { await DB.putMany(changed); } catch (err) { toast('Update failed: ' + (err.message || err), 'error'); return; }
    toast('Updated ' + plural(changed.length, 'QSO'), 'ok');
    renderAll(); renderExport();
  }

  /* ---------------- import / backup ---------------- */
  async function importAdifFile(file) {
    const out = $('#importResult');
    out.textContent = 'Reading ' + file.name + '…';
    let text;
    try { text = await file.text(); } catch (err) { out.textContent = 'Could not read file: ' + err.message; return; }
    const res = A.importAdif(text);
    const markUp = $('#importMarkUploaded').checked;
    const keys = new Set(state.qsos.map(H.mergeKey));
    const now = new Date().toISOString();
    const added = []; let dup = 0, invalid = 0;
    for (const q of res.qsos) {
      if (!q.call || !H.isValidAdifDate(q.qso_date) || !H.isValidAdifTime(q.time_on)) { invalid++; continue; }
      const k = H.mergeKey(q);
      if (keys.has(k)) { dup++; continue; }
      keys.add(k);
      q.id = uuid(); q.created = now; q.updated = now;
      if (markUp && !q.uploaded_qrz) q.uploaded_qrz = now;
      added.push(q);
    }
    if (added.length) {
      try { await DB.putMany(added); } catch (err) { out.textContent = 'Import failed while saving: ' + (err.message || err); return; }
      state.qsos.push(...added);
    }
    const msg = 'Imported ' + plural(added.length, 'QSO') + ' from ' + file.name + ' (' + res.qsos.length + ' records; ' +
      dup + ' already in log, ' + invalid + ' missing call/date/time).' + (res.warnings.length ? ' Note: ' + res.warnings.join(' ') : '');
    out.textContent = msg;
    toast('Imported ' + plural(added.length, 'QSO'), added.length ? 'ok' : '');
    renderAll();
  }

  function backupJson() {
    const data = {
      app: 'HamLog', format: 1, version: APP_VERSION, exported: new Date().toISOString(),
      settings: state.settings, last: state.last, qsos: state.qsos
    };
    const name = 'hamlog-backup-' + fileStamp() + '.json';
    shareOrDownload(JSON.stringify(data, null, 1), name, isTouch(), 'application/json').then(res => {
      if (res !== 'cancelled') toast('Backup saved: ' + plural(state.qsos.length, 'QSO'), 'ok');
    });
  }
  function exportAllAdif() {
    if (!state.qsos.length) { toast('Your log is empty.'); return; }
    shareOrDownload(buildAdif(state.qsos), adifName('all'), isTouch()).then(res => {
      if (res !== 'cancelled') toast('Exported ' + plural(state.qsos.length, 'QSO') + ' as ADIF', 'ok');
    });
  }

  function sanitizeQso(o) {
    if (!o || typeof o !== 'object') return null;
    const q = {};
    const str = ['id', 'call', 'qso_date', 'time_on', 'band', 'freq', 'mode', 'submode', 'rst_sent', 'rst_rcvd', 'name', 'qth', 'state',
      'country', 'gridsquare', 'comment', 'station_callsign', 'operator', 'my_gridsquare', 'tx_pwr', 'created', 'updated'];
    for (const k of str) q[k] = o[k] == null ? '' : String(o[k]);
    q.uploaded_qrz = o.uploaded_qrz ? String(o.uploaded_qrz) : null;
    q.extra = {};
    if (o.extra && typeof o.extra === 'object') for (const k of Object.keys(o.extra)) q.extra[k] = String(o.extra[k]);
    if (!q.id) q.id = uuid();
    q.call = H.normalizeCall(q.call);
    return q.call && q.qso_date ? q : null;
  }

  async function restoreJson(file, replace) {
    const out = $('#restoreResult');
    let data;
    try { data = JSON.parse(await file.text()); } catch (err) { out.textContent = 'Not a valid JSON file: ' + err.message; return; }
    if (!data || data.app !== 'HamLog' || !Array.isArray(data.qsos)) { out.textContent = 'This is not a HamLog backup file.'; return; }
    const incoming = data.qsos.map(sanitizeQso).filter(Boolean);
    if (replace) {
      if (!confirm('Replace your entire log (' + plural(state.qsos.length, 'QSO') + ') and settings with this backup (' +
        plural(incoming.length, 'QSO') + ')?\n\nThis cannot be undone.')) { out.textContent = 'Restore cancelled.'; return; }
      try { await DB.clear(); await DB.putMany(incoming); } catch (err) { out.textContent = 'Restore failed: ' + (err.message || err); return; }
      state.qsos = incoming;
      if (data.settings) { state.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings); await DB.setMeta('settings', state.settings).catch(() => {}); }
      state.pending = null; await DB.setMeta('pending', null).catch(() => {});
      out.textContent = 'Restored ' + plural(incoming.length, 'QSO') + ' (replaced log).';
    } else {
      const byId = new Map(state.qsos.map(q => [q.id, q]));
      const keys = new Set(state.qsos.map(H.mergeKey));
      const changed = []; let added = 0, updated = 0, skipped = 0;
      for (const q of incoming) {
        const ex = byId.get(q.id);
        if (ex) {
          if (String(q.updated) > String(ex.updated)) { changed.push(q); updated++; } else skipped++;
        } else if (keys.has(H.mergeKey(q))) { skipped++; }
        else { changed.push(q); keys.add(H.mergeKey(q)); added++; }
      }
      try { await DB.putMany(changed); } catch (err) { out.textContent = 'Restore failed: ' + (err.message || err); return; }
      for (const q of changed) { const i = state.qsos.findIndex(x => x.id === q.id); if (i >= 0) state.qsos[i] = q; else state.qsos.push(q); }
      if (data.settings) {
        let touched = false;
        for (const k of Object.keys(DEFAULT_SETTINGS)) if (!state.settings[k] && data.settings[k]) { state.settings[k] = data.settings[k]; touched = true; }
        if (touched) await DB.setMeta('settings', state.settings).catch(() => {});
      }
      out.textContent = 'Merged backup: ' + added + ' added, ' + updated + ' updated, ' + skipped + ' unchanged/duplicate.';
    }
    applyTheme(); loadSettingsForm(); resetForm(false); renderAll();
    toast('Restore complete', 'ok');
  }

  async function deleteAll() {
    const n = state.qsos.length;
    if (!n) { toast('Your log is already empty.'); return; }
    const answer = prompt('This permanently deletes all ' + n + ' QSOs from this device.\nMake a backup first!\n\nType DELETE to confirm:');
    if (answer !== 'DELETE') { toast('Nothing deleted'); return; }
    try { await DB.clear(); } catch (err) { toast('Failed: ' + (err.message || err), 'error'); return; }
    state.qsos = []; state.pending = null;
    await DB.setMeta('pending', null).catch(() => {});
    resetForm(false); renderAll();
    toast('All QSOs deleted');
  }

  /* ---------------- settings ---------------- */
  function applyTheme() { document.documentElement.setAttribute('data-theme', state.settings.theme || 'auto'); }
  function loadSettingsForm() {
    const s = state.settings;
    $('#s-my_call').value = s.my_call || '';
    $('#s-my_grid').value = s.my_grid || '';
    $('#s-operator').value = s.operator || '';
    $('#s-tx_pwr').value = s.tx_pwr || '';
    $('#s-theme').value = s.theme || 'auto';
    $('#s-autofill_prev').checked = s.autofill_prev !== false;
  }
  async function saveSettings(e) {
    e.preventDefault();
    const errs = [];
    const my_call = H.normalizeCall($('#s-my_call').value);
    if (my_call && !H.isValidCall(my_call)) errs.push('My callsign does not look valid.');
    const my_grid = $('#s-my_grid').value.trim() ? H.normalizeGrid($('#s-my_grid').value) : '';
    if (my_grid && !H.isValidGrid(my_grid)) errs.push('My grid should look like EM20 or EM20ab.');
    const operator = H.normalizeCall($('#s-operator').value);
    if (operator && !H.isValidCall(operator)) errs.push('Operator callsign does not look valid.');
    const tx_pwr = $('#s-tx_pwr').value.trim().replace(/\s*w$/i, '').replace(',', '.');
    if (tx_pwr && !/^\d*\.?\d+$/.test(tx_pwr)) errs.push('Power must be a number of watts.');
    const box = $('#settingsErrors');
    if (errs.length) { box.innerHTML = errs.map(esc).join('<br>'); box.hidden = false; return; }
    box.hidden = true;
    state.settings = Object.assign({}, state.settings, {
      my_call, my_grid, operator, tx_pwr, theme: $('#s-theme').value, autofill_prev: $('#s-autofill_prev').checked
    });
    try { await DB.setMeta('settings', state.settings); } catch (err) { toast('Could not save settings: ' + (err.message || err), 'error'); return; }
    loadSettingsForm();
    applyTheme();
    if (!state.editingId) stationFromSettings();
    renderAll();
    toast('Settings saved', 'ok');
  }

  async function requestPersist(verbose) {
    if (!(navigator.storage && navigator.storage.persist)) { if (verbose) toast('This browser does not support persistent storage requests.'); return; }
    try {
      const already = await navigator.storage.persisted();
      const ok = already || await navigator.storage.persist();
      if (verbose) toast(ok ? 'Browser will keep HamLog data (persistent storage granted).' : 'Browser declined; installing the app usually helps. Keep backups!');
      renderSettingsInfo();
    } catch (e) { /* ignore */ }
  }
  async function renderSettingsInfo() {
    $('#appVersion').textContent = 'v' + APP_VERSION;
    let info = plural(state.qsos.length, 'QSO') + ' stored in this browser (IndexedDB).';
    try {
      if (navigator.storage && navigator.storage.persisted) info += (await navigator.storage.persisted()) ? ' Storage: persistent.' : ' Storage: best-effort (may be cleared by the browser under pressure).';
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est && est.usage != null) info += ' Using ' + (est.usage / 1024 / 1024).toFixed(1) + ' MB.';
      }
    } catch (e) { /* ignore */ }
    $('#storageInfo').textContent = info;
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const hint = $('#installHint');
    if (standalone) { hint.hidden = false; hint.textContent = 'Running as an installed app.'; }
    else if (ios) { hint.hidden = false; hint.innerHTML = 'To install on iPhone/iPad: open this page in <b>Safari</b>, tap <b>Share</b> → <b>Add to Home Screen</b>.'; }
    else if (state.deferredInstall) { hint.hidden = false; hint.textContent = 'Use the Install button at the top to add HamLog to your device.'; }
    else { hint.hidden = false; hint.textContent = 'To install: use your browser menu → “Install app” / “Add to Home screen” (requires https).'; }
  }

  /* ---------------- events ---------------- */
  function bindEvents() {
    $$('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $$('[data-goto]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.goto)));
    window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

    form.addEventListener('submit', onSubmit);
    // Enter on a <select> should also save (inputs submit natively)
    form.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'SELECT') { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : $('#btnSave').click(); }
      if (e.key === 'Escape') { e.preventDefault(); if (state.editingId) cancelEdit(); else resetForm(true); }
    });

    F.call.addEventListener('input', () => {
      const raw = F.call.value;
      const up = raw.toUpperCase().replace(/\s+/g, '');
      if (up !== raw) {
        const pos = F.call.selectionStart - (raw.length - up.length);
        F.call.value = up;
        try { F.call.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
      }
      if (!state.editingId) {
        if (up && state.timeMode === 'live') { setNow(); state.timeMode = 'stamped'; }
        else if (!up && state.timeMode === 'stamped') { state.timeMode = 'live'; setNow(); }
        updateTimeIndicator();
      }
      handlePrefill();
      updateCallInfo();
    });
    F.call.addEventListener('blur', () => { F.call.value = H.normalizeCall(F.call.value); });

    const manualTime = () => { if (!state.editingId) { state.timeMode = 'manual'; updateTimeIndicator(); } updateCallInfo(); };
    ['input', 'change'].forEach(ev => { F.date.addEventListener(ev, manualTime); F.time.addEventListener(ev, manualTime); });
    F.date.addEventListener('focus', () => { if (state.timeMode === 'live' && !state.editingId) { state.timeMode = 'manual'; updateTimeIndicator(); } });
    F.time.addEventListener('focus', () => { if (state.timeMode === 'live' && !state.editingId) { state.timeMode = 'manual'; updateTimeIndicator(); } });
    F.time.addEventListener('blur', () => {
      const t = H.timeInputToAdif(F.time.value);
      if (H.isValidAdifTime(t)) F.time.value = H.adifToTimeInput(t);
    });
    $('#btnNow').addEventListener('click', () => {
      setNow();
      if (!state.editingId) state.timeMode = 'manual';
      updateTimeIndicator(); updateCallInfo();
    });

    F.freq.addEventListener('input', () => {
      const p = H.parseFreq(F.freq.value);
      if (p.mhz) { const b = H.bandFromFreq(p.mhz); if (b) F.band.value = b; }
      updateFreqHint(); updateCallInfo();
    });
    F.freq.addEventListener('blur', () => {
      const p = H.parseFreq(F.freq.value);
      if (p.mhz && p.text !== F.freq.value) F.freq.value = p.text;
      updateFreqHint();
    });
    F.band.addEventListener('change', () => {
      const p = H.parseFreq(F.freq.value);
      if (p.mhz && F.band.value && !H.freqInBand(p.mhz, F.band.value)) { F.freq.value = ''; }
      F.band.classList.remove('invalid');
      updateFreqHint(); updateCallInfo();
    });
    F.mode.addEventListener('change', () => { applyRstDefaults(false); updateCallInfo(); });
    F.rst_sent.addEventListener('input', () => { state.rstAuto.sent = false; });
    F.rst_rcvd.addEventListener('input', () => { state.rstAuto.rcvd = false; });
    PREFILL_FIELDS.forEach(k => F[k].addEventListener('input', () => { delete state.prefilled[k]; F[k].classList.remove('prefilled'); }));
    F.gridsquare.addEventListener('blur', () => { if (F.gridsquare.value.trim()) F.gridsquare.value = H.normalizeGrid(F.gridsquare.value); });
    F.my_gridsquare.addEventListener('blur', () => { if (F.my_gridsquare.value.trim()) F.my_gridsquare.value = H.normalizeGrid(F.my_gridsquare.value); });
    F.state.addEventListener('blur', () => { F.state.value = F.state.value.trim().toUpperCase(); });
    ['station_callsign', 'my_gridsquare', 'tx_pwr'].forEach(k => F[k].addEventListener('input', updateStationSummary));
    form.addEventListener('input', e => { if (e.target.classList) e.target.classList.remove('invalid'); });

    $('#btnClear').addEventListener('click', () => resetForm(true));
    $('#btnCancelEdit').addEventListener('click', cancelEdit);
    $('#btnDeleteEdit').addEventListener('click', async () => {
      const ret = state.returnTab;
      if (await deleteQso(state.editingId)) { if (ret && ret !== 'log') showTab(ret); }
    });

    const listClick = fromTab => e => {
      const li = e.target.closest('.qso');
      if (!li || !li.dataset.id) return;
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'del') deleteQso(li.dataset.id);
      else if (act && act.dataset.act === 'edit') startEdit(li.dataset.id, fromTab);
      else if (fromTab === 'log') startEdit(li.dataset.id, 'log');
    };
    $('#qsoList').addEventListener('click', listClick('list'));
    $('#recentList').addEventListener('click', listClick('log'));

    let searchTimer;
    $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.listLimit = LIST_PAGE; renderList(); }, 120); });
    ['#filterBand', '#filterMode', '#filterStatus'].forEach(s => $(s).addEventListener('change', () => { state.listLimit = LIST_PAGE; renderList(); }));
    $('#btnMore').addEventListener('click', () => { state.listLimit += LIST_PAGE; renderList(); });

    $('#btnShareNew').addEventListener('click', () => exportForQrz('new', true));
    $('#btnDownloadNew').addEventListener('click', () => exportForQrz('new', false));
    $('#btnExportAllQrz').addEventListener('click', () => exportForQrz('all', isTouch()));
    $('#btnMarkUploaded').addEventListener('click', markPendingUploaded);
    $('#btnDiscardPending').addEventListener('click', async () => {
      state.pending = null; await DB.setMeta('pending', null).catch(() => {}); renderExport();
    });
    $('#btnMarkAllUp').addEventListener('click', () => setAllUploaded(true));
    $('#btnMarkAllNew').addEventListener('click', () => setAllUploaded(false));

    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#s-theme').addEventListener('change', () => document.documentElement.setAttribute('data-theme', $('#s-theme').value));
    $('#importAdif').addEventListener('change', e => { const f = e.target.files[0]; if (f) importAdifFile(f); e.target.value = ''; });
    $('#restoreMerge').addEventListener('change', e => { const f = e.target.files[0]; if (f) restoreJson(f, false); e.target.value = ''; });
    $('#restoreReplace').addEventListener('change', e => { const f = e.target.files[0]; if (f) restoreJson(f, true); e.target.value = ''; });
    $('#btnBackupJson').addEventListener('click', backupJson);
    $('#btnExportAllAdif').addEventListener('click', exportAllAdif);
    $('#btnPersist').addEventListener('click', () => requestPersist(true));
    $('#btnDeleteAll').addEventListener('click', deleteAll);

    const online = () => { $('#offlineBadge').hidden = navigator.onLine !== false; };
    window.addEventListener('online', online); window.addEventListener('offline', online); online();

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      state.deferredInstall = e;
      $('#btnInstall').hidden = false;
    });
    $('#btnInstall').addEventListener('click', async () => {
      const e = state.deferredInstall;
      if (!e) return;
      state.deferredInstall = null;
      $('#btnInstall').hidden = true;
      e.prompt();
      try { await e.userChoice; } catch (err) { /* ignore */ }
    });
    window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; toast('HamLog installed', 'ok'); });

    setInterval(() => { if (state.timeMode === 'live' && !state.editingId && document.activeElement !== F.date && document.activeElement !== F.time) setNow(); }, 1000);
  }

  /* ---------------- service worker ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (!(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
    navigator.serviceWorker.register('./sw.js').then(reg => {
      const showUpdate = () => {
        $('#updateBanner').hidden = false;
        $('#btnUpdate').onclick = () => {
          state.updating = true;
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          else location.reload();
        };
      };
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); });
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(err => console.warn('Service worker registration failed:', err));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (state.updating) location.reload(); });
  }

  /* ---------------- init ---------------- */
  async function init() {
    fillSelects();
    bindEvents();
    try {
      await DB.open();
      const [qsos, settings, last, pending, lastUpload] = await Promise.all([
        DB.getAll(), DB.getMeta('settings'), DB.getMeta('last'), DB.getMeta('pending'), DB.getMeta('lastUpload')
      ]);
      state.qsos = qsos || [];
      if (settings) state.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
      if (last) state.last = Object.assign(state.last, last);
      state.pending = pending || null;
      state.lastUpload = lastUpload || null;
    } catch (err) {
      storageError(err);
    }
    applyTheme();
    loadSettingsForm();
    resetForm(!isTouch());
    renderAll();
    showTab((location.hash || '#log').slice(1), { noScroll: true });
    registerSW();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
