#!/bin/bash
# Builds dist/BeamForge-Installer-mac.zip (installer script + app files; Electron is downloaded on the Mac)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"; I="$T/BeamForge-Installer"
mkdir -p "$I" "$ROOT/downloads"
cp "$ROOT"/installer/* "$I/"; cp -r "$ROOT/app" "$I/BeamForge-app"; cp "$ROOT/build/icon.icns" "$I/BeamForge-app/"
chmod +x "$I/Install BeamForge.command"
rm -f "$ROOT/downloads/BeamForge-Installer-mac.zip"; (cd "$T" && zip -qry -9 "$ROOT/downloads/BeamForge-Installer-mac.zip" BeamForge-Installer)
rm -rf "$T"; echo "built downloads/BeamForge-Installer-mac.zip"
