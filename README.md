# BeamForge

Laser design and control for GRBL diode lasers on macOS (made for the Creality Falcon 10W). It works like LightBurn:
draw or import designs, set cut/engrave layers, preview, estimate time and cost, and run jobs over USB.

## Install on a Mac
Download `BeamForge-Installer-mac.zip` from [Releases](https://github.com/Jeansenekal-tech/beamforge/releases/latest),
unzip it, right-click **Install BeamForge.command** → **Open**. See `installer/READ ME FIRST.txt`.

## Automatic updates
From version 1.5.1 BeamForge checks
`https://raw.githubusercontent.com/Jeansenekal-tech/beamforge/main/updates/latest.json`
at start-up and every 6 hours. It downloads new versions in the background, checks the SHA-256, and asks before
restarting. A version that fails to start is rolled back automatically.

To publish a new version:
1. Bump `version` in `app/package.json`.
2. `python3 build/make-update.py "What changed"` — writes `updates/BeamForge-<version>.bfupdate` and `updates/latest.json`.
3. Commit and push. (Optional: `build/make-installer.sh` for a fresh installer zip to attach to a release.)

## Layout
- `app/` — the Electron app (`main.js` is the fixed launcher; everything else can be updated)
- `build/` — update and installer build scripts, icon, user guide
- `installer/` — the Mac installer script and guide
- `updates/` — the live update feed read by installed copies
