# HamLog – offline ham radio QSO logger (PWA)

**Live app: [HamLog on Netlify](https://unique-hummingbird-2241c8.netlify.app/#log)** (backup: [GitHub Pages](https://theriotcoder.github.io/hamlog/))

Install it:
- **iPhone/iPad:** open the link in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open the link in Chrome, tap the ⋮ menu, then **Install app** (or **Add to Home screen**).
- **Windows/Mac/Linux:** open the link in Chrome or Edge and click the install icon in the address bar.

Open it once while online; after that it works offline.


A small, dependency-free Progressive Web App for logging amateur radio contacts.
Works offline, installs on Android, iPhone/iPad, Windows, macOS and Linux, stores
everything locally in your browser (IndexedDB), and exports **ADIF 3.1.4 (.adi)**
files you can import into your **free QRZ.com logbook**. No QRZ API key, no
subscription, no scraping. You upload the file yourself through QRZ's own import page.

Plain HTML/CSS/vanilla JS. No build step, no CDN, no tracking.

## Features
- Fast QSO entry: callsign auto-uppercased, UTC date/time auto-filled (follows the clock until you
  start typing a call, then stamps it; **Now** button; time accepts `1423`, `14:23` or `14:23:05`),
  band dropdown 160m–70cm derived automatically from the frequency (MHz, or kHz like `14074`),
  modes with correct ADIF MODE/SUBMODE (FT4 → `MFSK/FT4`, PSK31 → `PSK/PSK31`, USB → `SSB/USB`,
  DMR/D-STAR/C4FM → `DIGITALVOICE/...`), RST defaults per mode (59 / 599 / -10).
  Band, frequency and mode are remembered between QSOs. **Enter saves**, **Esc clears**.
- Worked-before info, plus a duplicate warning (same call + band + mode on the same UTC day) with a confirm before saving.
- Optional pre-fill of name/QTH/state/country/grid from your last QSO with that call.
- My station settings (callsign, grid, operator, power), exported as `STATION_CALLSIGN`,
  `MY_GRIDSQUARE`, `OPERATOR`, `TX_PWR` and saved with each QSO.
- Logbook: search, band/mode/status/dupe filters, newest first, edit, delete with confirm.
- QRZ upload tracking: export **new (not yet uploaded)** or **all**, then **mark as uploaded**.
  Only the QSOs that were in the exported file get marked.
- ADIF import/merge from other loggers (exact repeats skipped). JSON backup/restore (merge or replace).
- **Contest logging, POTA and SOTA** on the Field tab (see below).
- Offline via service worker. Dark/light/auto theme. Touch targets at least 44 px. Strict Content Security Policy.

## Contest, POTA and SOTA (Field tab, v1.1)
Open the **Field** tab, choose a session type, and tap **Start session**. All QSOs you log there also go into your main
logbook and the QRZ export.

### Contest mode
- Presets: ARRL Field Day, Winter Field Day, ARRL Sweepstakes, CQ WW DX, ARRL International DX, a generic state QSO party
  (you supply the contest ID, e.g. `LA-QSO-PARTY`), and a generic serial + exchange contest.
- Keyboard-first entry: type the call, then **Space** (or Enter) to jump to the received exchange, then **Enter** to log.
  **Esc** clears the entry. Your sent serial increments automatically.
- Dupes are checked live using the contest's rule: Field Day, WFD and QSO parties are once per band and mode (CW, phone and
  digital count separately). CQ WW and ARRL DX are once per band. Sweepstakes is once per contest.
- The live counters show QSOs, multipliers, rate (QSOs in the last 60 minutes) and an estimated score.
- Exports:
  - **ADIF** with `CONTEST_ID`, `STX`/`SRX` and `STX_STRING`/`SRX_STRING`.
  - **Cabrillo 3.0** (`QSO:` lines are freq/band, mode, date, time, my call, sent exchange, their call, received exchange).
    Check the header (category, location) before you submit it to the sponsor.

> **Scoring is approximate.** HamLog shows a running estimate, not an official claimed score:
> - Field Day and WFD: QSO points only. Power multipliers, bonus points and objectives are not included.
> - Sweepstakes: 2 points × sections.
> - CQ WW: zones per band only. Countries and continent-based points need a DXCC table, which HamLog doesn't ship.
> - ARRL DX: 3 points per QSO. A W/VE station's DXCC multiplier is estimated from call-sign prefixes.
> - QSO parties: rules vary by state.
>
> The sponsor's log checker is the authority.

| Preset | Exchange format checked | ADIF CONTEST_ID | Cabrillo CONTEST |
|---|---|---|---|
| ARRL Field Day | class + ARRL/RAC section (`3A CT`; DX sends `DX`) | ARRL-FIELD-DAY | ARRL-FD |
| Winter Field Day | category number + class H/I/O/M + section (`1O LA`) | WFD | WFD |
| ARRL Sweepstakes | serial, precedence Q/A/B/U/M/S, call, check (2 digits), section (`43 M 31 CT`) | ARRL-SS-CW / ARRL-SS-SSB | ARRL-SS-CW / ARRL-SS-SSB |
| CQ WW DX | RST + CQ zone 1–40 (`59 14`) | CQ-WW-CW / CQ-WW-SSB | CQ-WW-CW / CQ-WW-SSB |
| ARRL Intl DX | RST + state/province (W/VE) or RST + power (DX) | ARRL-DX-CW / ARRL-DX-SSB | ARRL-DX-CW / ARRL-DX-SSB |
| State QSO party | free-form (rules differ per state) | your ID | your ID |
| Generic | serial + free-form | your ID | your ID |

### POTA / SOTA
- **POTA activation:** enter your park (e.g. `US-0001`). For a multi-park activation, enter several separated by commas.
  The progress counter shows **x/10** for this UTC day. It counts unique call + band + mode + their park.
- **SOTA activation:** enter your summit (e.g. `W7W/LC-001`). The progress counter shows **x/4 different stations**, plus the summit's
  points if you looked it up.
- **Hunter / chaser:** enter the other station's park or summit for each QSO.
- If you fill in "their park/summit" during an activation, it's flagged **park-to-park** or **summit-to-summit**.
  If they're in two parks at once, HamLog saves one entry per park, as POTA asks.
- ADIF fields:
  - `MY_SIG=POTA` + `MY_SIG_INFO`, and `SIG=POTA` + `SIG_INFO`
  - `MY_SOTA_REF` / `SOTA_REF`
- **POTA upload files:** one `.adi` per park per UTC day, named `CALLSIGN@PARK-YYYYMMDD.adi` (e.g. `K5ABC@US-0001-20261019.adi`).
  A multi-park activation gets one file per park, each with that park in `MY_SIG_INFO`. File names can't contain `/`,
  so a `/` in your call becomes `_` in the file name (the ADIF inside keeps the real call).
- **SOTA CSV (V2):** `V2,MyCall,MySummit,DD/MM/YY,HHMM,Band,Mode,HisCall,HisSummit,Notes`, in chronological order.
- **Reference lookups:** no park or summit database is bundled. The format is checked offline:
  - POTA: `XX-1234`
  - SOTA: `ASSOC/RR-123`

  When you're online, **Look up name** asks the public `api.pota.app` (park name and location) and `api2.sota.org.uk`
  (summit name, points, altitude). Both send `Access-Control-Allow-Origin: *`, so the browser can call them directly.
  Offline, the lookup is skipped and everything else still works. The CSP allows only those two API hosts.

### Sources checked (2026-10-19)
- POTA rules (10 QSOs from the park within one UTC day; required/optional ADIF fields `MY_SIG`, `MY_SIG_INFO`, `SIG`, `SIG_INFO`; dupe definition): <https://docs.pota.app/docs/rules.html>
- POTA "Logging Made Easy" (file naming `callsign@park#-yyyymmdd`, e.g. `KB2FMH@US-8088-20220202.adi`; one entry per park for 2-fer P2P; one log per park): <https://docs.pota.app/docs/activator_reference/logging_made_easy.html>
- SOTA General Rules v1.21 §3.7.1 (1 QSO = activation, 4 QSOs with different stations to claim points): <https://www.sota.org.uk/Joining-In/General-Rules> (PDF: <https://sotastore.blob.core.windows.net/docs/SOTA-General-Rules-June-2022.pdf>)
- SOTA CSV V2 format (fields, DD/MM/YY dates, band values, blank His Summit): sotadata.org.uk upload help <https://www.sotadata.org.uk/en/upload/activator/csv/info> (requires sign-in; content confirmed via the copy quoted on the SOTA Reflector <https://reflector.sota.org.uk/t/sota-log-upload-format-problem/23984>)
- ARRL Field Day 2026 rules §5 (class + ARRL/RAC section, DX sends "DX"; Cabrillo optional): <https://www.arrl.org/files/file/Field-Day/2026/2026%20Field%20Day%20Rules.pdf>
- Winter Field Day 2026 rules (category number + class H/I/O/M + section; Cabrillo `CONTEST: WFD`): <https://winterfieldday.org/downloads/2026-rules-v3.pdf>, <https://blog.winterfieldday.org/2026/02/the-winter-field-day-cabrillo-log.html>
- ARRL November Sweepstakes rules (serial, precedence, call, check, section; 2 pts × sections; each station once): <https://contests.arrl.org/ContestRules/SS-Rules.pdf>, <https://www.arrl.org/sweepstakes>
- CQ WW DX rules (RS(T) + CQ zone): <https://cqww.com/rules.htm>
- ARRL International DX rules (W/VE: RST + state/province; DX: RST + power; 3 pts; once per band): <https://contests.arrl.org/ContestRules/DX-Rules.pdf>
- Cabrillo v3 header tags and contest names: <https://wwrof.org/cabrillo/cabrillo-v3-header/>
- ADIF 3.1.6 (Contest_ID enumeration incl. ARRL-FIELD-DAY, WFD, ARRL-SS-CW, CQ-WW-SSB, ARRL-DX-CW; SRX/STX(_STRING), MY_SIG(_INFO), SIG(_INFO), MY_SOTA_REF, SOTA_REF): <https://adif.org/316/ADIF_316.htm>

Not verified: `ARRL-FD` as the Field Day Cabrillo `CONTEST:` value. It's what common loggers write, but ARRL's Field Day rules
don't name one, and Cabrillo is optional for Field Day. QSO-party exchanges vary by state and aren't validated.

## Files
```
index.html              app shell / UI
css/styles.css          styles (mobile-first, dark mode)
js/hamdata.js           bands, modes, RST defaults, validation, dupe logic (pure, Node-testable)
js/adif.js              ADIF 3.1.x export + import parser (pure, Node-testable)
js/field.js             contest presets, dupes, stats, Cabrillo, POTA/SOTA refs, POTA file split, SOTA CSV (pure, Node-testable)
js/ops.js               Field tab UI (contest / POTA / SOTA sessions)
js/db.js                IndexedDB wrapper
js/app.js               UI controller
sw.js                   service worker (offline cache; bump VERSION when you change files)
manifest.webmanifest    PWA manifest
icons/                  192/512/maskable PNG icons, apple-touch-icon (180), favicon
tests/adif.test.js      ADIF tests:  node tests/adif.test.js
tests/field.test.js     contest / Cabrillo / POTA / SOTA tests: node tests/field.test.js
tests/browser-smoke.js  headless Chrome end-to-end smoke test (optional)
tests/field-smoke.js    headless Chrome: Field tab at 320-412px, 1.0 -> 1.1 migration, offline
_headers                Netlify security headers (CSP etc.)
tools/make_icons.py     regenerates the icons (needs Python + Pillow)
```

## Run locally
```bash
cd hamlog
python3 -m http.server 8000
# open http://localhost:8000
```
`localhost` counts as a secure context, so the service worker and offline mode work there.
To **install** the app on a phone you need **https**. See below.

Tests: `node tests/adif.test.js && node tests/field.test.js` (Node 16+ works; no npm packages needed).
Optional browser smoke tests (need `google-chrome` and `python3`): `node --experimental-websocket tests/browser-smoke.js` and `node --experimental-websocket tests/field-smoke.js` (set `HAMLOG_URL=https://…/` to run it against a live copy).

## Host it free over https (needed to install)
PWAs can only be installed and work offline when they're served over **https**.
Both of these options are free:

### Option A: Netlify Drop (easiest, no git)
1. Go to <https://app.netlify.com/drop> and sign in (free).
2. Drag the whole `hamlog` folder (or unzip `hamlog.zip` first) onto the page.
3. You get a URL like `https://random-name.netlify.app`. Open it on your phone.
To update later, drag the folder onto your site's **Deploys** page again.

### Option B: GitHub Pages
1. Create a new public repository on GitHub (e.g. `hamlog`).
2. Upload the *contents* of the `hamlog` folder to the repo root (web UI "Add file → Upload files", or `git push`).
3. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` / `(root)`, then Save.
4. After a minute the app is at `https://<your-username>.github.io/hamlog/`.
All paths are relative, so serving from a sub-folder works. `.nojekyll` is included.

**After you change any file**, bump `VERSION` in `sw.js` (e.g. `hamlog-v1.0.1`) so installed copies pick
up the update. The app then shows a "new version, Reload" banner.

## Install on your devices
- **Android (Chrome/Edge):** open the https URL, then tap **Install** in the app header or use the browser menu → *Install app / Add to Home screen*.
- **iPhone / iPad:** open the URL in **Safari**, tap **Share → Add to Home Screen**.
- **Windows / macOS / Linux (Chrome, Edge):** click the install icon in the address bar or the **Install** button.
  On macOS Safari 17+ use **File → Add to Dock**. Firefox desktop can use the site as a normal web page (offline still works).

## Uploading to QRZ.com (free logbook ADIF import)
1. In HamLog open the **QRZ** tab and tap **Share / save new** (or **Download .adi**).
   - iPhone: choose **Save to Files** in the share sheet.
   - Android: the file goes to **Downloads** (or choose Drive/Files in the share sheet).
   - Desktop: it downloads to your Downloads folder.
2. Tap **Open logbook.qrz.com** and sign in.
3. In your QRZ Logbook open **Settings** and click **Import** under **"ADIF Import/Export"**
   (or the **Import/Export Tools** button at the top right → **Import from ADI File**).
   Click **Choose File**, select the `.adi` file, then **Import ADI File**.
   QRZ processes imports in the background, so wait a minute and refresh.
4. Back in HamLog, tap **Mark N QSOs as uploaded**. Next time, "new" only contains QSOs logged since.

Notes:
- Set **My callsign** in Settings first. It's exported as `STATION_CALLSIGN` and should match your QRZ logbook's callsign.
- QRZ treats an imported QSO with the same call, band and mode within ±30 minutes as a duplicate and
  *replaces* the existing record (confirmed records are left alone). Re-uploading won't create doubles,
  but two genuinely separate QSOs with the same station/band/mode less than 30 minutes apart will merge on QRZ.
- ADIF **export** from QRZ is a subscriber feature. ADIF **import** and the logbook itself are free.

## Your data
Upgrading from 1.0 keeps all your QSOs. The database upgrade (v1 → v2) only adds a store for Field sessions and never rewrites
or clears logged QSOs. Still, a JSON backup before any update is a good habit.

Everything is stored only in this browser on this device. Clearing site data, uninstalling, or
(on iOS) not opening the app for a long time can delete it. Use **Settings → Save JSON backup** regularly.
**Ask browser to keep data** requests persistent storage. Installed apps usually get it.
Logs on two devices don't sync automatically: move them with JSON backup/restore (merge) or ADIF import.

## ADIF details
- Header: free-text line, `ADIF_VER` 3.1.4, `CREATED_TIMESTAMP`, `PROGRAMID`, `PROGRAMVERSION`, `<EOH>`.
- One record per line ending in `<EOR>`, fields as `<NAME:length>value`, empty fields omitted.
- Exported: CALL, QSO_DATE, TIME_ON, BAND, FREQ, MODE, SUBMODE, RST_SENT, RST_RCVD, NAME, QTH, STATE,
  COUNTRY, GRIDSQUARE, COMMENT, STATION_CALLSIGN, OPERATOR, MY_GRIDSQUARE, TX_PWR, CONTEST_ID, STX, SRX, STX_STRING,
  SRX_STRING, MY_SIG, MY_SIG_INFO, SIG, SIG_INFO, MY_SOTA_REF, SOTA_REF (when set), plus any extra
  fields that came in through ADIF import (e.g. DXCC).
- ADI string fields must be ASCII, so accented letters are transliterated on export (José → Jose).
  The original text stays in the app and in JSON backups.
- The importer handles missing headers, lowercase tags, `<F:L:T>` type indicators, legacy modes
  (`MODE=FT4`, `USB`, `PSK31`...), files that count lengths in UTF-8 bytes, and
  `QRZCOM_QSO_UPLOAD_STATUS=Y` (marked as uploaded).
