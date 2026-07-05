import fs from "node:fs"
const OUT = process.env.CLAUDE_JOB_DIR + "/tmp/tech"
fs.mkdirSync(OUT, { recursive: true })

// Technical construction symbols — fashion tech-pack conventions.
// Clean line drawings: dark technical stroke, no fill, transparent ground
// so they overlay on flats. viewBox 140x110 each.
const S = `stroke="#3f454c" stroke-width="1.6" fill="none" stroke-linejoin="round" stroke-linecap="round"`
const THIN = `stroke="#3f454c" stroke-width="1" fill="none"`
const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 110">${inner}</svg>`

// ── Gathering: seam line with fabric ruched onto it (loops above baseline) ──
function gathering() {
  const y = 78, x0 = 12, x1 = 128, n = 9, step = (x1 - x0) / n
  let loops = ""
  for (let i = 0; i < n; i++) {
    const x = x0 + i * step
    // little vertical pull + a loop of gathered fabric
    loops += `<path ${THIN} d="M${x},${y} C${x + step * 0.15},${y - 34} ${x + step * 0.85},${y - 34} ${x + step},${y}"/>`
  }
  return wrap(
    `<line ${S} x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>` +
    loops +
    `<line ${THIN} x1="${x0}" y1="${y - 6}" x2="${x0}" y2="${y + 6}"/>` +
    `<line ${THIN} x1="${x1}" y1="${y - 6}" x2="${x1}" y2="${y + 6}"/>`
  )
}

// ── Knife pleats: parallel folds all one direction + fold arrow ──
function knifePleat() {
  let f = ""
  for (let i = 0; i < 5; i++) {
    const x = 22 + i * 22
    f += `<line ${S} x1="${x}" y1="14" x2="${x}" y2="96"/>` +
         `<line ${THIN} x1="${x - 14}" y1="14" x2="${x}" y2="14"/>` // fold catch at top
  }
  // direction arrow
  f += `<path ${THIN} d="M104,52 l14,0 M112,46 l6,6 l-6,6"/>`
  return wrap(f)
}

// ── Box pleat: folds facing away from a centre line (arrows outward) ──
function boxPleat() {
  const cx = 70
  return wrap(
    `<line ${S} x1="${cx}" y1="14" x2="${cx}" y2="96"/>` +
    `<line ${S} x1="${cx - 24}" y1="14" x2="${cx - 24}" y2="96"/>` +
    `<line ${S} x1="${cx + 24}" y1="14" x2="${cx + 24}" y2="96"/>` +
    `<line ${THIN} x1="${cx - 24}" y1="14" x2="${cx}" y2="14"/>` +
    `<line ${THIN} x1="${cx + 24}" y1="14" x2="${cx}" y2="14"/>` +
    // outward arrows from centre
    `<path ${THIN} d="M${cx - 4},52 l-16,0 M${cx - 12},46 l-6,6 l6,6"/>` +
    `<path ${THIN} d="M${cx + 4},52 l16,0 M${cx + 12},46 l6,6 l-6,6"/>`
  )
}

// ── Embroidery: dashed placement region + fine hatch + small motif ──
function embroidery() {
  const hatch = []
  for (let i = -40; i <= 120; i += 9) hatch.push(`<line ${THIN} x1="${i}" y1="20" x2="${i + 60}" y2="90"/>`)
  return wrap(
    `<defs><clipPath id="e"><ellipse cx="70" cy="55" rx="52" ry="38"/></clipPath></defs>` +
    `<g clip-path="url(#e)" opacity="0.5">${hatch.join("")}</g>` +
    `<ellipse cx="70" cy="55" rx="52" ry="38" stroke="#3f454c" stroke-width="1.4" fill="none" stroke-dasharray="5,4"/>` +
    // little flower motif
    `<g stroke="#3f454c" stroke-width="1.4" fill="none">` +
    `<circle cx="70" cy="55" r="4"/>` +
    [0, 72, 144, 216, 288].map(a => {
      const r = (a * Math.PI) / 180
      return `<ellipse cx="${70 + Math.cos(r) * 12}" cy="${55 + Math.sin(r) * 12}" rx="7" ry="4" transform="rotate(${a} ${70 + Math.cos(r) * 12} ${55 + Math.sin(r) * 12})"/>`
    }).join("") +
    `</g>`
  )
}

// ── Yoke: shaped shoulder panel with a curved yoke seam ──
function yoke() {
  return wrap(
    `<path ${S} d="M20,26 C40,16 100,16 120,26 L120,44 C100,58 40,58 20,44 Z"/>` +
    `<path ${THIN} d="M20,44 C50,60 90,60 120,44" stroke-dasharray="4,3"/>` +
    `<path ${S} d="M20,44 L20,92 C50,102 90,102 120,92 L120,44"/>` +
    // hatch the yoke band lightly
    `<g opacity="0.4">${Array.from({ length: 7 }, (_, i) => `<line ${THIN} x1="${24 + i * 15}" y1="24" x2="${18 + i * 15}" y2="50"/>`).join("")}</g>`
  )
}

// ── Dart: wedge converging to a point, centre fold dashed ──
function dart() {
  return wrap(
    `<line ${S} x1="34" y1="96" x2="70" y2="20"/>` +
    `<line ${S} x1="106" y1="96" x2="70" y2="20"/>` +
    `<line ${THIN} x1="70" y1="96" x2="70" y2="24" stroke-dasharray="4,3"/>` +
    `<line ${S} x1="34" y1="96" x2="106" y2="96"/>`
  )
}

// ── Tucks: parallel fold lines with catch-stitch ticks ──
function tucks() {
  let f = ""
  for (let i = 0; i < 4; i++) {
    const x = 30 + i * 26
    f += `<line ${S} x1="${x}" y1="16" x2="${x}" y2="94"/>` +
         `<line ${THIN} x1="${x}" y1="16" x2="${x + 8}" y2="16"/>` +
         `<line ${THIN} x1="${x}" y1="94" x2="${x + 8}" y2="94"/>`
  }
  return wrap(f)
}

// ── Topstitching: edge line + parallel dashed stitch line ──
function topstitch() {
  return wrap(
    `<path ${S} d="M16,28 C60,20 90,20 124,30"/>` +
    `<path stroke="#3f454c" stroke-width="1.3" fill="none" stroke-dasharray="6,4" d="M16,40 C60,32 90,32 124,42"/>` +
    `<path stroke="#3f454c" stroke-width="1.3" fill="none" stroke-dasharray="6,4" d="M16,52 C60,44 90,44 124,54"/>`
  )
}

const symbols = { gathering, knifePleat, boxPleat, embroidery, yoke, dart, tucks, topstitch }
for (const [name, fn] of Object.entries(symbols)) fs.writeFileSync(`${OUT}/${name}.svg`, fn())
console.log("wrote:", Object.keys(symbols).join(", "))
