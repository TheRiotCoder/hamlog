# Changelog

## 1.2.0 – 2026-10-19
### Added
- **Callsign lookup**: name, QTH, state, country and grid. Only empty fields are filled; typed values are never overwritten.
  - Sources: QRZ.com XML (your login; a free account gets name, city and country), HamQTH (free login), callook.info (US, no login),
    and an offline prefix-to-country table. Each source can be switched on or off, and every filled field is labelled with its source.
  - Debounced. Results are cached on the device for 30 days. Failures are silent and offline-safe, with a status chip under the call field.
  - QRZ session key cached for the tab and reused. Re-login when there's no `<Key>`. Retries stop after a rejected login, and
    `Connection refused` pauses QRZ for 24 h.
  - Direct browser calls. All three services allow CORS from github.io, so **no proxy** is needed.
- **Encrypted login vault**, ported from SatPass 1.3.5: AES-GCM data key wrapped by a PBKDF2-SHA256 600k key, operation queue,
  auto-lock (idle and hidden), session-only mode without a passphrase, and an encrypted backup with an AAD-bound header.
  Forms work with password managers. Biometric (WebAuthn PRF) unlock is offered only off `*.github.io`.
  Storage keys are namespaced (`hamlog:vault:*`, `hamlog:lookup:*`).
- Tests: `tests/lookup.test.js` (14), `tests/vault.test.js` (11) and `tests/lookup-smoke.js` (35, headless Chrome with mocked QRZ, 320–412 px).

### Changed
- CSP `connect-src` adds `xmldata.qrz.com`, `www.hamqth.com` and `callook.info`.
- Service worker cache is now `hamlog-v1.2.0`.
- The older smoke tests block the lookup hosts so they stay deterministic.

## 1.1.0 – 2026-10-19
### Added
- **Field tab** for contest logging and POTA/SOTA.
- **Contest mode** with presets for ARRL Field Day, Winter Field Day, ARRL Sweepstakes, CQ WW DX, ARRL International DX,
  a generic state QSO party, and a generic serial + exchange contest.
  - Keyboard-first entry: Space or Enter in the call field jumps to the exchange, Enter logs, Esc clears.
    Serial numbers increment automatically.
  - Real-time dupe check using each contest's rule (once per band and mode, once per band, or once per contest for Sweepstakes).
  - Running counts of QSOs, multipliers, rate (QSOs in the last 60 minutes) and an **estimated** score.
  - ADIF with `CONTEST_ID`, `STX`/`SRX`, `STX_STRING`/`SRX_STRING` (plus `CLASS`/`ARRL_SECT`, `PRECEDENCE`/`CHECK`, `CQZ` where they apply).
  - Cabrillo 3.0 export.
- **POTA/SOTA**:
  - Activation sessions for your park (multi-park "2-fer" supported) or summit.
  - Hunter/chaser mode that records the other station's park or summit.
  - Park-to-park and summit-to-summit flags.
  - Activation progress: 10 QSOs per UTC day for POTA, 4 different stations for SOTA, plus summit points when looked up.
  - ADIF `MY_SIG`/`MY_SIG_INFO`, `SIG`/`SIG_INFO` (POTA), and `MY_SOTA_REF`/`SOTA_REF`.
  - POTA upload files are split one per park per UTC day and named `CALL@PARK-YYYYMMDD.adi`.
  - SOTA CSV (V2) export.
  - The reference format is checked offline. The park or summit name and summit points can optionally be looked up from the public
    POTA and SOTA APIs (both allow CORS). No database is bundled.
- A strict Content Security Policy: a `<meta>` tag on every host, plus a `_headers` file for Netlify that adds `frame-ancestors`.
- `tests/field.test.js` (unit) and `tests/field-smoke.js` (headless Chrome at 320, 360, 390 and 412 px, including the 1.0 → 1.1 data migration).

### Changed
- IndexedDB schema v1 → v2. The upgrade only **adds** a `sessions` store. Existing QSOs, settings and upload history are not rewritten.
- JSON backups now include sessions as well.
- The merge/import repeat check now keeps two-park P2P entries apart when they differ only in `SIG_INFO`.
  Keys for older records are unchanged.
- Small buttons are now at least 44 px tall. The nav has 5 tabs.
- Service worker cache: `hamlog-v1.1.0`.

## 1.0.0 – 2026-10-18
- First release: offline QSO logger PWA with ADIF export for the QRZ.com free logbook import.
