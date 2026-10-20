/* HamLog credential-vault crypto (pure; browser: window.HamVaultCrypto, Node: require).
   PORTED VERBATIM from SatPass 1.3.5 js/sources.js (TheRiotCoder/satpass @ 43f20ae), the reviewed vault design:
   random 256-bit data key (AES-GCM) wrapped by PBKDF2-SHA256 600k passphrase key, optional WebAuthn-PRF wrap (HKDF, padded to 128 bytes,
   AAD-bound), AAD-bound backup header. Only names/labels changed (satpass-* -> hamlog-* domain strings), so HamLog and SatPass blobs are not
   interchangeable even on the shared github.io origin. Do not edit the crypto here without re-reviewing it. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(); else root.HamVaultCrypto = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function SourceError(kind, message, status) { var e = new Error(message); e.name = "SourceError"; e.kind = kind; e.status = status || 0; return e; }
  function redact(text, secrets) {
    var s = String(text == null ? "" : text);
    (secrets || []).forEach(function (x) { if (x && String(x).length >= 4) { s = s.split(String(x)).join("***"); try { s = s.split(encodeURIComponent(String(x))).join("***"); } catch (e) {} } });
    return s.replace(/(apikey|api_key|token|password|identity)=([^&\s"']+)/ig, "$1=***").replace(/(Token\s+)[A-Za-z0-9_-]{8,}/g, "$1***");
  }
  /* ---------- optional passphrase encryption of the stored credentials (WebCrypto PBKDF2 -> AES-GCM) ---------- */
  function b64(buf) { var s = "", a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64")); }
  function unb64(str) { var s = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("binary"), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function getSubtle(c) { c = c || (typeof crypto !== "undefined" ? crypto : null); if (!c || !c.subtle) throw SourceError("config", "This browser has no WebCrypto (needs HTTPS)."); return c; }
  var PBKDF2_ITER = 600000, ITER_MIN = 100000, ITER_MAX = 2000000, MIN_PASSPHRASE = 10;   // OWASP 2023: >= 600k for PBKDF2-HMAC-SHA256. Blobs written by 1.2.0 used 250k and still decrypt.
  function clampIter(n) { n = Math.floor(Number(n)); return isFinite(n) ? Math.min(ITER_MAX, Math.max(ITER_MIN, n)) : PBKDF2_ITER; }   // a tampered blob can neither hang the tab (iter 1e9) nor weaken the KDF
  function deriveKey(c, pass, salt, iter) {
    return c.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]).then(function (k) {
      return c.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function aadParams(iv, aad) { var p = { name: "AES-GCM", iv: iv }; if (aad) p.additionalData = new TextEncoder().encode(aad); return p; }
  function encryptCreds(obj, pass, c, aad) {
    c = getSubtle(c); var salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    return deriveKey(c, pass, salt, PBKDF2_ITER).then(function (key) { return c.subtle.encrypt(aadParams(iv, aad), key, new TextEncoder().encode(JSON.stringify(obj))); })
      .then(function (ct) { return { enc: 1, iter: PBKDF2_ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }; });
  }
  function decryptCreds(blob, pass, c, aad) {
    c = getSubtle(c);
    return deriveKey(c, pass, unb64(blob.salt), clampIter(blob.iter)).then(function (key) { return c.subtle.decrypt(aadParams(unb64(blob.iv), aad), key, unb64(blob.ct)); })
      .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); }, function () { throw SourceError("auth", "Wrong passphrase."); });
  }

  /* ---------- 1.3.0: biometric key wrapping (WebAuthn PRF), encrypted backup file, auto-lock rule ---------- */
  // The vault stays "passphrase -> PBKDF2 -> AES-GCM" (unchanged, still decrypts 1.2.x blobs). Biometric unlock adds a SECOND, independent door:
  // the passphrase is wrapped (AES-GCM) with a key derived (HKDF-SHA256) from a 32-byte WebAuthn PRF output that only the platform authenticator
  // can produce after user verification. The record is useless without the authenticator; the passphrase always remains the recovery path.
  var BIO_INFO = "hamlog-vault-bio-v2";
  function prfBytes(p) { var u = p instanceof Uint8Array ? p : new Uint8Array(p || 0); if (u.length < 32) throw SourceError("config", "The authenticator returned no usable PRF secret."); return u.slice(0, 32); }
  function bioKey(c, prf, salt) {
    return Promise.resolve().then(function () { return c.subtle.importKey("raw", prfBytes(prf), "HKDF", false, ["deriveKey"]); }).then(function (k) {
      return c.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: salt, info: new TextEncoder().encode(BIO_INFO) }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function bioAad(rec) { return new TextEncoder().encode(BIO_INFO + "|" + rec.rpId + "|" + rec.credId + "|" + rec.prfSalt); }
  var PAD_TO = 128;   // wrapped secrets are padded to a fixed size so the ciphertext length says nothing about the secret
  function padSecret(bytes) { if (bytes.length > PAD_TO - 2) throw SourceError("config", "Secret too long to wrap."); var out = new Uint8Array(PAD_TO); out[0] = bytes.length >> 8; out[1] = bytes.length & 255; out.set(bytes, 2); return out; }
  function unpadSecret(buf) { var u = new Uint8Array(buf), n = (u[0] << 8) | u[1]; if (u.length !== PAD_TO || n > PAD_TO - 2) throw new Error("bad padding"); return u.slice(2, 2 + n); }
  function validBioRecord(r) {
    var ok = function (v, max) { return typeof v === "string" && v.length > 0 && v.length <= max; };
    return !!(r && typeof r === "object" && r.v === 2 && ok(r.credId, 1400) && ok(r.prfSalt, 100) && ok(r.rpId, 253) && ok(r.hk, 100) && ok(r.iv, 40) && ok(r.ct, 2000));
  }
  // Shared-origin hosts: every app under the same host name shares localStorage and can ask the same passkey, so biometric unlock is not offered there.
  // The page cannot tell whether OTHER apps live on its host. Known shared: *.github.io (all of an account's Pages sites). NOT detectable: a GitHub Pages custom domain on the
  // user site (it serves every project repo of the account from that one origin, so it is just as shared) and any host that serves several apps. Biometric unlock therefore
  // needs a host dedicated to HamLog (own Netlify/Cloudflare site, or a Pages custom domain used only by HamLog while the other apps live on other hosts) - the
  // user's responsibility; see the README. localhost (development) is allowed.
  function sharedOrigin(host) { host = String(host || "").toLowerCase().replace(/\.$/, ""); return host === "github.io" || /\.github\.io$/.test(host); }
  // meta: {credId (base64url), prfSalt (base64), rpId}; prf: the 32-byte PRF output for prfSalt. What is wrapped is the random vault DATA KEY (never the passphrase).
  // Returns a Promise (a short PRF rejects, it does not throw).
  function wrapSecret(secret, prf, meta, c) {
    return Promise.resolve().then(function () {
      c = getSubtle(c); var hk = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
      var rec = { v: 2, credId: meta.credId, prfSalt: meta.prfSalt, rpId: meta.rpId, created: Date.now(), hk: b64(hk), iv: b64(iv) }, plain = padSecret(new TextEncoder().encode(String(secret)));
      return bioKey(c, prf, hk).then(function (key) { return c.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: bioAad(rec) }, key, plain); })
        .then(function (ct) { rec.ct = b64(ct); return rec; });
    });
  }
  function unwrapSecret(rec, prf, c) {
    return Promise.resolve().then(function () {
      c = getSubtle(c); if (!validBioRecord(rec)) throw SourceError("config", "The stored biometric record is damaged or from an older version – remove it and set it up again.");
      return bioKey(c, prf, unb64(rec.hk)).then(function (key) { return c.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv), additionalData: bioAad(rec) }, key, unb64(rec.ct)); })
        .then(function (pt) { return new TextDecoder().decode(unpadSecret(pt)); }, function (e) { if (e && e.kind) throw e; throw SourceError("auth", "The biometric key did not match this vault – use your passphrase and set biometric unlock up again."); });
    });
  }

  /* ---------- vault v2 (1.3.2): credentials are encrypted under a random 256-bit DATA KEY; the data key is wrapped by the passphrase-derived key
     (PBKDF2-SHA256 600k -> AES-GCM) and, optionally, by the WebAuthn-PRF key above. Changing the passphrase re-wraps only the data key; the passphrase is never
     stored or recoverable from the biometric record. Blobs written by 1.2.x/1.3.x ({enc:1}) still open with the passphrase and are migrated on that unlock. */
  function vaultAad(kind, h) { return new TextEncoder().encode("hamlog-vault-v2|" + kind + "|" + h.iter + "|" + h.salt); }
  function vaultHeader(blob) { return { iter: blob.iter, salt: blob.salt, wiv: blob.wiv, wk: blob.wk }; }
  function dataKey(c, dek) { return c.subtle.importKey("raw", dek, "AES-GCM", false, ["encrypt", "decrypt"]); }
  // The key bytes are COPIED synchronously on entry: callers may zero their own array (lock) at any later moment without affecting an operation already in flight.
  function sealVault(creds, dek, hdr, c) {   // new ciphertext under the same wrapped key
    var own = new Uint8Array(dek), snap = JSON.stringify(creds); hdr = { iter: hdr.iter, salt: hdr.salt, wiv: hdr.wiv, wk: hdr.wk };
    return Promise.resolve().then(function () {
      c = getSubtle(c); dek = own; var iv = c.getRandomValues(new Uint8Array(12));
      return dataKey(c, dek).then(function (k) { return c.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: vaultAad("creds", hdr) }, k, new TextEncoder().encode(snap)); })
        .then(function (ct) { return { enc: 2, iter: hdr.iter, salt: hdr.salt, wiv: hdr.wiv, wk: hdr.wk, iv: b64(iv), ct: b64(ct) }; });
    });
  }
  // wrap `dek` (or a fresh random one) with a passphrase and seal the credentials -> {blob, dek}
  function createVault(creds, pass, dek, c) {
    var snap = JSON.parse(JSON.stringify(creds || {})), own = dek ? new Uint8Array(dek) : null;   // (copies: never share a mutable key array across async work)
    return Promise.resolve().then(function () {
      c = getSubtle(c); creds = snap; dek = own || c.getRandomValues(new Uint8Array(32));
      var salt = c.getRandomValues(new Uint8Array(16)), wiv = c.getRandomValues(new Uint8Array(12)), hdr = { iter: PBKDF2_ITER, salt: b64(salt), wiv: b64(wiv) };
      return deriveKey(c, pass, salt, PBKDF2_ITER).then(function (kek) { return c.subtle.encrypt({ name: "AES-GCM", iv: wiv, additionalData: vaultAad("dek", hdr) }, kek, dek); })
        .then(function (wk) { hdr.wk = b64(wk); return sealVault(creds, dek, hdr, c); }).then(function (blob) { return { blob: blob, dek: dek }; });
    });
  }
  function validVault(b) { return !!(b && b.enc === 2 && typeof b.salt === "string" && typeof b.wiv === "string" && typeof b.wk === "string" && typeof b.iv === "string" && typeof b.ct === "string"); }
  function openWithDek(blob, dek, c) {
    return Promise.resolve().then(function () {
      c = getSubtle(c); if (!validVault(blob)) throw SourceError("config", "The stored credentials are in an older format – unlock them with your passphrase.");
      return dataKey(c, dek).then(function (k) { return c.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv), additionalData: vaultAad("creds", blob) }, k, unb64(blob.ct)); })
        .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); }, function () { throw SourceError("auth", "The stored key does not open these credentials."); });
    });
  }
  // open with the passphrase: -> {creds, dek, hdr, legacy}. Legacy ({enc:1}) blobs return dek:null, legacy:true (the caller migrates).
  function openVault(blob, pass, c) {
    return Promise.resolve().then(function () {
      c = getSubtle(c);
      if (!blob || blob.enc !== 2) return decryptCreds(blob, pass, c).then(function (creds) { return { creds: creds, dek: null, hdr: null, legacy: true }; });
      if (!validVault(blob)) throw SourceError("config", "The stored credentials are damaged.");
      return deriveKey(c, pass, unb64(blob.salt), clampIter(blob.iter)).then(function (kek) { return c.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.wiv), additionalData: vaultAad("dek", blob) }, kek, unb64(blob.wk)); })
        .then(function (d) { return new Uint8Array(d); }, function () { throw SourceError("auth", "Wrong passphrase."); })
        .then(function (dek) { return openWithDek(blob, dek, c).then(function (creds) { return { creds: creds, dek: dek, hdr: vaultHeader(blob), legacy: false }; }); });
    });
  }

  var BACKUP_APP = "hamlog-credentials-backup";
  function backupAad(h) { return "hamlog-backup|" + h.app + "|" + h.v + "|" + h.created + "|" + h.note; }   // the header travels outside the ciphertext but is bound to it
  function exportBackup(creds, proxy, pass, c) {
    if (!pass || String(pass).length < MIN_PASSPHRASE) return Promise.reject(SourceError("config", "Use a backup passphrase of at least " + MIN_PASSPHRASE + " characters."));
    if (!creds || !Object.keys(creds).length) return Promise.reject(SourceError("config", "There are no credentials to back up."));
    var head = { app: BACKUP_APP, v: 2, created: new Date().toISOString(), note: "HamLog encrypted credentials backup (PBKDF2-SHA256 " + PBKDF2_ITER + " iterations, AES-GCM, header authenticated). Useless without its passphrase. Import it in HamLog → Settings → Callsign lookup." };
    return encryptCreds({ creds: creds, proxy: proxy || "" }, pass, c, backupAad(head)).then(function (blob) { head.blob = blob; return JSON.stringify(head, null, 1); });
  }
  function importBackup(text, pass, c) {
    var o; try { o = JSON.parse(String(text).slice(0, 200000)); } catch (e) { return Promise.reject(SourceError("parse", "That file is not a HamLog credentials backup.")); }
    if (!o || o.app !== BACKUP_APP || (o.v !== 1 && o.v !== 2) || !o.blob || o.blob.enc !== 1 || typeof o.blob.ct !== "string" || typeof o.blob.salt !== "string" || typeof o.blob.iv !== "string") return Promise.reject(SourceError("parse", "That file is not a HamLog credentials backup."));
    return decryptCreds(o.blob, pass, c, o.v === 2 ? backupAad(o) : undefined).then(function (p) {   // v1 files (1.3.0/1.3.1) have no header binding and still import
      if (!p || typeof p !== "object" || !p.creds || typeof p.creds !== "object") throw SourceError("parse", "The backup is empty or damaged.");
      return { creds: p.creds, proxy: typeof p.proxy === "string" ? p.proxy : "" };
    }, function (e) { throw e.kind === "auth" ? SourceError("auth", "Wrong backup passphrase.") : e; });
  }

  // auto-lock rule (pure): cfg {idleMin, hiddenMin} (0 = off); st {now, lastActive, hiddenSince|null} -> "hidden" | "idle" | null
  var VAULT_DEFAULT = { idleMin: 15, hiddenMin: 5 };
  function normalizeVaultCfg(c) {
    function m(v, d) { var n = Math.floor(Number(v)); return isFinite(n) && v !== "" && v != null ? Math.min(720, Math.max(0, n)) : d; }
    c = c || {}; return { idleMin: m(c.idleMin, VAULT_DEFAULT.idleMin), hiddenMin: m(c.hiddenMin, VAULT_DEFAULT.hiddenMin) };
  }
  function lockDue(cfg, st) {
    cfg = normalizeVaultCfg(cfg);
    if (st.hiddenSince != null && cfg.hiddenMin > 0 && st.now - st.hiddenSince >= cfg.hiddenMin * 60e3) return "hidden";
    if (cfg.idleMin > 0 && st.now - st.lastActive >= cfg.idleMin * 60e3) return "idle";
    return null;
  }

  return {
    PBKDF2_ITER: PBKDF2_ITER, ITER_MIN: ITER_MIN, ITER_MAX: ITER_MAX, MIN_PASSPHRASE: MIN_PASSPHRASE, clampIter: clampIter, SourceError: SourceError, redact: redact,
    encryptCreds: encryptCreds, decryptCreds: decryptCreds, wrapSecret: wrapSecret, unwrapSecret: unwrapSecret, validBioRecord: validBioRecord, sharedOrigin: sharedOrigin,
    createVault: createVault, openVault: openVault, openWithDek: openWithDek, sealVault: sealVault, validVault: validVault, vaultHeader: vaultHeader,
    exportBackup: exportBackup, importBackup: importBackup, BACKUP_APP: BACKUP_APP, normalizeVaultCfg: normalizeVaultCfg, lockDue: lockDue, VAULT_DEFAULT: VAULT_DEFAULT
  };
});
