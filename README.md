# HamLog – offline ham radio QSO logger (PWA)

**Live app: [theriotcoder.github.io/hamlog](https://theriotcoder.github.io/hamlog/)** (also on [Netlify](https://unique-hummingbird-2241c8.netlify.app/))

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
- Offline via service worker. Dark/light/auto theme. Large touch targets.

## Files
```
index.html              app shell / UI
css/styles.css          styles (mobile-first, dark mode)
js/hamdata.js           bands, modes, RST defaults, validation, dupe logic (pure, Node-testable)
js/adif.js              ADIF 3.1.x export + import parser (pure, Node-testable)
js/db.js                IndexedDB wrapper
js/app.js               UI controller
sw.js                   service worker (offline cache; bump VERSION when you change files)
manifest.webmanifest    PWA manifest
icons/                  192/512/maskable PNG icons, apple-touch-icon (180), favicon
tests/adif.test.js      ADIF tests:  node tests/adif.test.js
tests/browser-smoke.js  headless Chrome end-to-end smoke test (optional)
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

Tests: `node tests/adif.test.js` (Node 16+ works; no npm packages needed).
Optional browser smoke test (needs `google-chrome` and `python3`): `node --experimental-websocket tests/browser-smoke.js`.

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
Everything is stored only in this browser on this device. Clearing site data, uninstalling, or
(on iOS) not opening the app for a long time can delete it. Use **Settings → Save JSON backup** regularly.
**Ask browser to keep data** requests persistent storage. Installed apps usually get it.
Logs on two devices don't sync automatically: move them with JSON backup/restore (merge) or ADIF import.

## ADIF details
- Header: free-text line, `ADIF_VER` 3.1.4, `CREATED_TIMESTAMP`, `PROGRAMID`, `PROGRAMVERSION`, `<EOH>`.
- One record per line ending in `<EOR>`, fields as `<NAME:length>value`, empty fields omitted.
- Exported: CALL, QSO_DATE, TIME_ON, BAND, FREQ, MODE, SUBMODE, RST_SENT, RST_RCVD, NAME, QTH, STATE,
  COUNTRY, GRIDSQUARE, COMMENT, STATION_CALLSIGN, OPERATOR, MY_GRIDSQUARE, TX_PWR, plus any extra
  fields that came in through ADIF import (e.g. DXCC).
- ADI string fields must be ASCII, so accented letters are transliterated on export (José → Jose).
  The original text stays in the app and in JSON backups.
- The importer handles missing headers, lowercase tags, `<F:L:T>` type indicators, legacy modes
  (`MODE=FT4`, `USB`, `PSK31`...), files that count lengths in UTF-8 bytes, and
  `QRZCOM_QSO_UPLOAD_STATUS=Y` (marked as uploaded).
