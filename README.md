# TROVE Calc

A premium **Standard & Scientific calculator** Progressive Web App — HTML, CSS, and Vanilla JavaScript


---

## Features

- Standard & Scientific modes  
- Safe expression engine (no `eval()`)  
- Memory (MC · MR · MS · M+ · M−)  
- History drawer with timestamps  
- Light / dark theme  
- Splash, first-run welcome, About dialog  
- Installable PWA with offline support  
- Keyboard-first accessibility  

---

## Project structure

```
calculator/
├── index.html                 # App shell
├── manifest.json              # PWA manifest (standalone)
├── service-worker.js          # Offline cache
├── browserconfig.xml          # Windows tiles
├── favicon.ico / favicon.svg  # Root discovery copies
├── css/
│   └── styles.css
├── js/
│   └── app.js
├── favicon/                   # Browser favicons
│   ├── favicon.ico
│   ├── favicon.svg
│   ├── favicon-16x16.png
│   └── favicon-32x32.png
├── icons/                     # Install / touch icons
│   ├── apple-touch-icon.png
│   ├── android-chrome-192x192.png
│   ├── android-chrome-512x512.png
│   └── maskable-512x512.png
├── assets/
│   └── logo.svg               # Brand mark (splash / About)
├── images/                    # Reserved for future media
├── scripts/
│   └── generate-icons.js
└── README.md
```

---

## Quick start

Serve over HTTP (required for the service worker):

```bash
python -m http.server 5500
# or: npx serve .
```

Open `http://localhost:5500`.

### Regenerate icons

```bash
node scripts/generate-icons.js
```

---

## Install & use offline

1. **Serve** the folder on `localhost` or HTTPS (service workers need a secure origin):
   ```bash
   python -m http.server 5500
   ```
2. Open `http://localhost:5500` in Chrome, Edge, or Safari.
3. **Install**
   - **Desktop (Chrome/Edge):** address-bar install icon, or menu → *Install TROVE Calc*
   - **Android:** menu → *Install app* / *Add to Home screen*
   - **iPhone (Safari):** Share → *Add to Home Screen*
4. Launch **TROVE Calc** from your home screen / app list (standalone window).
5. **Offline:** after the first successful visit, the service worker caches core files so the calculator keeps working without internet.

First-run welcome and **About (ⓘ)** also include short install notes.

---

## Brand

| Item | Value |
|------|--------|
| Name | TROVE Calc |
| Mark | Geometric **T** (display bar + stem) |
| Colors | `#1d4ed8` · white |
| Version | 1.0 |

---

## License

MIT
