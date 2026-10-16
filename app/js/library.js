// Material library: built-in presets for the Creality CR-Laser Falcon 10W + user libraries.
'use strict';
const Library = (() => {
  // [material, thickness mm, operation, speed mm/min, power %, passes, source, notes, extra]
  // source: 'Creality' = Creality's official Falcon 10W parameter table; 'Community' = published
  // community starting points for the 10W Falcon. Always run a small test on scrap first.
  const F10 = [
    // ---------- Creality official: engraving ----------
    ['Basswood', 2, 'Engrave', 3000, 40, 1, 'Creality', ''],
    ['Basswood', 2, 'Photo', 4000, 40, 1, 'Community', 'Jarvis dither, 254 DPI. Light sanding after.', { interval: 0.1, imageMode: 'jarvis' }],
    ['Wood (general)', 0, 'Photo', 6000, 75, 1, 'Creality', 'Threshold image mode (Creality guitar sample).', { imageMode: 'threshold' }],
    ['Bamboo', 5, 'Engrave', 3000, 40, 1, 'Creality', ''],
    ['Kraft paper', 0.2, 'Engrave', 3000, 25, 1, 'Creality', ''],
    ['Card paper', 0.2, 'Engrave', 3000, 25, 1, 'Creality', ''],
    ['Felt', 0.8, 'Engrave', 3000, 15, 1, 'Creality', ''],
    ['Leather (genuine, brown)', 0.65, 'Engrave', 3000, 20, 1, 'Creality', ''],
    ['Acrylic (black / opaque)', 4.5, 'Engrave', 3000, 50, 1, 'Creality', 'Dark opaque acrylic only — clear acrylic cannot be engraved or cut by a blue diode.'],
    ['Anodized aluminium', 3, 'Engrave', 200, 100, 1, 'Creality', 'Removes the anodized layer (white mark).'],
    ['Stainless steel', 2, 'Engrave', 500, 100, 1, 'Creality', 'Dark oxide mark. Slow; clean surface first.', { interval: 0.05 }],
    ['Ceramic tile (white, painted black)', 6, 'Engrave', 3800, 95, 1, 'Creality', 'Spray tile black, engrave, wipe off. Jarvis for photos.', { imageMode: 'jarvis' }],
    // ---------- Creality official: cutting ----------
    ['Basswood', 2, 'Cut', 350, 100, 1, 'Creality', ''],
    ['Basswood', 4, 'Cut', 200, 100, 1, 'Creality', ''],
    ['Basswood', 5, 'Cut', 150, 100, 1, 'Creality', ''],
    ['Basswood', 8, 'Cut', 230, 100, 3, 'Creality', 'Lower focus ~1 mm per pass for best results.', { zStep: 0 }],
    ['Bamboo', 5, 'Cut', 230, 100, 3, 'Creality', ''],
    ['Acrylic (black / opaque)', 4.5, 'Cut', 120, 100, 2, 'Creality', ''],
    ['Kraft paper', 0.2, 'Cut', 3500, 100, 1, 'Creality', ''],
    ['Card paper', 0.2, 'Cut', 3500, 100, 1, 'Creality', ''],
    ['Felt', 0.8, 'Cut', 3500, 100, 1, 'Creality', ''],
    ['Leather (genuine, brown)', 0.65, 'Cut', 1500, 100, 1, 'Creality', ''],
    // ---------- Community starting points (10W Falcon) ----------
    ['Plywood (basswood / birch)', 3, 'Engrave', 3000, 40, 1, 'Community', ''],
    ['Plywood (basswood / birch)', 3, 'Cut', 300, 100, 3, 'Community', 'Air assist keeps the kerf clean.'],
    ['Plywood (walnut)', 3, 'Engrave', 2000, 42, 1, 'Community', ''],
    ['Plywood (walnut)', 3, 'Cut', 400, 100, 2, 'Community', 'Dense — 2 passes at full power.'],
    ['Plywood (maple)', 3, 'Engrave', 2000, 40, 1, 'Community', ''],
    ['Plywood (maple)', 3, 'Cut', 330, 100, 2, 'Community', ''],
    ['MDF', 3, 'Engrave', 3000, 50, 1, 'Community', 'Deep dark engrave; good for paint fill.'],
    ['MDF', 3, 'Cut', 200, 100, 4, 'Community', 'Heavy smoke — ventilate; air assist essential.'],
    ['Bamboo', 3, 'Engrave', 2000, 45, 1, 'Community', ''],
    ['Bamboo', 3, 'Cut', 300, 100, 2, 'Community', ''],
    ['Bamboo cutting board', 0, 'Engrave', 3000, 50, 1, 'Community', ''],
    ['Chipboard', 2, 'Engrave', 3000, 42, 1, 'Community', ''],
    ['Chipboard', 2, 'Cut', 800, 90, 1, 'Community', ''],
    ['Cardstock', 0.3, 'Engrave', 6000, 20, 1, 'Community', ''],
    ['Cardstock', 0.3, 'Cut', 4000, 60, 1, 'Community', 'Air assist prevents scorching.'],
    ['Corrugated cardboard', 3, 'Cut', 2000, 70, 2, 'Community', 'Fire risk — never leave unattended.'],
    ['Cork', 3, 'Engrave', 4000, 30, 1, 'Community', 'Great for coasters.'],
    ['Cork', 3, 'Cut', 350, 95, 2, 'Community', ''],
    ['Leather (veg-tan)', 2, 'Engrave', 2500, 35, 1, 'Community', 'Rich dark engrave.', { interval: 0.08 }],
    ['Leather (veg-tan)', 2, 'Cut', 1000, 100, 2, 'Community', 'Watch for flare-ups on thick pieces.'],
    ['Faux leather (PU only)', 1, 'Engrave', 2000, 55, 1, 'Community', 'PU only — never PVC/vinyl leatherette.'],
    ['Faux leather (PU only)', 1, 'Cut', 500, 90, 2, 'Community', 'PU only — never PVC/vinyl leatherette.'],
    ['Cotton fabric', 0.5, 'Engrave', 3500, 28, 1, 'Community', ''],
    ['Cotton fabric', 0.5, 'Cut', 1200, 80, 1, 'Community', 'Air assist OFF; pin fabric flat.', { air: false }],
    ['Denim', 1, 'Engrave', 2500, 42, 1, 'Community', ''],
    ['Denim', 1, 'Cut', 1000, 85, 1, 'Community', 'Air assist OFF; pin fabric flat.', { air: false }],
    ['EVA foam', 3, 'Cut', 4000, 65, 1, 'Community', 'Avoid a bare metal bed (reflections).'],
    ['Rubber stamp sheet', 2.3, 'Engrave', 1200, 70, 1, 'Community', 'Mirror + invert the design for stamps.', { interval: 0.05 }],
    ['Slate', 5, 'Engrave', 2000, 70, 1, 'Community', 'White frosted mark; oil afterwards for contrast.'],
    ['Glass (masked)', 0, 'Engrave', 2000, 50, 1, 'Community', 'Cover with masking tape or wet paper; clear glass alone will not mark.'],
    ['Stainless steel (marking spray)', 0, 'Engrave', 3000, 90, 1, 'Community', 'With Cermark / LaserBond / dry-moly spray. Wash off after.'],
    ['Powder-coated tumbler', 0, 'Engrave', 2200, 72, 1, 'Community', 'Removes powder coat; use a rotary.', { interval: 0.085 }],
    ['Delrin (acetal)', 2, 'Engrave', 2000, 50, 1, 'Community', 'Use fume extraction.'],
    ['Delrin (acetal)', 2, 'Cut', 250, 100, 8, 'Community', 'Use fume extraction.'],
    ['HDPE cutting board', 0, 'Engrave', 1600, 53, 1, 'Community', 'Engrave only — melts rather than cuts.'],
    ['Polycarbonate', 0, 'Engrave', 2300, 32, 1, 'Community', 'Engrave only.'],
    ['Polypropylene (Coroplast)', 4, 'Cut', 400, 65, 7, 'Community', 'Air assist strongly recommended.'],
    ['Engraving laminate (Rowmark)', 1.5, 'Score', 2000, 24, 1, 'Community', 'Removes the top colour layer only.'],
    ['Wood (general)', 0, 'Score', 3000, 30, 1, 'Community', 'Light vector line / outline mark.'],
  ];

  const OPS = { Cut: 'line', Score: 'line', Engrave: 'fill', Photo: 'image' };
  function toEntry(r, i) {
    const [material, thickness, op, speed, power, passes, source, notes, extra] = r;
    return {
      id: 'f10-' + i, material, thickness, op, source, notes: notes || '',
      settings: {
        mode: OPS[op], speed, maxPower: power, minPower: op === 'Photo' ? 0 : 0, passes,
        interval: 0.1, bidir: true, overscan: 2.5, angle: 0, crosshatch: false,
        air: op === 'Cut' || op === 'Score', imageMode: 'jarvis', ...(extra || {})
      }
    };
  }
  const BUILTIN = [{
    id: 'creality-falcon-10w', name: 'Creality CR-Laser Falcon 10W', readonly: true,
    device: { width: 400, height: 415, sMax: 1000 },
    entries: F10.map(toEntry)
  }];

  const KEY = 'bf.userLibs';
  const loadUser = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  let user = loadUser();
  if (!user.find(l => l.id === 'my')) user.unshift({ id: 'my', name: 'My settings', entries: [] });
  const saveUser = () => { try { localStorage.setItem(KEY, JSON.stringify(user)); } catch (e) { } };
  const all = () => [...BUILTIN, ...user];
  const get = (id) => all().find(l => l.id === id);
  function addEntry(libId, e) { const l = user.find(x => x.id === libId); if (!l) throw new Error('Library is read-only'); e.id = e.id || ('u-' + Math.random().toString(36).slice(2, 9)); l.entries.push(e); saveUser(); return e; }
  function removeEntry(libId, id) { const l = user.find(x => x.id === libId); if (!l) return; l.entries = l.entries.filter(e => e.id !== id); saveUser(); }
  function exportLib(id) { const l = get(id); return JSON.stringify({ app: 'BeamForge', type: 'library', version: 1, library: { ...l, readonly: undefined } }, null, 1); }
  function importLib(text) {
    const d = JSON.parse(text); const l = d.library || d; if (!l.entries) throw new Error('Not a BeamForge library file');
    const nl = { id: 'u' + Date.now().toString(36), name: l.name || 'Imported library', entries: l.entries.map(e => ({ ...e, id: 'u-' + Math.random().toString(36).slice(2, 9) })) };
    user.push(nl); saveUser(); return nl;
  }
  function deleteLib(id) { if (id === 'my') return; user = user.filter(l => l.id !== id); saveUser(); }
  const label = (e) => `${e.material}${e.thickness ? ' ' + e.thickness + 'mm' : ''} — ${e.op}`;
  return { all, get, addEntry, removeEntry, exportLib, importLib, deleteLib, label, OPS };
})();
