#!/bin/bash
# Assemble BeamForge.app from the official Electron macOS runtime, then ad-hoc sign it.
set -euo pipefail
ROOT=/home/claude/beamforge
DL=/home/claude/dl
RC=$DL/apple-codesign-0.29.0-x86_64-unknown-linux-musl/rcodesign
OUT=$ROOT/dist
VER=33.2.1
mkdir -p "$OUT"
for ARCH in arm64 x64; do
  W=$OUT/work-$ARCH; rm -rf "$W"; mkdir -p "$W"
  (cd "$W" && unzip -q "$DL/electron-v$VER-darwin-$ARCH.zip")
  APP="$W/BeamForge.app"; mv "$W/Electron.app" "$APP"
  RES="$APP/Contents/Resources"
  rm -f "$RES/default_app.asar"
  mkdir -p "$RES/app"
  cp -r "$ROOT/app/." "$RES/app/"
  cp "$ROOT/build/icon.icns" "$RES/electron.icns"
  python3 - "$APP/Contents/Info.plist" <<'EOF'
import plistlib, sys
p = sys.argv[1]
d = plistlib.load(open(p, 'rb'))
d.update({
  'CFBundleName': 'BeamForge', 'CFBundleDisplayName': 'BeamForge', 'CFBundleIdentifier': 'za.co.uniqueav.beamforge',
  'CFBundleShortVersionString': '1.0.0', 'CFBundleVersion': '1.0.0', 'LSApplicationCategoryType': 'public.app-category.graphics-design',
  'NSHumanReadableCopyright': 'BeamForge — laser design & control for GRBL',
  'CFBundleDocumentTypes': [
    {'CFBundleTypeName': 'BeamForge Project', 'CFBundleTypeExtensions': ['bfproj'], 'CFBundleTypeRole': 'Editor', 'LSHandlerRank': 'Owner', 'CFBundleTypeIconFile': 'electron.icns'},
    {'CFBundleTypeName': 'BeamForge Update', 'CFBundleTypeExtensions': ['bfupdate'], 'CFBundleTypeRole': 'Viewer', 'LSHandlerRank': 'Owner'},
    {'CFBundleTypeName': 'Vector & image files', 'CFBundleTypeExtensions': ['svg', 'dxf', 'gcode', 'nc', 'png', 'jpg', 'jpeg'], 'CFBundleTypeRole': 'Viewer', 'LSHandlerRank': 'Alternate'},
  ],
})
for k in ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSBluetoothAlwaysUsageDescription']:
  d.pop(k, None)
plistlib.dump(d, open(p, 'wb'))
EOF
  # ad-hoc sign the whole bundle (nested helpers/frameworks first — rcodesign handles nesting)
  "$RC" sign "$APP" >/dev/null 2>"$W/sign.log" || { echo "sign failed"; tail -20 "$W/sign.log"; exit 1; }
  LABEL=$([ "$ARCH" = arm64 ] && echo "Apple-Silicon" || echo "Intel")
  STAGE="$W/BeamForge-mac-$LABEL"; mkdir -p "$STAGE"; mv "$APP" "$STAGE/"
  cp "$ROOT/build/README.txt" "$STAGE/READ ME FIRST.txt"
  cp "$ROOT/build/Install BeamForge.command" "$STAGE/"; chmod +x "$STAGE/Install BeamForge.command"
  (cd "$W" && rm -f "$OUT/BeamForge-mac-$LABEL.zip" && zip -qry -9 "$OUT/BeamForge-mac-$LABEL.zip" "BeamForge-mac-$LABEL")
  echo "built $OUT/BeamForge-mac-$LABEL.zip"
done
# source
(cd "$ROOT" && rm -f dist/BeamForge-source.zip && zip -qr dist/BeamForge-source.zip app build/README.txt build/icon.png)
ls -la "$OUT"/*.zip
