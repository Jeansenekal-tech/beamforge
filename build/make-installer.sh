#!/bin/bash
# Builds dist/BeamForge-Installer-mac.zip (installer script + app files; Electron is downloaded on the Mac)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"; I="$T/BeamForge-Installer"
mkdir -p "$I" "$ROOT/dist"
cp "$ROOT"/installer/* "$I/"; cp -r "$ROOT/app" "$I/BeamForge-app"; cp "$ROOT/build/icon.icns" "$I/BeamForge-app/"
chmod +x "$I/Install BeamForge.command"
rm -f "$ROOT/dist/BeamForge-Installer-mac.zip"; (cd "$T" && zip -qry -9 "$ROOT/dist/BeamForge-Installer-mac.zip" BeamForge-Installer)
rm -rf "$T"; echo "built dist/BeamForge-Installer-mac.zip"
