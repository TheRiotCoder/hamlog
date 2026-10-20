/*
 * HamLog callsign lookup (pure core; browser: window.HamLookup, Node: require).
 * Sources, in order: QRZ.com XML (needs a QRZ login; FREE accounts get name + city + country only), HamQTH XML (free HamQTH login;
 * name, QTH, country, grid), callook.info (US calls, no login; name, city, grid), and an offline call-sign-prefix -> country table
 * (approximate). Every result field is labelled with the source it came from. Credentials are only ever passed in to a request
 * and are redacted from every message.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HamLookup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- tiny XML helpers (QRZ/HamQTH answers are flat; regex keeps it Node-testable) ---------------- */
  function unxml(s) {
    return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').trim();
  }
  function block(xml, tag) { const m = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i').exec(xml); return m ? m[1] : null; }
  function fields(inner) {
    const o = {}; if (!inner) return o;
    const re = /<([A-Za-z_][\w]*)\b[^>]*>([\s\S]*?)<\/\1>/g; let m;
    while ((m = re.exec(inner))) o[m[1].toLowerCase()] = unxml(m[2]);
    return o;
  }
  function parseQrz(xml) {
    const s = fields(block(xml, 'Session')), c = block(xml, 'Callsign');
    return { key: s.key || '', error: s.error || '', message: s.message || '', subExp: s.subexp || '', count: s.count ? +s.count : null, rec: c ? fields(c) : null };
  }
  function parseHamqth(xml) {
    const s = fields(block(xml, 'session')), c = block(xml, 'search');
    return { sessionId: s.session_id || '', error: s.error || '', rec: c ? fields(c) : null };
  }

  /* ---------------- normalised results ---------------- */
  function titleIfCaps(s) { s = String(s || '').trim(); return s && s === s.toUpperCase() && /[A-Z]{2}/.test(s) ? s.toLowerCase().replace(/(^|[\s\-'])\S/g, x => x.toUpperCase()) : s; }
  function cleanGrid(g) { g = String(g || '').trim(); return /^[A-R]{2}\d{2}([A-X]{2})?$/i.test(g) ? g.slice(0, 2).toUpperCase() + g.slice(2, 4) + g.slice(4).toLowerCase() : ''; }
  function fromQrz(r) {
    const name = r.name_fmt || [r.fname, r.name].filter(Boolean).join(' ');
    return { name: titleIfCaps(name), qth: titleIfCaps(r.addr2 || ''), state: (r.state || '').toUpperCase(), country: r.country || r.land || '', grid: cleanGrid(r.grid) };
  }
  function fromHamqth(r) {
    return { name: titleIfCaps(r.adr_name || r.nick || ''), qth: titleIfCaps(r.qth || r.adr_city || ''), state: (r.us_state || '').toUpperCase(), country: r.country || '', grid: cleanGrid(r.grid) };
  }
  function fromCallook(j) {
    if (!j || j.status !== 'VALID') return null;
    const l2 = (j.address && j.address.line2) || '', m = /^(.*?),\s*([A-Z]{2})\b/.exec(l2);
    return { name: titleIfCaps(j.name || ''), qth: m ? titleIfCaps(m[1]) : '', state: m ? m[2] : '', country: 'United States', grid: cleanGrid(j.location && j.location.gridsquare) };
  }

  /* ---------------- offline prefix -> DXCC country (approximate; longest prefix wins) ---------------- */
  // Compact table of common ITU prefix blocks. Not a full DXCC database: special/portable allocations and some islands are not covered.
  const PFX = ('K,W,N,AA,AB,AC,AD,AE,AF,AG,AI,AJ,AK=United States;KH6,WH6,NH6,AH6=Hawaii;KL7,WL7,NL7,AL7=Alaska;KP4,WP4,NP4,KP3,NP3=Puerto Rico;KP2,WP2,NP2=US Virgin Islands;KH2,WH2,NH2=Guam;' +
    'VE,VA,VY,VO,CY,CF,CG,CJ,CK,XL=Canada;XE,XF,4A,6D=Mexico;' +
    'G,M,2E,2M,2I,2D,2W,2J,2U,GB=England;GM,MM,2M0=Scotland;GW,MW,2W0=Wales;GI,MI,2I0=Northern Ireland;GD,MD=Isle of Man;GJ,MJ=Jersey;GU,MU=Guernsey;EI,EJ=Ireland;' +
    'F,TM=France;DL,DA,DB,DC,DD,DF,DG,DH,DJ,DK,DM,DO,DP,DQ,DR=Germany;I,IK,IZ,IW,IU,IQ=Italy;EA,EB,EC,ED,EE,EF,EG,EH,AM,AN,AO=Spain;EA6=Balearic Islands;EA8=Canary Islands;CT,CS,CQ=Portugal;CT3=Madeira;CU=Azores;' +
    'PA,PB,PC,PD,PE,PF,PG,PH,PI=Netherlands;ON,OO,OP,OQ,OR,OS,OT=Belgium;LX=Luxembourg;HB,HE=Switzerland;HB0=Liechtenstein;OE=Austria;OK,OL=Czech Republic;OM=Slovak Republic;SP,SQ,SN,SO,3Z,HF=Poland;HA,HG=Hungary;' +
    'S5=Slovenia;9A=Croatia;E7=Bosnia-Herzegovina;YU,YT=Serbia;4O=Montenegro;Z3=North Macedonia;ZA=Albania;LZ=Bulgaria;YO,YP,YQ,YR=Romania;ER=Moldova;SV,SW,SX,SY,SZ,J4=Greece;SV9=Crete;5B,C4,P3=Cyprus;9H=Malta;' +
    'OZ,OU,OV,5P,5Q=Denmark;OX=Greenland;OY=Faroe Islands;LA,LB,LC,LD,LE,LF,LG,LH,LI,LJ,LK,LL,LM,LN=Norway;JW=Svalbard;SM,SA,SB,SC,SD,SE,SF,SG,SH,SI,SJ,SK,SL,7S,8S=Sweden;OH,OF,OG,OI=Finland;OH0=Aland Islands;TF=Iceland;' +
    'ES=Estonia;YL=Latvia;LY=Lithuania;EU,EV,EW=Belarus;UR,US,UT,UU,UV,UW,UX,UY,UZ,EM,EN,EO=Ukraine;' +
    'R,RA,RK,RN,RU,RV,RW,RX,RZ,UA,UB,UC,UD,UE,UF,UG,UH,UI=Russia;UA2,RA2=Kaliningrad;UA9,UA0,RA9,RA0,RU9,RU0,RW9,RW0,RZ9,RZ0,R9,R0=Asiatic Russia;' +
    'TA,TB,TC,YM=Turkey;4X,4Z=Israel;JY=Jordan;OD=Lebanon;HZ,7Z,8Z=Saudi Arabia;A6=United Arab Emirates;A7=Qatar;A9=Bahrain;A4=Oman;9K=Kuwait;EP,EQ=Iran;YI=Iraq;4L=Georgia;EK=Armenia;4J,4K=Azerbaijan;UN,UP,UQ=Kazakhstan;' +
    'JA,JE,JF,JG,JH,JI,JJ,JK,JL,JM,JN,JO,JP,JQ,JR,JS,7J,7K,7L,7M,7N,8J,8N=Japan;HL,DS,DT,6K,6L,6M,6N=South Korea;BV,BM,BN,BO,BP,BQ,BU,BW,BX=Taiwan;B,BA,BD,BG,BH,BI,BY,BT,BZ=China;VR2=Hong Kong;XX9=Macao;' +
    'VU,AT,AU,AV,AW,8T,8U=India;AP,6P,6Q=Pakistan;S2=Bangladesh;4S=Sri Lanka;9N=Nepal;HS,E2=Thailand;XV,3W=Vietnam;9M2,9M4=West Malaysia;9M6,9M8=East Malaysia;9V=Singapore;YB,YC,YD,YE,YF,YG,YH,8A,8B,8C,8E,8F,8G,8H,8I=Indonesia;DU,DV,DW,DX,DY,DZ,4D,4E,4F,4G,4H,4I=Philippines;' +
    'VK,AX=Australia;ZL,ZM=New Zealand;P2=Papua New Guinea;3D2=Fiji;FK=New Caledonia;FO=French Polynesia;KH0=Mariana Islands;V7=Marshall Islands;T8=Palau;' +
    'ZS,ZR,ZT,ZU=South Africa;5Z=Kenya;5H=Tanzania;5X=Uganda;ET=Ethiopia;SU=Egypt;CN,5C,5D,5E,5F,5G=Morocco;7X=Algeria;3V=Tunisia;5A=Libya;5N=Nigeria;9G=Ghana;6W=Senegal;D2=Angola;C9=Mozambique;Z2=Zimbabwe;A2=Botswana;V5=Namibia;9J=Zambia;7Q=Malawi;5R=Madagascar;3B8=Mauritius;FR=Reunion;D4=Cape Verde;' +
    'LU,LO,LP,LQ,LR,LS,LT,LV,LW,AY,AZ,L2,L3,L4,L5,L6,L7,L8,L9=Argentina;PY,PP,PQ,PR,PS,PT,PU,PV,PW,PX,ZV,ZW,ZX,ZY,ZZ=Brazil;CE,CA,CB,CC,CD,XQ,XR,3G=Chile;CX,CV,CW=Uruguay;ZP=Paraguay;CP=Bolivia;OA,OB,OC,4T=Peru;HC,HD=Ecuador;HK,HJ,5J,5K=Colombia;YV,YW,YX,YY,4M=Venezuela;' +
    'TI,TE=Costa Rica;HP,HO,3E,3F=Panama;YN,H6,H7=Nicaragua;HR,HQ=Honduras;YS,HU=El Salvador;TG,TD=Guatemala;V3=Belize;CO,CM,CL,T4=Cuba;HI=Dominican Republic;HH=Haiti;6Y=Jamaica;C6=Bahamas;8P=Barbados;9Y,9Z=Trinidad & Tobago;J6=St. Lucia;J3=Grenada;J7=Dominica;J8=St. Vincent;V2=Antigua & Barbuda;V4=St. Kitts & Nevis;PJ2=Curacao;PJ4=Bonaire;P4=Aruba;FG=Guadeloupe;FM=Martinique;VP9=Bermuda;VP5=Turks & Caicos;VP2E=Anguilla;VP2M=Montserrat;VP2V=British Virgin Islands;ZF=Cayman Islands;KG4=Guantanamo Bay')
    .split(';').reduce((m, part) => { const i = part.indexOf('='); part.slice(0, i).split(',').forEach(p => { m[p] = part.slice(i + 1); }); return m; }, {});
  // KG4 is Guantanamo only for 2x1 calls (KG4AA); longer KG4 calls are US stations.
  function prefixCountry(call) {
    const c = String(call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
    const parts = c.split('/').filter(x => x && !/^(P|M|MM|AM|QRP|A|\d)$/.test(x));
    if (!parts.length) return null;
    let base = parts.length > 1 ? parts.slice().sort((a, b) => a.length - b.length)[0] : parts[0];
    if (/^\d$/.test(base)) base = parts[0];
    for (let n = Math.min(4, base.length); n >= 1; n--) {
      const p = base.slice(0, n);
      if (PFX[p]) {
        if (p === 'KG4' && !/^KG4[A-Z]{2}$/.test(base)) return { country: 'United States', prefix: 'K' };
        return { country: PFX[p], prefix: p };
      }
    }
    return null;
  }
  function isUsCall(call) { const pc = prefixCountry(call); return !!pc && /^(United States|Alaska|Hawaii|Puerto Rico|US Virgin Islands|Guam|Mariana Islands|Guantanamo Bay)$/.test(pc.country) && !/\//.test(call); }

  /* ---------------- merge ---------------- */
  const OUT = ['name', 'qth', 'state', 'country', 'grid'];
  function merge(parts) {   // parts: [{source, data}] in priority order; first non-empty value per field wins, with its source
    const out = { fields: {}, sources: {} };
    for (const p of parts) if (p && p.data) for (const k of OUT) if (!out.fields[k] && p.data[k]) { out.fields[k] = p.data[k]; out.sources[k] = p.source; }
    return out;
  }

  /* ---------------- client (fetch injected; works with a mock in tests) ---------------- */
  const QRZ_URL = 'https://xmldata.qrz.com/xml/current/', HAMQTH_URL = 'https://www.hamqth.com/xml.php', CALLOOK_URL = 'https://callook.info/';
  function enc(v) { return encodeURIComponent(String(v)); }
  function LookupError(kind, msg) { const e = new Error(msg); e.name = 'LookupError'; e.kind = kind; return e; }
  const CACHE_TTL = 30 * 864e5, CACHE_MAX = 500;

  /**
   * opts: { fetch, getCreds() -> {qrzUser,qrzPass,hamqthUser,hamqthPass}, cfg() -> {qrz,hamqth,callook,prefix},
   *         store {get(k), set(k,v)} (non-secret cache), session {get(k), set(k,v)} (tab-scoped: session keys), agent, now(), timeoutMs, redact(text) }
   */
  function createClient(opts) {
    const f = opts.fetch, now = opts.now || Date.now, redact = opts.redact || (t => t);
    const mem = { qrzKey: null, hqId: null, hqAt: 0, blocked: {} };
    try { const k = opts.session && opts.session.get('qrzkey'); if (k) mem.qrzKey = k; } catch (e) { /* */ }
    function setQrzKey(k) { mem.qrzKey = k || null; try { if (opts.session) opts.session.set('qrzkey', k || null); } catch (e) { /* */ } }
    /* 1.2.1: QRZ takes its parameters as a POST form body (tested 2026-10-19: login and lookup both answer, CORS "*" on the POST; an
       application/x-www-form-urlencoded POST is a CORS "simple" request, so there's no preflight). Credentials then never appear in a URL (history,
       proxy/server logs, Referer). HamQTH ignores a POST body ("Username or password missing"), so HamQTH stays GET over HTTPS - see README. */
    async function get(url, form) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctrl && setTimeout(() => ctrl.abort(), opts.timeoutMs || 8000);
      try {
        const init = form ? { method: 'POST', body: new URLSearchParams(form).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : { method: 'GET' };
        const r = await f(url, Object.assign(init, { mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctrl ? ctrl.signal : undefined }));
        if (!r.ok) throw LookupError('http', 'HTTP ' + r.status);
        return await r.text();
      } catch (e) {
        if (e && e.name === 'LookupError') throw e;
        throw LookupError('network', e && e.name === 'AbortError' ? 'timed out' : 'unreachable');
      } finally { if (t) clearTimeout(t); }
    }
    function credKey(c, a, b) { return (c[a] || '') + '\u0000' + (c[b] || '').length; }   // (changes when the login changes; nothing secret is kept)
    async function qrzLogin(c) {
      const x = parseQrz(await get(QRZ_URL, { username: c.qrzUser, password: c.qrzPass, agent: opts.agent || 'HamLog' }));
      if (!x.key) {
        const msg = x.error || 'login failed';
        if (/connection refused/i.test(msg)) { mem.blocked.qrz = { why: 'QRZ refused service for 24 h', until: now() + 864e5, ck: credKey(c, 'qrzUser', 'qrzPass') }; }
        else if (/password|username|incorrect|invalid/i.test(msg)) mem.blocked.qrz = { why: 'QRZ rejected the login', until: Infinity, ck: credKey(c, 'qrzUser', 'qrzPass') };
        throw LookupError('auth', redact(msg));
      }
      setQrzKey(x.key);
      return x;
    }
    async function qrz(call, c) {
      if (!mem.qrzKey) await qrzLogin(c);
      for (let attempt = 0; attempt < 2; attempt++) {
        const x = parseQrz(await get(QRZ_URL, { s: mem.qrzKey, callsign: call }));
        if (x.rec) { if (x.key) setQrzKey(x.key); return { data: fromQrz(x.rec), subscriber: !!x.subExp && !/non-subscriber/i.test(x.subExp), message: x.message, count: x.count }; }
        if (/^not found/i.test(x.error)) { if (x.key) setQrzKey(x.key); return { data: null, notFound: true }; }
        if (!x.key) {   // per spec: no <Key> = no valid session; log in again (once)
          setQrzKey(null);
          if (attempt === 0) { await qrzLogin(c); continue; }
        }
        throw LookupError('service', redact(x.error || 'no data'));
      }
      throw LookupError('service', 'session could not be re-established');
    }
    async function hamqth(call, c, retried) {
      if (!mem.hqId || now() - mem.hqAt > 55 * 60e3) {   // GET on purpose: HamQTH's xml.php reads only query parameters (POST body ignored, tested 2026-10-19)   // HamQTH session ids are valid for 60 minutes
        const x = parseHamqth(await get(HAMQTH_URL + '?u=' + enc(c.hamqthUser) + '&p=' + enc(c.hamqthPass)));
        if (!x.sessionId) { mem.blocked.hamqth = { why: 'HamQTH rejected the login', until: Infinity, ck: credKey(c, 'hamqthUser', 'hamqthPass') }; throw LookupError('auth', redact(x.error || 'login failed')); }
        mem.hqId = x.sessionId; mem.hqAt = now();
      }
      const x = parseHamqth(await get(HAMQTH_URL + '?id=' + enc(mem.hqId) + '&callsign=' + enc(call) + '&prg=' + enc(opts.agent || 'HamLog')));
      if (x.rec) return { data: fromHamqth(x.rec) };
      if (/not found/i.test(x.error)) return { data: null, notFound: true };
      if (/session/i.test(x.error) && !retried) { mem.hqId = null; return hamqth(call, c, true); }
      throw LookupError('service', redact(x.error || 'no data'));
    }
    async function callook(call) {
      const t = await get(CALLOOK_URL + enc(call) + '/json');
      let j; try { j = JSON.parse(t); } catch (e) { throw LookupError('parse', 'unreadable answer'); }
      const d = fromCallook(j);
      return d ? { data: d } : { data: null, notFound: true };
    }
    function isBlocked(id, c) {
      const b = mem.blocked[id]; if (!b) return null;
      const ck = id === 'qrz' ? credKey(c, 'qrzUser', 'qrzPass') : credKey(c, 'hamqthUser', 'hamqthPass');
      if (b.ck !== ck || now() > b.until) { delete mem.blocked[id]; return null; }
      return b.why;
    }
    function cacheGet(call) {
      const all = (opts.store && opts.store.get('cache')) || {}; const e = all[call];
      return e && now() - e.t < CACHE_TTL ? e : null;
    }
    function cachePut(call, entry) {
      if (!opts.store) return;
      const all = opts.store.get('cache') || {}; all[call] = Object.assign({ t: now() }, entry);
      const keys = Object.keys(all); if (keys.length > CACHE_MAX) keys.sort((a, b) => all[a].t - all[b].t).slice(0, keys.length - CACHE_MAX).forEach(k => delete all[k]);
      opts.store.set('cache', all);
    }

    /** -> {call, fields, sources, notes[], cached, offline} . Never rejects. */
    async function lookup(call, o) {
      o = o || {};
      call = String(call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
      const cfg = opts.cfg(), notes = [];
      const pfx = cfg.prefix !== false ? prefixCountry(call) : null;
      const offlineParts = pfx ? [{ source: 'prefix', data: { country: pfx.country } }] : [];
      const online = o.online !== false;
      const hit = !o.force && cacheGet(call);
      if (hit) { const m = merge(hit.parts.concat(offlineParts)); return Object.assign({ call, notes: ['cached'], cached: true, offline: !online }, m); }
      if (!online) { const m = merge(offlineParts); return Object.assign({ call, notes: ['offline'], cached: false, offline: true }, m); }
      const c = (opts.getCreds && opts.getCreds()) || {};
      const parts = [];
      let networkTried = false, networkOk = false;
      const tryOne = async (id, fn) => {
        networkTried = true;
        try { const r = await fn(); networkOk = true; if (r.data) parts.push({ source: id, data: r.data }); else if (r.notFound) notes.push(id + ': not found'); if (r.message) notes.push(id + ': ' + r.message); if (id === 'qrz' && r.subscriber === false) notes.push('qrz: free account (name, city, country only)'); }
        catch (e) { notes.push(id + ': ' + redact(e.message)); }
      };
      if (cfg.qrz && c.qrzUser && c.qrzPass) { const b = isBlocked('qrz', c); if (b) notes.push('qrz: ' + b); else await tryOne('qrz', () => qrz(call, c)); }
      const have = () => merge(parts).fields;
      if (cfg.hamqth && c.hamqthUser && c.hamqthPass && (!have().name || !have().grid)) { const b = isBlocked('hamqth', c); if (b) notes.push('hamqth: ' + b); else await tryOne('hamqth', () => hamqth(call, c)); }
      if (cfg.callook && isUsCall(call) && (!have().name || !have().grid)) await tryOne('callook', () => callook(call));
      if (networkOk) cachePut(call, { parts });
      const m = merge(parts.concat(offlineParts));
      return Object.assign({ call, notes, cached: false, offline: networkTried && !networkOk && !parts.length && notes.every(n => /unreachable|timed out/.test(n)) }, m);
    }
    return { lookup, _mem: mem, clearSession() { setQrzKey(null); mem.hqId = null; mem.blocked = {}; } };
  }

  const LABEL = { qrz: 'QRZ.com', hamqth: 'HamQTH', callook: 'callook.info (FCC)', prefix: 'call-sign prefix (offline, approximate)' };
  return { parseQrz, parseHamqth, fromQrz, fromHamqth, fromCallook, prefixCountry, isUsCall, merge, createClient, LABEL, QRZ_URL, HAMQTH_URL, CALLOOK_URL, _PFX: PFX };
});
