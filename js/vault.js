/* HamLog credential vault (browser): QRZ / HamQTH logins for callsign lookup.
   PORTED from SatPass 1.3.5 js/store.js (TheRiotCoder/satpass @ 43f20ae), the reviewed vault layer: ONE async operation queue for every vault
   operation (save, passphrase set/change, unlock, biometric enrol/unlock, lock), lock queued behind in-flight seal/wrap (no key-zeroing races),
   generation counter so Forget cancels in-flight work, data key rotated on passphrase change, biometric record deleted on rotation.
   Adapted: names, credential keys, and storage keys. Storage keys are namespaced "hamlog:vault:*" so they cannot collide with SatPass
   ("satpass:*") or garmin-lens on the shared github.io origin. No proxy, no source status.
   Storage policy: secrets are NEVER written to localStorage in plaintext. With a passphrase -> AES-GCM blob in localStorage ("encrypted");
   without -> this tab's sessionStorage + memory only ("session"; gone when the tab is closed). */
(function () {
  "use strict";
  var VC = window.HamVaultCrypto;
  var LS = "hamlog:vault:";
  function load(k, d) { try { var v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function del(k) { try { localStorage.removeItem(LS + k); } catch (e) {} }
  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) { console.error("vault listener failed"); } }); }
  var CRED_KEYS = ["qrzUser", "qrzPass", "hamqthUser", "hamqthPass"];
  var credVals = {}, credBlob = load("creds", null), credLocked = false, memKey = null, legacyPlain = false;   // memKey = {dek (random 256-bit data key, bytes), hdr (its passphrase wrapping)} while an encrypted vault is unlocked; the passphrase itself is never kept
  var SESS = null; try { SESS = typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch (e) { SESS = null; }
  function sessLoad() { try { var v = SESS && SESS.getItem(LS + "creds"); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function sessSave(o) { try { if (!SESS) return false; if (o && Object.keys(o).length) SESS.setItem(LS + "creds", JSON.stringify(o)); else SESS.removeItem(LS + "creds"); return true; } catch (e) { return false; } }
  function cleanCreds(o) { var r = {}; CRED_KEYS.forEach(function (k) { if (o && typeof o[k] === "string" && o[k]) r[k] = o[k]; }); return r; }
  if (credBlob && credBlob.enc) credLocked = true;
  else if (credBlob && Object.keys(cleanCreds(credBlob)).length) { credVals = cleanCreds(credBlob); legacyPlain = true; }
  else credVals = cleanCreds(sessLoad());
  var sessionHint = !!load("credhint", false);   // non-secret marker: credentials were entered as session-only (so an empty store after the tab closed can say so)
  function credMode() { return credLocked ? "locked" : memKey || (credBlob && credBlob.enc) ? "encrypted" : legacyPlain ? "legacy-plain" : Object.keys(credVals).length ? "session" : sessionHint ? "session-lost" : "none"; }
  function secretList() { return CRED_KEYS.map(function (k) { return credVals[k]; }); }
  function red(t) { return VC.redact(t, secretList()); }
  function lockedErr() { return VC.SourceError("locked", "Credentials are locked – unlock them with your passphrase first. Nothing was changed."); }
  /* Every operation that touches the vault (save, passphrase change/removal, unlock, biometric enrol/unlock, lock) runs through ONE queue, so a lock can never zero the
     data key while a seal/wrap that uses it is in flight (1.3.2 race: lock during a passphrase change sealed under an all-zero key; setCreds+lock in one tick corrupted the vault).
     lockNow() waits behind the pending operations; `gen` is bumped by forgetCreds so an operation that finishes after it cannot resurrect anything. */
  var vq = Promise.resolve(), vqPending = 0, lockPending = false, gen = 0;
  function enqueue(fn) {
    vqPending++;
    var p = vq.then(fn).then(function (r) { vqPending--; return r; }, function (e) { vqPending--; throw e; });   // (counter drops BEFORE the caller's promise settles)
    vq = p.then(function () {}, function () {});
    return p;
  }
  function cancelledErr() { return VC.SourceError("cancelled", "Cancelled – the credentials were cleared while this was in progress. Nothing was saved."); }
  function isLockedNow() { return credLocked || lockPending; }
  function persistNow(g) {   // g = generation at the time the caller asked (a Forget in between cancels it)
    if (credLocked) return Promise.reject(lockedErr());   // never overwrite (or delete) the encrypted blob while it cannot be decrypted
    if (g === undefined) g = gen; if (g !== gen) return Promise.reject(cancelledErr());
    if (memKey) return VC.sealVault(Object.assign({}, credVals), memKey.dek, memKey.hdr).then(function (blob) {
      if (g !== gen) throw cancelledErr();
      if (!save("creds", blob)) throw VC.SourceError("storage", "Browser storage is full or blocked – the encrypted credentials could not be saved.");
      credBlob = blob; legacyPlain = false; sessSave(null); sessionHint = false; del("credhint");
    });
    del("creds"); credBlob = null; legacyPlain = false;   // no passphrase: nothing readable is kept in localStorage
    if (Object.keys(credVals).length) { sessionHint = true; save("credhint", true); } else if (sessionHint) { sessionHint = false; del("credhint"); }
    sessSave(credVals);   // (without sessionStorage the credentials simply stay in memory)
    return Promise.resolve();
  }
  function persistCreds() { var g = gen; return enqueue(function () { return persistNow(g); }); }
  function getCreds() { return Object.assign({}, credVals); }
  function setCreds(patch) {
    if (isLockedNow()) return Promise.reject(lockedErr());
    CRED_KEYS.forEach(function (k) { if (patch && k in patch) { var v = String(patch[k] == null ? "" : patch[k]).trim(); if (v) credVals[k] = v; else delete credVals[k]; } });
    return persistCreds();
  }
  function forgetCreds() { gen++; lockPending = false; del("bio"); credVals = {}; credBlob = null; credLocked = false; wipeKey(); legacyPlain = false; sessionHint = false; del("creds"); del("credhint"); sessSave(null); emit(); }
  function wipeKey() { if (memKey && memKey.dek) { try { memKey.dek.fill(0); } catch (e) {} } memKey = null; }
  function b64of(u8) { var t = ""; for (var i = 0; i < u8.length; i++) t += String.fromCharCode(u8[i]); return btoa(t); }
  function bytesOf(b64) { var t = atob(b64), u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
  // First encryption, or a passphrase change. 1.3.3: a passphrase change ROTATES the data key (new random key, credentials re-encrypted, wrapped by the new passphrase) so an old
  // copy of the vault plus the old passphrase no longer opens anything saved afterwards. The biometric record wrapped the OLD key (and the PRF output is not kept), so it is deleted
  // in the same step and the user re-enrols (one tap) - the passphrase keeps working throughout, nothing is lost. Resolves {rotated, bioRemoved}.
  function lockWithPassphrase(pass) {
    if (isLockedNow()) return Promise.reject(lockedErr());
    if (!pass || pass.length < VC.MIN_PASSPHRASE) return Promise.reject(VC.SourceError("config", "Use a passphrase of at least " + VC.MIN_PASSPHRASE + " characters."));
    var g = gen;
    return enqueue(function () {
      if (credLocked) throw lockedErr();
      if (g !== gen) throw cancelledErr();
      var rotated = !!memKey;
      return VC.createVault(Object.assign({}, credVals), pass).then(function (v) {
        if (g !== gen) throw cancelledErr();
        if (!save("creds", v.blob)) throw VC.SourceError("storage", "Browser storage is full or blocked – the encrypted credentials could not be saved.");
        var hadBio = !!load("bio", null), old = memKey;
        credBlob = v.blob; memKey = { dek: v.dek, hdr: VC.vaultHeader(v.blob) }; legacyPlain = false; sessSave(null); sessionHint = false; del("credhint");
        if (old && old.dek) { try { old.dek.fill(0); } catch (e) {} }
        if (hadBio) del("bio");
        emit(); return { rotated: rotated, bioRemoved: hadBio };
      });
    });
  }
  function unlock(pass) {
    if (!credBlob || !credBlob.enc) return Promise.resolve(true);
    var g = gen;
    return enqueue(function () {
      if (!credLocked && memKey) return true;
      if (g !== gen) throw cancelledErr();
      return VC.openVault(credBlob, pass).then(function (r) {
        if (g !== gen) throw cancelledErr();
        credVals = cleanCreds(r.creds);
        if (!r.legacy) { memKey = { dek: r.dek, hdr: r.hdr }; credLocked = false; emit(); return true; }
        // 1.2.x / 1.3.x blob (the passphrase key encrypted the credentials directly): migrate to the data-key format now that the passphrase is known
        return VC.createVault(credVals, pass).then(function (v) {
          if (g !== gen) throw cancelledErr();
          memKey = { dek: v.dek, hdr: VC.vaultHeader(v.blob) }; if (save("creds", v.blob)) credBlob = v.blob;   // (if storage is full the old blob stays and the next successful save upgrades it)
          credLocked = false; emit(); return true;
        });
      });
    });
  }
  function removePassphrase() { if (isLockedNow()) return Promise.reject(lockedErr()); return enqueue(function () { if (credLocked) throw lockedErr(); wipeKey(); del("bio"); return persistNow().then(emit); }); }   // -> session-only; the encrypted copy and the biometric record are deleted
  function dropPlaintextCopy() { if (!legacyPlain) return Promise.resolve(); return enqueue(function () { return persistNow().then(emit); }); }       // 1.2.0 plaintext copy -> session-only
  /* ---- 1.3.0: auto-lock, biometric (WebAuthn PRF) second door, encrypted backup ---- */
  var vaultCfg = VC.normalizeVaultCfg(load("vault", null));
  function setVaultCfg(patch) { vaultCfg = VC.normalizeVaultCfg(Object.assign({}, vaultCfg, patch)); save("vault", vaultCfg); emit(); return Object.assign({}, vaultCfg); }
  // Lock: forget every decrypted secret held in memory (credentials + data key). Only meaningful for a passphrase vault; session-only credentials
  // have no way back, so they are left alone (the UI says so). JS strings cannot be overwritten in place: they are dropped and become garbage; the key bytes are zeroed.
  function lockEligible() { return !credLocked && !!(memKey && credBlob && credBlob.enc); }
  function doLock() { lockPending = false; if (!lockEligible()) return false; credVals = {}; wipeKey(); credLocked = true; emit(); return true; }
  function lockNow() {
    if (!vqPending) return doLock();
    // an operation is in flight: the lock is queued behind it (the key is never zeroed under a running seal/wrap). Until it runs, edits are refused.
    lockPending = true; enqueue(doLock); return true;
  }
  function whenIdle() { return vq.then(function () {}); }
  function pageHost() { return typeof location !== "undefined" && location && location.hostname ? location.hostname : ""; }
  function bioAllowed() { return !VC.sharedOrigin(pageHost()); }   // github.io is one origin shared by every Pages app of the account: no biometric there
  // records from 1.3.0/1.3.1 (they wrapped the passphrase) and any record on a shared origin are deleted on load
  (function purgeBio() { var raw = load("bio", null); if (raw && (!bioAllowed() || !VC.validBioRecord(raw))) del("bio"); })();
  function bioRecord() { if (!bioAllowed()) return null; var r = load("bio", null); return VC.validBioRecord(r) ? r : null; }
  function bioInfo() { var r = bioRecord(); return r ? { created: r.created, rpId: r.rpId } : null; }
  // enroll: meta {credId, prfSalt, rpId}, prf = PRF output. Needs the unlocked vault: what gets wrapped is the random data key, never the passphrase.
  function bioSave(meta, prf) {
    if (isLockedNow()) return Promise.reject(lockedErr());
    if (!bioAllowed()) return Promise.reject(VC.SourceError("config", "Biometric unlock is not offered on a shared origin (" + pageHost() + ") – see the README: HamLog would need its own origin."));
    var g = gen;
    return enqueue(function () {
      if (credLocked) throw lockedErr();
      if (g !== gen) throw cancelledErr();
      if (!memKey || !(credBlob && credBlob.enc)) throw VC.SourceError("config", "Set a passphrase and encrypt your login first – biometric unlock opens that encrypted copy.");
      var secret = b64of(memKey.dek);   // (copied now, before any await)
      return VC.wrapSecret(secret, prf, meta).then(function (rec) {
        if (g !== gen) throw cancelledErr();
        if (!save("bio", rec)) throw VC.SourceError("storage", "Browser storage is full or blocked – biometric unlock was not saved."); emit(); return bioInfo();
      });
    }).then(function (x) { try { if (prf && prf.fill) prf.fill(0); } catch (e) {} return x; }, function (e) { try { if (prf && prf.fill) prf.fill(0); } catch (e2) {} throw e; });
  }
  function bioRemove() { del("bio"); emit(); }
  // getPrf(record) -> Promise<ArrayBuffer|Uint8Array>: asks the authenticator (user verification) for the PRF output; it unwraps the data key, which opens the vault.
  function bioUnlock(getPrf) {
    var rec = bioRecord(); if (!rec) return Promise.reject(VC.SourceError("config", "Biometric unlock is not set up on this device."));
    if (!credLocked) return Promise.resolve(true);
    // the authenticator prompt (can take as long as the user needs) runs OUTSIDE the vault queue; only the unwrap/open step is queued
    var g = gen;
    return Promise.resolve(getPrf(rec)).then(function (prf) {
      return enqueue(function () {
        if (!credLocked) { try { if (prf && prf.fill) prf.fill(0); } catch (e) {} return true; }
        if (g !== gen) throw cancelledErr();
        var cur = bioRecord();
        if (!cur || cur.created !== rec.created) throw VC.SourceError("config", "The biometric record changed while waiting – try again.");
        return VC.unwrapSecret(rec, prf).then(function (dekB64) {
          try { if (prf && prf.fill) prf.fill(0); } catch (e) {}
          var dek = bytesOf(dekB64);
          return VC.openWithDek(credBlob, dek).then(function (creds) { if (g !== gen) throw cancelledErr(); credVals = cleanCreds(creds); memKey = { dek: dek, hdr: VC.vaultHeader(credBlob) }; credLocked = false; emit(); return true; });
        });
      });
    });
  }
  function exportBackup(pass) {
    if (credLocked) return Promise.reject(lockedErr());
    return VC.exportBackup(getCreds(), "", pass);
  }
  // confirm(info) is asked before any stored login is overwritten; without it such an import is refused.
  function importBackup(text, pass, confirm) {
    if (credLocked) return Promise.reject(lockedErr());
    return VC.importBackup(text, pass).then(function (r) {
      var patch = {}; CRED_KEYS.forEach(function (k) { if (typeof r.creds[k] === "string" && r.creds[k]) patch[k] = r.creds[k]; });
      if (!Object.keys(patch).length) throw VC.SourceError("parse", "The backup contains no credentials.");
      var info = { keys: Object.keys(patch), overwrites: Object.keys(patch).filter(function (k) { return credVals[k] && credVals[k] !== patch[k]; }) };
      var ask = !info.overwrites.length ? Promise.resolve(true) : typeof confirm === "function" ? Promise.resolve(confirm(info)) : Promise.resolve(false);
      return ask.then(function (yes) {
        if (!yes) throw VC.SourceError("cancelled", "Import cancelled – nothing was changed.");
        return setCreds(patch).then(function () { return { imported: Object.keys(patch).length, overwrote: info.overwrites.length }; });
      });
    });
  }

  window.HamVault = {
    CRED_KEYS: CRED_KEYS, onChange: onChange, getCreds: getCreds, setCreds: setCreds, forgetCreds: forgetCreds,
    isLocked: function () { return credLocked; }, hasPassphrase: function () { return !!(credBlob && credBlob.enc) || !!memKey; }, credMode: credMode,
    dropPlaintextCopy: dropPlaintextCopy, minPassphrase: VC.MIN_PASSPHRASE, redact: red,
    lock: lockWithPassphrase, unlock: unlock, lockNow: lockNow, whenIdle: whenIdle, vaultCfg: function () { return Object.assign({}, vaultCfg); }, setVaultCfg: setVaultCfg,
    lockDue: function (st) { return VC.lockDue(vaultCfg, st); },
    bioInfo: bioInfo, bioAllowed: bioAllowed, bioSave: bioSave, bioRemove: bioRemove, bioUnlock: bioUnlock, bioRecord: bioRecord,
    exportBackup: exportBackup, importBackup: importBackup, removePassphrase: removePassphrase, storageKeyPrefix: LS
  };
})();
