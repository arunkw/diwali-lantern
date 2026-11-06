# Diwali Lantern 🪔

An interactive Diwali scene: a glowing 3D **kandil**, a **laddi / jhalar** of string lights, a 3D **clay diya** and **crackers** — with real physics. Tap it, swing it, pluck it, light it up.

**▶ Play it now (no install, works on Android, iPhone, Windows, Mac, Linux):**
**https://arunkw.github.io/diwali-lantern/**

![Diwali Lantern](docs/og.png)

Happy Diwali from [Doneology Labs](https://arunkw6.wixsite.com/doneology-labs).

---

## What you can do

| Action | What happens |
|---|---|
| Click / tap the kandil | Its light switches off; click again to switch it on |
| Drag the kandil | It swings like a pendulum on its cord when you let go |
| Pull the kandil straight down hard, or click its cord | It is plucked and falls to the floor (on Windows, onto the taskbar) |
| Brush the kandil with the pointer | It slowly turns on its cord, showing its other sides |
| Drag the corner handle of the kandil or diya | Resizes it diagonally (tap it first on a phone); the size is remembered |
| Brush the string lights | The wire and bulbs swing |
| Click a bulb | That bulb switches off / on |
| Click the diya | The flame goes out, the wick glows and a thread of soot smoke curls up; click again to relight |
| Drag the diya | It slides left or right; the forward-facing flame flickers with the motion |
| Click anywhere | A sparkle burst at that spot |
| Double-click / double-tap | A random cracker drops to the floor — anar (flower pot), bomb, ladi or rocket — and the pointer becomes a phuljhadi (sparkler) |
| ⚙ Options (top-right) | 3 kandils (Akash Kandil of translucent colour paper, thermacol Star Kandil, Paper Globe), 3 light styles, 3 diyas (classic terracotta, painted, lotus), re-hang, reset sizes, sounds |

## Three ways to run it

### 1. Web link (recommended for sharing)
Open **https://arunkw.github.io/diwali-lantern/**. Nothing to install, nothing to trust. On Android (Chrome) and iPhone (Safari) you can use **Add to Home screen** and it opens full-screen like an app, even offline.

### 2. Windows desktop overlay
The Windows app draws the scene on a **transparent window over your desktop**, with the kandil hanging from the top of the screen and the diya sitting on the taskbar.

Download from [**Releases**](https://github.com/arunkw/diwali-lantern/releases/latest):
- `DiwaliLantern-Portable-x.y.z.exe` — single file, just run it
- `DiwaliLantern-x.y.z-x64.zip` — unzip and run `Diwali Lantern.exe`

Controls: tray icon (bottom-right, near the clock) → Options / mode / quit.
- **Celebrate mode** (default): every click goes to the scene.
- **Desktop mode** (`Ctrl+Shift+D`): clicks on empty space pass through to your apps; the kandil, lights, diya and tinsel stay interactive.
- **Quit**: `Ctrl+Shift+Q` or tray → Quit.

> **Windows SmartScreen** will say *"Windows protected your PC"* because the exe is not code-signed (a paid certificate). Click **More info → Run anyway**. If you prefer not to, use the web link — it is the same app.

### 3. Run from source
```bash
git clone https://github.com/arunkw/diwali-lantern.git
cd diwali-lantern/desktop
npm install
npm start          # run the desktop overlay
npm run dist       # build the Windows exe
```
The web version is plain HTML/JS in `docs/` — open `docs/index.html` or serve the folder.

## Why you can trust the download
- **Every line of source is here.** The app is ~1,300 lines of readable JavaScript (`docs/app.js`) plus a 100-line Electron shell (`desktop/main.js`, `desktop/preload.js`).
- **No network, no data.** It makes no web requests, has no analytics, and stores only your chosen styles and tag text in local storage.
- **Built by GitHub, not on someone's laptop.** Release files are built by the public [GitHub Actions workflow](.github/workflows/release.yml) from this source, with a `SHA256SUMS.txt` and a signed [build-provenance attestation](https://github.com/arunkw/diwali-lantern/attestations). Verify a download with:
  ```bash
  gh attestation verify DiwaliLantern-Portable-1.1.0.exe --repo arunkw/diwali-lantern
  ```
  or compare `certutil -hashfile DiwaliLantern-Portable-1.1.0.exe SHA256` with `SHA256SUMS.txt`.

## How it works
- One canvas engine (`docs/app.js`) used by both the web and Windows builds.
- The kandils are true 3D meshes rendered on a 2D canvas: orthographic projection, painter's-algorithm sorting, Lambert shading plus emitted light from the bulb inside, and per-face affine-mapped textures (paper fibre, thermacol beads). The Akash Kandil draws its inside faces first so they show through the translucent paper.
- Physics: **Verlet integration** with distance constraints. The cord, light wire and each bulb are chains of point masses; the kandil is a two-point rigid body hanging on a slack-capable rope, so it swings as a (double) pendulum and topples realistically when it lands. It also twists on its cord (a damped torsion pendulum) when swung or brushed.
- "Hand touch": points near the pointer take on part of the pointer's velocity and are nudged aside.
- Diya smoke: a ribbon of points released from the hot wick, rising with buoyancy and curling in a noise field, drawn as soft puffs that widen and fade.
- Crackers, sparkles, smoke and the phuljhadi are a particle system; the bomb sends a shockwave through everything nearby (and can blow out the diya).
- Sounds are synthesised with the Web Audio API — no audio files.
- Windows build: Electron, frameless transparent always-on-top window sized to the work area; click-through via `setIgnoreMouseEvents(true, { forward: true })` with hit-testing in the page.

## Licence
MIT © 2026 Doneology Labs (OPC) Private Limited. Fork it, remix it, make it yours — a mention is appreciated.

**शुभ दीपावली — Happy Diwali!** 🪔
