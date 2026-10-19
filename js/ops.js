/* HamLog – Field tab: contest logging and POTA/SOTA activation / hunting. Depends on HamData, HamField, Adif, HamDB, app.js API. */
(function () {
  'use strict';
  const H = window.HamData, FX = window.HamField, A = window.Adif, DB = window.HamDB;
  const $ = s => document.querySelector(s);
  let api = null;
  const S = { sessions: [], active: null, busy: false };
  const E = {};
  ['type', 'contest', 'cidRow', 'cid', 'exch', 'loc', 'power', 'serial', 'contestHint', 'contestBox', 'actBox', 'myref', 'myrefLbl', 'lookup',
    'refInfo', 'setupErr', 'start', 'update', 'end', 'activePill', 'form', 'formTitle', 'utc', 'band', 'mode', 'freq', 'call', 'dupe',
    'contestEntry', 'sent', 'rcvd', 'rcvdHint', 'actEntry', 'rsts', 'rstr', 'their', 'theirLbl', 'flag', 'err', 'log', 'clear',
    'statsCard', 'statsTitle', 'stats', 'note', 'exportCard', 'expAdif', 'expCab', 'expPota', 'expSota', 'expHint', 'listCard', 'list', 'listCount']
    .forEach(k => { E[k] = document.getElementById('o-' + k); });

  const esc = s => api.esc(s);
  const sessQsos = () => (S.active ? api.state.qsos.filter(q => q.session_id === S.active.id) : []);
  const myCall = () => H.normalizeCall(api.state.settings.my_call || '');
  function utcNow() { const p = H.nowUtcParts(new Date()); return { date: H.dateInputToAdif(p.date), time: H.timeInputToAdif(p.time), text: p.time.slice(0, 5) + 'Z' }; }

  /* ---------------- selects ---------------- */
  function fillSelects() {
    E.contest.innerHTML = Object.keys(FX.CONTESTS).map(k => `<option value="${k}">${esc(FX.CONTESTS[k].name)}</option>`).join('');
    E.band.innerHTML = H.BANDS.map(b => `<option value="${b.band}">${b.band}</option>`).join('');
    E.mode.innerHTML = H.MODES.map(m => `<option value="${m.key}">${esc(m.label)}</option>`).join('');
  }

  /* ---------------- setup form ---------------- */
  function setupView() {
    const t = E.type.value, c = FX.CONTESTS[E.contest.value];
    E.contestBox.hidden = t !== 'CONTEST';
    E.actBox.hidden = !(t === 'POTA' || t === 'SOTA');
    E.myrefLbl.textContent = t === 'POTA' ? 'My park(s): e.g. US-0001, or US-0001,US-4567 for a multi-park activation' : 'My summit, e.g. W7W/LC-001';
    E.myref.placeholder = t === 'POTA' ? 'US-0001' : 'W5/OU-001';
    if (c) {
      E.cidRow.hidden = !c.needsId;
      E.exch.placeholder = c.sentHint.split(' (')[0];
      E.contestHint.textContent = 'Exchange: ' + c.sentHint + ' · They send: ' + c.rcvdHint + '. Dupe rule: ' +
        ({ once: 'each station once per contest', band: 'once per band', 'band-mode': 'once per band and mode' })[c.dupe] +
        (c.serial ? ' · Serial numbers increment automatically.' : '') + ' Scoring is an estimate.';
    }
  }

  function readSetup() {
    const t = E.type.value, errs = [];
    const x = { type: t };
    if (t === 'CONTEST') {
      x.contest = E.contest.value;
      const c = FX.CONTESTS[x.contest];
      x.contest_id = E.cid.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (c.needsId && !x.contest_id) errs.push('Enter a contest ID (letters, digits, dashes), e.g. LA-QSO-PARTY.');
      x.exch_sent = FX.tok(E.exch.value).join(' ');
      if (!x.exch_sent && !c.serial) errs.push('Enter your sent exchange, e.g. ' + c.sentHint.split(' (')[0] + '.');
      x.location = E.loc.value.trim().toUpperCase();
      x.cat_power = E.power.value;
      const n = parseInt(E.serial.value, 10);
      x.next_serial = n > 0 ? n : 1;
    } else if (t === 'POTA' || t === 'SOTA') {
      const refs = FX.splitRefs(E.myref.value);
      if (!refs.length) errs.push('Enter your ' + (t === 'POTA' ? 'park reference, e.g. US-0001.' : 'summit reference, e.g. W7W/LC-001.'));
      for (const r of refs) if (t === 'POTA' ? !FX.isValidPotaRef(r) : !FX.isValidSotaRef(r))
        errs.push('"' + r + '" is not a valid ' + (t === 'POTA' ? 'POTA park (format XX-1234)' : 'SOTA summit (format ASSOC/RR-123)') + '.');
      if (t === 'SOTA' && refs.length > 1) errs.push('SOTA: one summit per session.');
      x.my_refs = refs;
    }
    if (!myCall()) errs.push('Set My callsign in Settings first.');
    return { x, errs };
  }

  async function saveSession(sess) {
    await DB.putSession(sess);
    const i = S.sessions.findIndex(s => s.id === sess.id);
    if (i >= 0) S.sessions[i] = sess; else S.sessions.push(sess);
  }

  async function startSession() {
    const { x, errs } = readSetup();
    showErr(E.setupErr, errs);
    if (errs.length) return;
    const now = new Date().toISOString();
    const sess = Object.assign({ id: api.uuid(), started: now, ended: null, ref_info: {} }, x);
    try { await saveSession(sess); await DB.setMeta('activeSession', sess.id); }
    catch (err) { api.toast('Could not start: ' + (err.message || err), 'error'); return; }
    S.active = sess;
    loadSetupForm(sess);
    api.toast('Session started', 'ok');
    if (sess.type === 'POTA' || sess.type === 'SOTA') lookupMine(false);
    render(); E.call.focus();
  }
  async function updateSession() {
    if (!S.active) return;
    const { x, errs } = readSetup();
    if (x.type !== S.active.type) errs.push('To change the session type, end this session and start a new one.');
    showErr(E.setupErr, errs);
    if (errs.length) return;
    const sess = Object.assign({}, S.active, x);
    if (JSON.stringify(sess.my_refs) !== JSON.stringify(S.active.my_refs)) sess.ref_info = {};
    try { await saveSession(sess); } catch (err) { api.toast('Could not save: ' + (err.message || err), 'error'); return; }
    S.active = sess; loadSetupForm(sess); api.toast('Session updated', 'ok'); render();
  }
  async function endSession() {
    if (!S.active) return;
    const n = sessQsos().length;
    if (!confirm('End this session? Its ' + api.plural(n, 'QSO') + ' stay in your logbook.')) return;
    const sess = Object.assign({}, S.active, { ended: new Date().toISOString() });
    try { await saveSession(sess); await DB.setMeta('activeSession', null); } catch (err) { api.toast('Failed: ' + (err.message || err), 'error'); return; }
    S.active = null; render();
  }

  function showErr(el, errs) { el.hidden = !errs.length; el.innerHTML = errs.map(esc).join('<br>'); }

  /* ---------------- reference lookups (optional, online only; public CORS-enabled APIs) ---------------- */
  async function fetchRef(ref) {
    if (FX.isValidPotaRef(ref)) {
      const r = await fetch('https://api.pota.app/park/' + encodeURIComponent(ref), { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.name) return { ref, found: false };
      return { ref, found: true, name: String(j.name), where: String(j.locationDesc || ''), grid: String(j.grid6 || '') };
    }
    if (FX.isValidSotaRef(ref)) {
      const r = await fetch('https://api2.sota.org.uk/api/summits/' + ref.split('/').map(encodeURIComponent).join('/'), { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.name) return { ref, found: false };
      return { ref, found: true, name: String(j.name), points: Number(j.points) || null, alt: j.altM ? j.altM + ' m' : '', grid: String(j.locator || '') };
    }
    return { ref, found: false };
  }
  async function lookupMine(verbose) {
    const refs = S.active && S.active.my_refs ? S.active.my_refs : FX.splitRefs(E.myref.value);
    if (!refs.length) return;
    if (navigator.onLine === false) { if (verbose) E.refInfo.textContent = 'Offline: name lookup skipped. Reference format checked locally.'; return; }
    E.refInfo.textContent = 'Looking up…';
    const out = [];
    for (const r of refs) {
      try { out.push(await fetchRef(r)); } catch (e) { out.push({ ref: r, error: true }); }
    }
    E.refInfo.textContent = out.map(o => o.error ? o.ref + ': lookup failed (offline or blocked)' : !o.found ? o.ref + ': not found in the public list. Double-check it.'
      : o.ref + ': ' + o.name + (o.where ? ' (' + o.where + ')' : '') + (o.points ? ' · ' + o.points + ' pts' : '') + (o.alt ? ' · ' + o.alt : '')).join(' · ');
    if (S.active) {
      const sess = Object.assign({}, S.active, { ref_info: {} });
      for (const o of out) if (o.found) sess.ref_info[o.ref] = o;
      try { await saveSession(sess); S.active = sess; } catch (e) { /* ignore */ }
      renderStats();
    }
  }

  /* ---------------- entry ---------------- */
  function modePair() { const m = H.modeByKey(E.mode.value) || H.modeByKey('SSB'); return { mode: m.mode, submode: m.submode, key: m.key }; }
  function candidate() {
    const now = utcNow(), mp = modePair();
    let band = E.band.value, freq = '';
    const p = H.parseFreq(E.freq.value);
    if (p.mhz) { freq = p.text; band = H.bandFromFreq(p.mhz) || band; }
    return { call: H.normalizeCall(E.call.value), band, freq, mode: mp.mode, submode: mp.submode, qso_date: now.date, time_on: now.time };
  }
  function sentText() {
    const s = S.active, c = s && FX.CONTESTS[s.contest];
    if (!c) return '';
    return [c.serial ? String(s.next_serial) : '', s.exch_sent].filter(Boolean).join(' ');
  }

  function liveCheck() {
    if (!S.active) return;
    const cand = candidate();
    let html = '';
    if (cand.call) {
      if (S.active.type === 'CONTEST') {
        const d = FX.contestDupes(S.active.contest, sessQsos(), cand);
        if (d.length) html = `<span class="dupe">DUPE: ${esc(cand.call)} already worked ${FX.CONTESTS[S.active.contest].dupe === 'once' ? 'in this contest' : 'on ' + esc(cand.band) + (FX.CONTESTS[S.active.contest].dupe === 'band' ? '' : ' ' + FX.modeCat(cand))}</span>`;
        else html = '<span class="ok-line">New ✓</span>';
      } else {
        const dupes = sessQsos().filter(q => H.normalizeCall(q.call) === cand.call && q.band === cand.band && H.dupeMode(q) === H.dupeMode(cand) && q.qso_date === cand.qso_date);
        html = dupes.length ? `<span class="dupe">Already worked ${esc(cand.call)} on ${esc(cand.band)} ${esc(H.modeLabel(cand.mode, cand.submode))} today (UTC). It won't count twice.</span>` : '';
      }
    }
    E.dupe.innerHTML = html;
    if (!E.actEntry.hidden) {
      const refs = FX.splitRefs(E.their.value);
      const bad = refs.filter(r => !FX.isValidPotaRef(r) && !FX.isValidSotaRef(r));
      const parks = refs.filter(FX.isValidPotaRef), sums = refs.filter(FX.isValidSotaRef);
      const flags = [];
      if (parks.length) flags.push(S.active.type === 'POTA' ? '<span class="pill ok">Park-to-park</span>' : '<span class="pill">Park ' + esc(parks.join(', ')) + '</span>');
      if (sums.length) flags.push(S.active.type === 'SOTA' ? '<span class="pill ok">Summit-to-summit</span>' : '<span class="pill">Summit ' + esc(sums.join(', ')) + '</span>');
      if (bad.length) flags.push('<span class="dupe">Not a valid park (XX-1234) or summit (ASSOC/RR-123): ' + esc(bad.join(', ')) + '</span>');
      E.flag.innerHTML = flags.join(' ');
    }
  }

  async function onLog(e) {
    if (e) e.preventDefault();
    if (!S.active || S.busy) return;
    const s = S.active, errs = [];
    const base = candidate();
    if (!base.call) errs.push('Callsign is required.');
    else if (!H.isValidCall(base.call)) errs.push('Callsign "' + base.call + '" does not look valid.');
    if (!base.band) errs.push('Pick a band.');
    if (E.freq.value.trim() && !H.parseFreq(E.freq.value).mhz) errs.push('Frequency must be a number in MHz.');
    const st = api.state.settings, nowIso = new Date().toISOString();
    const common = Object.assign(base, {
      rst_sent: '', rst_rcvd: '', name: '', qth: '', state: '', country: '', gridsquare: '', comment: '',
      station_callsign: H.normalizeCall(st.my_call), operator: H.normalizeCall(st.operator), my_gridsquare: st.my_grid ? H.normalizeGrid(st.my_grid) : '',
      tx_pwr: st.tx_pwr || '', extra: {}, created: nowIso, updated: nowIso, uploaded_qrz: null, session_id: s.id
    });
    const records = [];
    if (s.type === 'CONTEST') {
      const c = FX.CONTESTS[s.contest];
      const r = FX.parseRcvd(s.contest, E.rcvd.value);
      errs.push(...r.errors);
      if (!errs.length && FX.contestDupes(s.contest, sessQsos(), base).length &&
        !confirm('DUPE: ' + base.call + ' is already in this contest log for this ' + (c.dupe === 'once' ? 'contest' : 'band' + (c.dupe === 'band' ? '' : '/mode')) + '. It scores zero. Log anyway?')) { E.call.select(); return; }
      const q = Object.assign({}, common, {
        contest_id: FX.contestId(s.contest, base, s.contest_id), srx: r.srx, srx_string: r.srx_string,
        stx: c.serial ? String(s.next_serial) : '', stx_string: s.exch_sent || ''
      });
      const rt = FX.tok(r.srx_string), stt = FX.tok(s.exch_sent);
      if (/^[1-5][1-9]9?$/.test(rt[0] || '')) q.rst_rcvd = rt[0];
      if (/^[1-5][1-9]9?$/.test(stt[0] || '')) q.rst_sent = stt[0];
      if (s.contest === 'ARRL-FD' || s.contest === 'WFD') { q.extra.CLASS = rt[0] || ''; q.extra.ARRL_SECT = rt[1] || ''; }
      if (s.contest === 'ARRL-SS') { q.extra.PRECEDENCE = rt[0] || ''; q.extra.CHECK = rt[1] || ''; q.extra.ARRL_SECT = rt[2] || ''; }
      if (s.contest === 'CQ-WW' && rt[1]) q.extra.CQZ = rt[1];
      records.push(q);
    } else {
      const refs = FX.splitRefs(E.their.value);
      const bad = refs.filter(r => !FX.isValidPotaRef(r) && !FX.isValidSotaRef(r));
      if (bad.length) errs.push('Not a valid park or summit reference: ' + bad.join(', '));
      if (s.type === 'HUNT' && !refs.length) errs.push('Hunter mode: enter their park or summit reference.');
      const mine = {};
      if (s.type === 'POTA') { mine.my_sig = 'POTA'; mine.my_sig_info = s.my_refs[0]; if (s.my_refs.length > 1) mine.pota_parks = s.my_refs.slice(); }
      if (s.type === 'SOTA') mine.my_sota_ref = s.my_refs[0];
      const rsts = E.rsts.value.trim().toUpperCase() || H.defaultRst(base.mode, base.submode);
      const rstr = E.rstr.value.trim().toUpperCase() || H.defaultRst(base.mode, base.submode);
      const parks = refs.filter(FX.isValidPotaRef), sums = refs.filter(FX.isValidSotaRef);
      const sota = sums[0] || '';
      // POTA: one log entry per park the other station is in (2-fer P2P), per POTA "Logging Made Easy".
      const theirParks = parks.length ? parks : [''];
      for (const park of theirParks) {
        const q = Object.assign({}, common, mine, { rst_sent: rsts, rst_rcvd: rstr });
        if (park) { q.sig = 'POTA'; q.sig_info = park; }
        if (sota && (park === theirParks[0])) q.sota_ref = sota;
        records.push(q);
      }
    }
    showErr(E.err, errs);
    if (errs.length) return;
    S.busy = true;
    try {
      for (const q of records) { q.id = api.uuid(); }
      await DB.putMany(records);
      api.state.qsos.push(...records);
      if (s.type === 'CONTEST' && FX.CONTESTS[s.contest].serial) {
        const sess = Object.assign({}, s, { next_serial: s.next_serial + 1 });
        await saveSession(sess); S.active = sess;
      }
      api.state.last = { band: base.band, freq: base.freq, modeKey: modePair().key };
      DB.setMeta('last', api.state.last).catch(() => {});
      api.requestPersist(false);
    } catch (err) {
      api.toast('Could not save: ' + (err.message || err), 'error');
      S.busy = false; return;
    }
    S.busy = false;
    api.toast('Logged ' + base.call + (records.length > 1 ? ' ×' + records.length + ' (one per park)' : ''), 'ok');
    clearEntry();
    api.renderAll();
    render();
    E.call.focus();
  }
  function clearEntry() { E.call.value = ''; E.rcvd.value = ''; E.their.value = ''; E.rsts.value = ''; E.rstr.value = ''; E.err.hidden = true; E.dupe.innerHTML = ''; E.flag.innerHTML = ''; }

  /* ---------------- exports ---------------- */
  function safe(s) { return String(s || '').replace(/[^A-Za-z0-9-]+/g, '-'); }
  function exportAdif() {
    const list = sessQsos();
    if (!list.length) { api.toast('No QSOs in this session yet.'); return; }
    const tag = S.active.type === 'CONTEST' ? (list[0].contest_id || 'contest') : S.active.type + '-' + (S.active.my_refs || []).join('_');
    api.shareOrDownload(api.adifFor(list), safe(myCall()) + '_' + safe(tag) + '_' + api.fileStamp() + '.adi', api.isTouch());
  }
  function exportCab() {
    const list = sessQsos();
    if (!list.length) { api.toast('No QSOs in this session yet.'); return; }
    const s = S.active;
    const text = FX.cabrillo({ contest: s.contest, contest_id: s.contest_id, my_call: myCall(), location: s.location, cat_power: s.cat_power,
      grid: api.state.settings.my_grid, operators: api.state.settings.operator || '' }, list, { version: api.version });
    api.shareOrDownload(text, safe(myCall()) + '_' + safe(FX.contestId(s.contest, list[0], s.contest_id) || s.contest) + '.log', api.isTouch());
  }
  function exportPota() {
    const groups = FX.potaGroups(sessQsos(), myCall());
    if (!groups.length) { api.toast('No POTA activation QSOs in this session.'); return; }
    const defaults = api.exportDefaults();
    if (groups.length === 1) {
      const g = groups[0];
      api.shareOrDownload(A.exportAdif(g.qsos, { programId: 'HamLog', programVersion: api.version, defaults }), g.filename, api.isTouch());
    } else {
      groups.forEach((g, i) => setTimeout(() => api.downloadText(A.exportAdif(g.qsos, { programId: 'HamLog', programVersion: api.version, defaults }), g.filename), i * 400));
    }
    api.toast(groups.length + ' POTA file' + (groups.length > 1 ? 's' : '') + ': ' + groups.map(g => g.filename).join(', '), 'ok');
  }
  function exportSota() {
    const text = FX.sotaCsv(sessQsos(), myCall());
    if (!text) { api.toast('No SOTA QSOs in this session.'); return; }
    const ref = (S.active.my_refs && S.active.my_refs[0]) || 'chase';
    api.shareOrDownload(text, safe(myCall()) + '_SOTA_' + safe(ref) + '_' + api.fileStamp() + '.csv', api.isTouch(), 'text/csv');
  }

  /* ---------------- render ---------------- */
  function renderStats() {
    const s = S.active;
    if (!s) return;
    const list = sessQsos();
    const box = [];
    const cell = (v, l) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
    if (s.type === 'CONTEST') {
      const st = FX.contestStats(s.contest, list, Date.now());
      E.statsTitle.textContent = FX.CONTESTS[s.contest].name;
      box.push(cell(st.qsos, 'QSOs'));
      if (st.mults != null) box.push(cell(st.mults, st.multLabel));
      box.push(cell(st.rate, 'QSOs last 60 min'));
      if (st.score != null) box.push(cell(st.score, 'est. score'));
      if (st.dupes) box.push(cell(st.dupes, 'dupes'));
      E.note.textContent = 'Approximate: ' + st.note;
    } else if (s.type === 'POTA' || s.type === 'SOTA') {
      const today = utcNow().date;
      E.statsTitle.textContent = s.type === 'POTA' ? 'Activation progress (this UTC day)' : 'Activation progress';
      for (const ref of s.my_refs) {
        const pr = FX.activationProgress(s.type, list, ref, today);
        const info = (s.ref_info || {})[ref];
        box.push(`<div class="stat wide"><b>${pr.count}/${pr.needed}</b><span>${esc(ref)}${info && info.name ? ' · ' + esc(info.name) : ''}${pr.valid ? ' ✓ valid' : ''}</span>
          <progress max="${pr.needed}" value="${Math.min(pr.count, pr.needed)}"></progress></div>`);
        if (s.type === 'SOTA') box.push(cell(info && info.points ? info.points : '?', 'summit points' + (info && info.points ? '' : ' (look up online)')));
      }
      const p2p = list.filter(q => q.sig_info || q.sota_ref).length;
      box.push(cell(p2p, s.type === 'POTA' ? 'park-to-park' : 'summit-to-summit / P2P'));
      E.note.textContent = s.type === 'POTA'
        ? 'POTA needs 10 QSOs from the park in one UTC day. Counted here: unique call + band + mode + their park, today (UTC).'
        : 'SOTA: 1 QSO makes it an activation; 4 QSOs with different stations are needed to claim the summit points.';
    } else {
      E.statsTitle.textContent = 'Hunting';
      box.push(cell(list.length, 'QSOs'));
      box.push(cell(new Set(list.map(q => q.sig_info || q.sota_ref).filter(Boolean)).size, 'parks/summits'));
      E.note.textContent = 'Hunters don\u2019t upload logs to POTA; you get credit from the activator\u2019s log. SOTA chasers can upload the SOTA CSV.';
    }
    E.stats.innerHTML = box.join('');
  }

  function render() {
    if (!api) return;
    const s = S.active;
    E.start.hidden = !!s; E.update.hidden = !s; E.end.hidden = !s;
    E.type.disabled = !!s;
    E.activePill.hidden = !s;
    if (s) E.activePill.textContent = 'Active · ' + (s.type === 'CONTEST' ? FX.CONTESTS[s.contest].name : s.type === 'HUNT' ? 'Hunting' : s.type + ' ' + s.my_refs.join(','));
    E.form.hidden = E.statsCard.hidden = E.exportCard.hidden = E.listCard.hidden = !s;
    setupView();
    if (!s) return;
    const isC = s.type === 'CONTEST';
    E.contestEntry.hidden = !isC;
    E.actEntry.hidden = isC;
    E.formTitle.textContent = isC ? 'Contest entry' : s.type === 'HUNT' ? 'Hunter entry' : 'Activation entry';
    E.call.setAttribute('enterkeyhint', 'next');
    if (isC) { E.sent.textContent = sentText(); E.rcvdHint.textContent = '(' + FX.CONTESTS[s.contest].rcvdHint + ')'; }
    E.theirLbl.textContent = s.type === 'HUNT' ? 'Their park / summit (required)' : s.type === 'POTA' ? 'Their park (park-to-park), optional' : 'Their summit (summit-to-summit) or park, optional';
    E.expCab.hidden = !isC;
    E.expPota.hidden = s.type !== 'POTA';
    E.expSota.hidden = !(s.type === 'SOTA' || (s.type === 'HUNT' && sessQsos().some(q => q.sota_ref)));
    E.expHint.textContent = isC ? 'ADIF carries CONTEST_ID, STX/SRX and STX_STRING/SRX_STRING. Check the Cabrillo header before submitting it to the sponsor.'
      : s.type === 'POTA' ? 'One file per park per UTC day, named CALL@PARK-YYYYMMDD.adi as POTA asks. Upload them at pota.app (My Logs).'
        : s.type === 'SOTA' ? 'Upload the CSV (or ADIF with MY_SOTA_REF) at sotadata.org.uk.' : 'ADIF has SIG/SIG_INFO (POTA) and SOTA_REF for each contact.';
    E.utc.textContent = utcNow().text;
    const list = sessQsos().slice().sort((a, b) => FX.qsoMs(b) - FX.qsoMs(a));
    E.listCount.textContent = '(' + list.length + ')';
    E.list.innerHTML = list.slice(0, 15).map(q => `<li class="qso" data-id="${esc(q.id)}"><div class="q-main"><span class="q-call">${esc(q.call)}</span>
      <span class="q-tag">${esc(q.band)}</span><span class="q-tag">${esc(H.modeLabel(q.mode, q.submode))}</span>
      ${q.stx ? '<span class="q-tag">#' + esc(q.stx) + '</span>' : ''}
      ${q.srx || q.srx_string ? '<span class="q-tag">' + esc([q.srx, q.srx_string].filter(Boolean).join(' ')) + '</span>' : ''}
      ${q.sig_info ? '<span class="q-tag p2p">' + (q.my_sig_info ? 'P2P ' : '') + esc(q.sig_info) + '</span>' : ''}
      ${q.sota_ref ? '<span class="q-tag p2p">' + (q.my_sota_ref ? 'S2S ' : '') + esc(q.sota_ref) + '</span>' : ''}
      <span class="q-time">${esc(String(q.time_on).slice(0, 2) + ':' + String(q.time_on).slice(2, 4))}Z</span></div></li>`).join('');
    renderStats();
    liveCheck();
  }

  function loadSetupForm(s) {
    E.type.value = s.type;
    if (s.type === 'CONTEST') {
      E.contest.value = s.contest; E.cid.value = s.contest_id || ''; E.exch.value = s.exch_sent || ''; E.loc.value = s.location || '';
      E.power.value = s.cat_power || 'LOW'; E.serial.value = s.next_serial || 1;
    } else if (s.my_refs) E.myref.value = s.my_refs.join(',');
  }

  /* ---------------- events ---------------- */
  function bind() {
    E.type.addEventListener('change', setupView);
    E.contest.addEventListener('change', setupView);
    E.start.addEventListener('click', startSession);
    E.update.addEventListener('click', updateSession);
    E.end.addEventListener('click', endSession);
    E.lookup.addEventListener('click', () => lookupMine(true));
    E.form.addEventListener('submit', onLog);
    E.clear.addEventListener('click', () => { clearEntry(); E.call.focus(); });
    E.call.addEventListener('input', () => {
      const pos = E.call.selectionStart, v = E.call.value.toUpperCase().replace(/\s+/g, '');
      if (v !== E.call.value) { E.call.value = v; try { E.call.setSelectionRange(pos, pos); } catch (e) { /* */ } }
      liveCheck();
    });
    const next = () => (S.active && S.active.type === 'CONTEST' ? E.rcvd : E.their);
    E.call.addEventListener('keydown', e => {
      if (!S.active) return;
      const isC = S.active.type === 'CONTEST';
      const needNext = isC ? !E.rcvd.value.trim() : (S.active.type === 'HUNT' && !E.their.value.trim());
      if (e.key === ' ' || (e.key === 'Enter' && needNext)) { e.preventDefault(); next().focus(); }
    });
    [E.rcvd, E.their, E.rsts, E.rstr].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onLog(); } }));
    E.their.addEventListener('input', liveCheck);
    E.form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); clearEntry(); E.call.focus(); } });
    [E.band, E.mode].forEach(el => el.addEventListener('change', liveCheck));
    E.freq.addEventListener('input', () => { const p = H.parseFreq(E.freq.value); if (p.mhz) { const b = H.bandFromFreq(p.mhz); if (b) E.band.value = b; } liveCheck(); });
    E.list.addEventListener('click', e => { const li = e.target.closest('.qso'); if (li) api.startEdit(li.dataset.id, 'ops'); });
    E.expAdif.addEventListener('click', exportAdif);
    E.expCab.addEventListener('click', exportCab);
    E.expPota.addEventListener('click', exportPota);
    E.expSota.addEventListener('click', exportSota);
    setInterval(() => { if (!E.form.hidden) E.utc.textContent = utcNow().text; }, 5000);
  }

  window.HamOps = {
    async init(appApi) {
      api = appApi;
      fillSelects(); bind();
      S.sessions = await DB.getSessions();
      const id = await DB.getMeta('activeSession');
      S.active = S.sessions.find(s => s.id === id && !s.ended) || null;
      if (S.active) loadSetupForm(S.active);
      const l = api.state.last || {};
      E.band.value = l.band || '20m';
      E.mode.value = H.modeByKey(l.modeKey) ? l.modeKey : 'SSB';
      E.freq.value = l.freq || '';
      setupView();
    },
    render,
    sessions: () => S.sessions.slice(),
    async mergeSessions(list) {
      for (const x of list) if (x && x.id && !S.sessions.some(s => s.id === x.id)) await saveSession(x);
    }
  };
})();
