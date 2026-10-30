# LIFE-OS — Progressive Web App (PWA) Setup

LIFE-OS can be installed on **Android phones** and **desktop/laptop** like a native app. Data is cached in localStorage per device; enable Firebase Cloud Sync below to keep it in sync across devices.

## Enable Google sign-in and cross-device sync

1. Create a Firebase project and register a Web app in [Firebase Console](https://console.firebase.google.com/).
2. In **Authentication → Sign-in method**, enable **Google**.
3. Create a **Cloud Firestore** database.
4. In **Firestore → Rules**, publish the rules in `firestore.rules`.
5. Copy the Web app configuration into `firebase-config.js`, replacing the `PASTE_...` values and setting `enabled: true`.
6. In **Authentication → Settings → Authorized domains**, add the domain hosting LIFE-OS (and `localhost` for local development).
7. Host the app over HTTPS. Open LIFE-OS on each device, go to **Settings → Cloud Sync**, and sign into the same Google account.

The first signed-in device uploads its existing profiles and logs. Other devices download them after sign-in; new activity and settings sync automatically while online. Offline changes remain on that device and upload when connectivity returns. Firestore rules scope reads and writes to the signed-in Google UID.

---

## Required files (already in this folder)

| File | Purpose |
|------|---------|
| `manifest.json` | App name, icons, colors, standalone display |
| `sw.js` | Service worker — offline cache |
| `offline.html` | Shown if you open offline before first cache |
| `assets/life-os-logo.png` | Official LIFE-OS source logo |
| `icons/` | PNG icons (72–512px) generated from the official logo |
| `generate-icons.py` | Regenerate PNG icons and favicon from the official logo |

### Where to place icons

Put PNG files in:

```
life-os/icons/
  icon-72.png
  icon-96.png
  icon-128.png
  icon-144.png
  icon-152.png
  icon-192.png   ← minimum for Android install
  icon-384.png
  icon-512.png   ← minimum for splash / desktop
```

To regenerate all sizes:

```bash
cd life-os
python generate-icons.py
```

`manifest.json` already points to `./icons/icon-*.png`, all generated from `assets/life-os-logo.png`.

---

## How to run the PWA (important)

PWAs **do not work fully from `file://`** (double-clicking `index.html`). You need a **local web server**:

### Option A — Python (if installed)

```bash
cd life-os
python -m http.server 8080
```

Open: **http://localhost:8080**

### Option B — Node.js

```bash
cd life-os
npx serve .
```

Open the URL shown (e.g. **http://localhost:3000**).

### Option C — VS Code

Use the **Live Server** extension → Open with Live Server.

---

## Install on Android phone

1. Deploy or open the app on **HTTPS** or your PC’s LAN IP (e.g. `http://192.168.1.5:8080`) on the same Wi‑Fi.
2. Open in **Chrome**.
3. Use one of:
   - Tap the **Install LIFE-OS** banner → **Install**
   - Chrome menu **⋮** → **Install app** or **Add to Home screen**
4. The icon appears on your home screen.
5. Open it — runs **fullscreen** (no browser bar), like a native app.
6. Use the **green keyboard bar** or on-screen keys; soft keyboard works.

**Note:** First visit must be **online** so the service worker can cache the app. After that it works **offline**; localStorage data remains on the phone.

---

## Install on desktop / laptop

### Chrome or Edge (Windows / Mac / Linux)

1. Run via local server (see above) or host on HTTPS.
2. Look for the **install icon** in the address bar (⊕ or computer icon).
3. Or use the in-app **Install LIFE-OS** banner / **Preferences → Install App**.
4. LIFE-OS opens in its own window without tabs.

### Already installed?

The app runs in **standalone** mode — your mappings and timeline are still in **localStorage** for each user profile.

---

## Offline support

- First load **online** caches: HTML, CSS, JS, charts, icons.
- Later visits work **without internet** for the app shell.
- **Timeline and settings** use **localStorage** — no server required.
- If offline before first cache, you may see `offline.html` — go online once and reload.

---

## Install prompt in the app

- A top **Install LIFE-OS** bar appears when the browser supports install.
- **Later** hides it until you clear site data.
- **Preferences** tab also has **Install App**.

---

## Touch + keyboard

- **Desktop:** mapped keys + Ctrl+K settings.
- **Phone:** tap keys bar, on-screen main buttons, subtask chips, CHARTS button (touch-safe).

---

## Created by

**Anshul Sati** — with love ♥
