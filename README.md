# HamLog – offline ham radio QSO logger (PWA)

**▶ Open the app: <https://hamlog-azm.pages.dev/>** (Cloudflare Pages, HamLog's own origin, so biometric unlock works there).

> **Moved (1.3.0).** The GitHub Pages copy, <https://theriotcoder.github.io/hamlog/>, is now a **mirror**. It keeps working, also offline,
> and shows a notice, but biometric unlock is not offered there. **Your data does not move by itself**, because browsers keep storage
> per address. On the old copy:
> 1. **Settings → Callsign lookup → Save encrypted backup** (logins).
> 2. **Backup → JSON backup** (QSOs, sessions, settings).
>
> Then import both on the new address. The older Netlify copy (<https://unique-hummingbird-2241c8.netlify.app/>) is still on 1.0.0
> and isn't updated.

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

## Callsign lookup and the login vault (v1.2)

When you're online and type a call, HamLog can look up the other station's **name, city (QTH), state, country and grid**.
It fills **only the empty fields** and never overwrites anything you typed. Filled fields get a dashed border, and hovering
over one (its `title`) shows where the value came from. A small status chip under the call field names the sources, for
example `QRZ.com: name, qth, country · callook.info: grid`. The chip also says when you're offline, when nothing was found,
or when your logins are locked. Lookups wait about 0.65 s after you stop typing. They never block logging, and errors are
silent apart from the chip.

**Settings → Callsign lookup** has the main on/off switch and one checkbox per source. Sources are tried in this order, and
the first source that returns a value for a field wins:

| Source | Login | What it returns |
|---|---|---|
| QRZ.com XML (`xmldata.qrz.com`) | Your QRZ username and password | **Free account:** name, city (`addr2`) and country only. **Grid needs a paid XML subscription.** |
| HamQTH.com XML | Free HamQTH account | Name/nick, QTH, country, grid. HamQTH is only asked when name or grid is still missing. |
| callook.info | None | US calls only (FCC data): name, city, state, grid |
| Offline prefix table | None, and works offline | Country only, approximate (common ITU blocks; not a full DXCC list) |

Results (names, cities, grids, countries) are cached on the device for 30 days, up to 500 calls. **The cache is not encrypted.**
Only your logins are. Settings → Callsign lookup says so next to the **Clear lookup cache** button, which also shows how many
calls are cached. **Forget all logins** has an optional "Also clear the lookup cache" checkbox. **Settings → Test a lookup** shows the
raw result with sources.

### How credentials are sent (1.2.1)
I tested both services on 2026-10-19 with a dummy login and `Origin: https://theriotcoder.github.io`:
- **QRZ: POST.**
  - `xmldata.qrz.com` accepts `username`, `password` and `agent` as an `application/x-www-form-urlencoded` POST body.
  - A dummy login gets "Username/password incorrect", while an empty body gets "Username / password required", so the body is read.
  - The `s` (session key) and `callsign` lookup parameters work the same way.
  - The POST answer carries `Access-Control-Allow-Origin: *`. A form-encoded POST is a CORS "simple" request, so there's no preflight.
  - HamLog sends every QRZ request as a POST. The password and session key never appear in a URL, so they stay out of browser
    history, server and proxy logs, and `Referer`.
- **HamQTH: GET (no choice).**
  - `www.hamqth.com/xml.php` ignores a POST body: login gets "Username or password missing", and a lookup gets the same.
  - It only reads query parameters, so HamQTH login stays `GET ?u=&p=` over HTTPS, with `referrerPolicy: no-referrer` and `cache: no-store`.
  - The password is in that URL, which HamQTH's own logs can see. If that matters to you, use QRZ and/or callook.info and leave
    HamQTH off.

The session keys (QRZ key in `sessionStorage`, HamQTH session id in memory) are dropped on every lock (manual or auto-lock,
idle or hidden), on Forget all logins and on Remove passphrase. The login forms also use `method="post"`, and the CSP has
`form-action 'none'`, so even if a script fails, a browser can never put the password into a URL by submitting the form.

### What a free QRZ account gets (no fees needed)
- Logging in to the QRZ XML interface works with any QRZ account.
- Without an *XML Logbook Data* subscription, the session reports `SubExp: non-subscriber` along with the message "A subscription is
  required to access the complete record." Only a limited set of fields comes back: call, first and last name, city (`addr2`) and
  country. There's no grid, lat/lon, DXCC, email or full address.
- Third-party docs say free accounts are limited to about 100 lookups a day. HamLog's cache keeps repeat lookups off that count.
- HamLog follows the spec:
  - It logs in once, keeps the session key for the tab (`sessionStorage`) and reuses it.
  - When a reply has no `<Key>`, it logs in again, once.
  - It treats `Not found:` as a miss.
  - A rejected password stops retries until you change the login.
  - `Connection refused` pauses QRZ for 24 h.
- To get a grid without paying: add a free HamQTH login. For US calls, callook.info supplies the grid automatically.

### CORS (tested 2026-10-19), so no proxy is needed
Requests sent with `Origin: https://theriotcoder.github.io` got these answers:
- `xmldata.qrz.com` answered with `Access-Control-Allow-Origin: *`, both on GET and on the OPTIONS preflight.
- `www.hamqth.com` and `callook.info` also answer with `*`.

The browser can therefore call all three directly. **HamLog does not use or need a proxy** (no Cloudflare Worker), so nothing sits
between your device and these services. If QRZ ever removes CORS, lookups fail silently and the chip says the service is unreachable.
The CSP `connect-src` only allows these three hosts besides the POTA/SOTA APIs.

### Logins are stored only on this device, encrypted
- The vault code is **ported directly from SatPass 1.3.5**, which was already reviewed. It includes the operation queue, the lock and
  save timing fixes, padded biometric wraps and the AAD-bound backup header. The files are `js/vaultcrypto.js`, `js/vault.js` and
  `js/bio.js`; only names and storage keys were changed.
- **Without a passphrase**, logins are kept for this tab only (`sessionStorage`). They're gone when the tab closes, and nothing
  readable is written to `localStorage`.
- **With a passphrase** (10+ characters):
  - A random 256-bit data key encrypts the logins with AES-GCM.
  - That data key is wrapped by a key derived from your passphrase with PBKDF2-SHA256 at 600,000 iterations. The salt and the
    iteration count are bound with AAD.
  - The passphrase itself is never stored.
  - Changing the passphrase rotates the data key.
- **Auto-lock** after inactivity (default 15 min) and after the app has been hidden for a while (default 5 min). **Lock now** is
  also available. Locking drops the decrypted logins and zeroes the key in memory.
- **Encrypted backup**: a JSON file encrypted with its own backup passphrase, with an authenticated header. Logins are never
  exported in plain text, and they're **not** part of the normal JSON log backup.
- The forms use `autocomplete="username"`, `"current-password"` and `"new-password"`, so password managers can fill and save them.
  Password boxes are never pre-filled. A saved password only shows as "•••••• saved".
- Credentials are never logged, and error messages are redacted. They're only sent to the service they belong to
  (QRZ or HamQTH), over HTTPS.

### The shared github.io origin, and why biometric unlock is off there
Every GitHub Pages site of one account (HamLog, SatPass, Garmin Lens, …) runs on the **same origin**, `theriotcoder.github.io`.
Browsers separate storage by origin, not by path. That means:
- Any app on that origin *can* read the others' `localStorage`.
- HamLog prefixes every key (`hamlog:vault:*`, `hamlog:lookup:*`) so its keys never collide with the other apps' keys. The
  encrypted vault stays useless without your passphrase.
- **Biometric (WebAuthn PRF) unlock is turned off on `*.github.io`.** A passkey is bound to the origin, and the wrapped key would
  sit in storage that every app on that origin shares. Any of those apps could ask for the same passkey and unwrap it.
- **On `https://hamlog-azm.pages.dev` biometric unlock is offered (1.3.0).**
  - `pages.dev` is on the Public Suffix List, so every Pages project is a separate origin, and HamLog is the only app on this one.
  - Under Settings → Callsign lookup → Encryption, set a passphrase, then **Enable biometric unlock**. It's an optional second way in
    (Face ID, fingerprint, Windows Hello) next to the passphrase.
  - The WebAuthn PRF output (through HKDF) wraps the random data key, padded and AAD-bound. The code is ported from SatPass.
  - It needs a browser and device that support the PRF extension; otherwise the app says why it isn't available.
  - The record is deleted when you change or remove the passphrase.
  - The passkey belongs to `hamlog-azm.pages.dev` and doesn't work on any other copy.

### Sources (checked 2026-10-19)
- QRZ XML spec v1.34: <https://www.qrz.com/docs/xml/current_spec.html>. Covers login and Key reuse, "Not found:", session errors,
  "Connection refused", and "Non-subscriber access limits the data fields…".
- Ham2K PoLo lookup docs, on the free-account field set and the ~100/day limit: <https://polo.ham2k.com/docs/polo-features/lookups/>
- OpsLog QRZ XML field notes: <https://git.rouggy.com/rouggy/OpsLog/raw/branch/main/internal/lookup/QRZ-XML-FIELDS.md>
- HamQTH XML API (session valid 60 min, fields): <https://www.hamqth.com/developers.php>
- callook.info JSON API (US/FCC, no key): <https://callook.info/>
- SatPass vault design: <https://github.com/TheRiotCoder/satpass> (1.3.5)
- CORS: checked directly with `curl -H "Origin: https://theriotcoder.github.io"` (GET and OPTIONS) against all three hosts.

Not verified: a lookup with a real free QRZ account (no test login was available). The free-field list above comes from the spec
and the third-party docs, and the tests use a mocked QRZ response. The HamQTH field set wasn't checked with a live account either.

## Files
```
index.html              app shell / UI
css/styles.css          styles (mobile-first, dark mode)
js/hamdata.js           bands, modes, RST defaults, validation, dupe logic (pure, Node-testable)
js/adif.js              ADIF 3.1.x export + import parser (pure, Node-testable)
js/field.js             contest presets, dupes, stats, Cabrillo, POTA/SOTA refs, POTA file split, SOTA CSV (pure, Node-testable)
js/ops.js               Field tab UI (contest / POTA / SOTA sessions)
js/lookup.js            callsign lookup: QRZ/HamQTH/callook parsers, prefix table, client with cache (pure, Node-testable)
js/lookupui.js          lookup chip + Settings → Callsign lookup / vault controls
js/vaultcrypto.js       vault crypto, ported from SatPass 1.3.5 (pure, Node-testable)
js/vault.js             encrypted login store (operation queue, auto-lock, backup), ported from SatPass
js/bio.js               WebAuthn PRF unlock (off on *.github.io)
js/db.js                IndexedDB wrapper
js/app.js               UI controller
sw.js                   service worker (offline cache; bump VERSION when you change files)
manifest.webmanifest    PWA manifest
icons/                  192/512/maskable PNG icons, apple-touch-icon (180), favicon
tests/adif.test.js      ADIF tests:  node tests/adif.test.js
tests/field.test.js     contest / Cabrillo / POTA / SOTA tests: node tests/field.test.js
tests/browser-smoke.js  headless Chrome end-to-end smoke test (optional)
tests/field-smoke.js    headless Chrome: Field tab at 320-412px, 1.0 -> 1.1 migration, offline
tests/lookup.test.js    lookup tests (mocked network): node tests/lookup.test.js
tests/vault.test.js     vault tests (Node webcrypto): node tests/vault.test.js
tests/lookup-smoke.js   headless Chrome: lookup with mocked QRZ, vault lock/unlock/backup, biometric (virtual PRF authenticator), SW navigation, 320-412px
tools/build-site.sh     builds dist/ for Cloudflare Pages
wrangler.toml           Cloudflare Pages project "hamlog"
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

## Deploying to Cloudflare Pages (primary host)
HamLog is static files, served from the Cloudflare Pages project **`hamlog`** (`https://hamlog-azm.pages.dev`). Cloudflare
assigned the `-azm` suffix. It's a direct upload, with no Git integration and no Functions.
- `_headers` adds the following:
  - The CSP, kept identical to the `<meta>` CSP, plus `frame-ancestors 'none'`.
  - nosniff, no-referrer, `X-Frame-Options: DENY`, COOP, HSTS, and a Permissions-Policy that allows only `publickey-credentials-*` for itself.
  - `no-cache` on `sw.js`, `/`, `index.html` and the manifest.
  - Removal of Pages' default `Access-Control-Allow-Origin: *`.
- `tools/build-site.sh` copies exactly the app files, `_headers` and a real `404.html` into `dist/`.
- `wrangler.toml` names the project.

```sh
sh tools/build-site.sh
export CLOUDFLARE_ACCOUNT_ID=<account id> CLOUDFLARE_API_TOKEN=<token with Cloudflare Pages: Edit>   # never commit them
npx wrangler pages deploy dist --project-name hamlog --branch main
```
Use wrangler 4 under Node 22. Run it from a folder with a writable `node_modules`.

To check a deploy:
- `curl -sI https://hamlog-azm.pages.dev/ | grep -i content-security` shows the CSP.
- `https://hamlog-azm.pages.dev/sw.js` shows the new `hamlog-vX.Y.Z`.
- `HAMLOG_URL=https://hamlog-azm.pages.dev/ node --experimental-websocket tests/lookup-smoke.js` runs the smoke test against it.

Cloudflare Pages redirects `/index.html` to `/`. Since 1.3.0 the service worker rebuilds any redirected response as a plain one
before caching or serving it. A redirected response served to a navigation makes Chrome show an error page (SatPass hit this in 1.3.4).

The GitHub Pages copy is still built from `main` as a mirror.

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
