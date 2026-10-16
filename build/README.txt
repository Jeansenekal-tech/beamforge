BEAMFORGE — laser design & control for GRBL lasers (macOS)
===========================================================

INSTALL
1. Unzip, then drag BeamForge.app into your Applications folder.
2. The app isn't from the App Store, so the first time macOS will block it.
   Open Terminal and paste this one line, then press Enter:

       xattr -cr /Applications/BeamForge.app

   (Alternative: try to open it once, then go to System Settings → Privacy & Security,
   scroll down and click "Open Anyway".)
   Or simply right-click "Install BeamForge.command" → Open, which does all of this for you.

CONNECT YOUR LASER
- Plug the laser in by USB. Most diode lasers use a CH340 or CP210x USB chip; if no port
  appears, install that driver from the chip maker.
- Laser tab → USB / Serial, baud 115200 → Connect → pick the port.
- Make sure laser mode is on: Console tab → "Laser mode on" (sends $32=1).
- Check Device Settings (gear icon): work area size and Max S value (GRBL $30, usually 1000).
- No laser handy? Choose "Simulator (no laser)" to try jobs safely.

ZOOM & PAN
- Scroll wheel or two-finger trackpad scroll zooms around the pointer; pinch also zooms.
- Pan: hold Shift (or Space) while scrolling, drag with Space held, or drag with the middle/right mouse button.
- Change this under Device Settings → "Mouse wheel / trackpad". Preview also zooms and pans.

RIGHT-CLICK MENU
- Right-click (two-finger click, or Ctrl-click) on a shape or selection: Group / Ungroup, cut, copy,
  paste here, duplicate, delete, transform, align, order, shape tools, move to layer, select tools.
- Clicking one shape of a group selects the whole group. ⌘-click picks a single shape inside a group.
- Right-click and drag still pans the view.

QUICK WORKFLOW
- Draw (R rectangle, E ellipse, P polygon/star, L lines, T text) or import SVG / DXF / PNG / JPG
  (File → Import, or drag files onto the canvas).
- Click a colour in the bottom palette to put the selection on that layer.
- Each layer has its own settings (double-click it): Line (cut/score), Fill (engrave inside shapes)
  or Image (photo engraving with dithering), speed, power, passes, interval, angle, cross-hatch,
  overscan, air assist.
- Preview (eye button) shows the toolpath, travel moves and estimated time.
- Laser tab: Home, Frame (traces the job outline with the laser off), Start / Pause / Stop.
- "Start from": Absolute coords, Current position (with the 9-point job origin), or User origin
  (set it on the Move tab with "Set origin here").

MATERIAL LIBRARY (Creality Falcon 10W)
- Select a layer in Cuts / Layers → "Library…" → pick a material and operation → "Apply to layer".
- Orange dot = Creality's official Falcon 10W settings; blue dot = community starting points.
- "Use Falcon 10W work area" sets the 400 × 415 mm bed and Max S 1000.
- Save your own tested settings with "Save layer to My settings"; export/import .bflib files.
- Always test on scrap first. Never laser PVC / vinyl. Clear acrylic can't be cut by a blue diode.

TIME & COST
- Estimated time shows in the Laser tab and per layer (Time column), updating as you edit.
  Estimates account for acceleration (read from GRBL $120/$121 when connected) and get more
  accurate automatically after each finished job on the real laser.
- "Cost" (toolbar, or in Preview) works out a price: machine rate, electricity, labour, material
  (by area used or whole sheets), quantity, markup, minimum charge, VAT (0 by default).
  Set your sheet prices with Material → Edit…  "Copy summary" puts a quote line on the clipboard.

UPDATES
- To install a .bfupdate file: double-click it, drag it onto BeamForge, or File → Install Update File…
  Then click "Restart now". No Terminal needed. Your design is kept.
- Automatic updates are on from 1.5.1: BeamForge checks the BeamForge GitHub page at start-up and every
  6 hours, downloads new versions in the background and asks before restarting.
  BeamForge → Check for Updates… checks straight away (and lets you turn automatic checks off).
- Updates never interrupt a running laser job. If an update fails to start, BeamForge goes back to the
  last version that worked and tells you.

NEW IN 1.2 (LightBurn 2.2 features)
- Nest parts (toolbar puzzle button, Arrange → Nest Parts…, or right-click): packs parts by their real
  outline onto a sheet (select a big shape as the sheet) or the whole work area. Set the gap, edge distance
  and rotation, or choose "Spread out" to maximise the space between parts. Overflow can go onto new pages.
- Pages: tabs above the design. + adds a page; right-click a tab to rename, duplicate, move or delete.
  The laser outputs the page you're on. Right-click shapes → Move to page.
- Center line trace: Trace image → Trace type "Center line" for single-line logos, sketches and text.
- 3D models: import STL, 3MF, OBJ, PLY, OFF or AMF as a depth map for 3D engraving. Double-click to
  change view, rotation, size, resolution and gray levels; right-click → Convert 3D model to bitmap.
- Vector troubleshooter (shield button): finds open shapes on fill layers, gaps, duplicates, tiny bits,
  over-detailed paths, self-crossing fills, parts outside the bed — and fixes most with one click.
- Remote API (BeamForge menu → Remote API…): lets other apps check status, import files and run jobs.
  Off by default; job control has its own switch; network access always needs a token.
- Size boxes accept formulas and units: 25.4*2, 100/3, 1in, 3cm, 10,5.
- Paste in Place, framing uses your start G-code, "Not Responding" status, controller buffer size and
  G-code file extension settings, better SVG import (symbols/use, text converted to outlines, CSS units).

BOX BUILDER (1.3)
- Toolbar box button, Tools → Box Builder…, or right-click → Box builder…
- Enter width, depth, height (outside or inside size), closed or open top, material thickness,
  finger width and kerf. Drag the 3D preview to turn it; "Cut layout" shows the flat panels.
- Cut "Make test joint" first: loose → raise Kerf, too tight → lower it. Panels are grouped, with
  their names on a separate engrave layer (untick "Engrave panel names" to skip).

NEW IN 1.4 (Tools menu and toolbar)
- Material test grid: squares at different speed × power. Right-click the best one → Save this test
  setting… to add it to My settings in the Library.
- Asset tags & labels: serial numbers or a CSV list, QR codes or Code 128 barcodes, key tags, cable tags,
  round tags; tick "Engrave background" for anodised aluminium. Overflow goes onto new pages.
- AV panel maker: 10" and 19" rack panels (1–4U) or custom plates with D-series, round, rectangle,
  IEC and jack cut-outs plus engraved labels. (A 19" panel is wider than the Falcon's 400 mm bed.)
- Box builder: dividers (compartments), lift-off lid with lip, and rounded boxes with living-hinge walls.
- Rotary (Laser → Rotary Setup…): roller or chuck, plugged into the Y port. The design height wraps around
  the object; a blue band shows one full turn.
- Camera (Laser → Camera…): burn 4 marks on scrap, click them in the picture, then Update overlay to see
  your material under the design.
- Vector library: search 200,000+ free icons online. "No credit needed" shows only icons you can use on
  products you sell without crediting the designer.

NEW IN 1.5
- Automatic updates now come straight from GitHub — nothing to set up.
- Box builder lids: "Sliding lid" slides out of the front through slots in the side walls, under a crossbar.
  "Hinged lid" turns on square pegs in round holes in the sides and opens to about 120°. Fit the hinged lid
  between the sides before you glue the second side. Both work with dividers.
- Box pieces are now nested tightly by default (Arrange pieces → Neat rows to go back to the old layout).
- Auto-arrange (toolbar button next to Nest, Arrange → Auto-Arrange, ⇧⌥⌘N, or right-click): one-click optimised
  nesting with your last Nest settings. Select a big shape first to arrange onto that sheet.
- Engraving jig maker (Tools → Engraving Jig Maker…, ⌥⌘J, or the toolbar): pick pencils, pens, markers, coasters,
  keyring blanks, cards, or a custom size. It makes page "1 – cut jig" (pockets with finger notches, cut once from
  scrap board) and page "2 – engrave" with your selected design and/or a list of names placed on every item.
  Leave the jig on the bed, drop the items in and run page 2 with Start from: Absolute coords.
  Long name lists go onto extra engrave pages.

SAFETY: never leave a running laser unattended, wear the right eye protection for your laser's
wavelength, and keep a fire extinguisher nearby.

Files: projects save as .bfproj; G-code can be saved and run later with "Run G-code file…".
