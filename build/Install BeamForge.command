#!/bin/bash
# Copies BeamForge into /Applications and clears the download quarantine so macOS lets it open.
cd "$(dirname "$0")"
echo "Installing BeamForge…"
if [ ! -d "BeamForge.app" ]; then echo "BeamForge.app not found next to this script."; read -n1 -r -p "Press any key to close"; exit 1; fi
rm -rf "/Applications/BeamForge.app"
cp -R "BeamForge.app" "/Applications/" || { echo "Copy failed — try dragging BeamForge.app to Applications manually."; read -n1 -r -p "Press any key"; exit 1; }
xattr -cr "/Applications/BeamForge.app"
codesign --force --deep --sign - "/Applications/BeamForge.app" 2>/dev/null
echo "Done. Opening BeamForge…"
open "/Applications/BeamForge.app"
