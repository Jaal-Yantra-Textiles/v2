// ---------------------------------------------------------------------------
// Fashion cut patterns — inline SVG sewing cut pattern pieces
// All SVG strings are ASCII-safe for btoa() encoding
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SEWING CUT PATTERN PIECES
// Each is a self-contained SVG with outline, grain line arrow, and label
// ---------------------------------------------------------------------------

function grainLine(x: number, y1: number, y2: number): string {
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#8090a0" stroke-width="0.9"/>
<polygon points="${x},${y1 - 6} ${x - 4},${y1 + 4} ${x + 4},${y1 + 4}" fill="#8090a0"/>
<polygon points="${x},${y2 + 6} ${x - 4},${y2 - 4} ${x + 4},${y2 - 4}" fill="#8090a0"/>`
}

function notch(x: number, y: number, rotate = 0): string {
  return `<polygon points="${x},${y} ${x - 4},${y + 8} ${x + 4},${y + 8}"
    fill="#8090a0" transform="rotate(${rotate},${x},${y})"/>`
}

function pieceLabel(cx: number, y: number, name: string, cut: string): string {
  return `<text x="${cx}" y="${y}" font-size="9" fill="#8090a0" font-family="sans-serif" text-anchor="middle">${name}</text>
<text x="${cx}" y="${y + 13}" font-size="8" fill="#a0a8b0" font-family="sans-serif" text-anchor="middle">${cut}</text>`
}

const PATTERN_STROKE = `stroke="#90a0b0" stroke-width="1.3" fill="#fdfcf8" stroke-linejoin="round" stroke-linecap="round"`

// Front Bodice Block --------------------------------------------------------
const FRONT_BODICE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 190">
<path ${PATTERN_STROKE} d="
  M10,65
  C12,44 22,26 40,16
  C52,10 66,9 80,12
  C98,22 112,44 114,68
  C116,86 112,105 106,120
  C100,135 94,152 92,175
  L10,175
  Z"/>
${notch(112, 96)}
${grainLine(52, 24, 162)}
${pieceLabel(52, 106, 'Front Bodice', 'Cut 1')}
</svg>`

// Back Bodice Block ----------------------------------------------------------
const BACK_BODICE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 190">
<path ${PATTERN_STROKE} d="
  M10,55
  C14,40 26,28 44,20
  C56,14 70,12 84,14
  C100,22 112,42 114,64
  C116,82 112,102 106,118
  C100,134 94,152 92,175
  L10,175
  Z"/>
${notch(112, 94)}
${grainLine(52, 22, 162)}
${pieceLabel(52, 106, 'Back Bodice', 'Cut 1')}
</svg>`

// Basic Sleeve ---------------------------------------------------------------
const SLEEVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 200">
<path ${PATTERN_STROKE} d="
  M10,120
  C10,100 18,78 34,60
  C50,42 68,28 85,22
  C102,28 120,42 136,60
  C152,78 160,100 160,120
  L148,185 L22,185
  Z"/>
${notch(85, 22, 180)}
${notch(46, 80)}
${notch(124, 80)}
${grainLine(85, 30, 178)}
${pieceLabel(85, 148, 'Sleeve', 'Cut 2')}
</svg>`

// Trouser Front --------------------------------------------------------------
const TROUSER_FRONT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 260">
<path ${PATTERN_STROKE} d="
  M14,10
  L96,10
  L100,30
  C102,46 100,58 92,66
  C84,74 74,80 68,90
  L64,250 L18,250
  C16,220 14,180 14,140
  C14,110 14,70 14,50
  Z"/>
${notch(55, 66)}
${grainLine(40, 18, 242)}
${pieceLabel(40, 160, 'Trouser Front', 'Cut 2')}
</svg>`

// Trouser Back ---------------------------------------------------------------
const TROUSER_BACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 260">
<path ${PATTERN_STROKE} d="
  M10,20
  C12,10 28,6 50,6
  L108,10
  L112,34
  C114,52 110,66 100,76
  C90,86 78,92 72,104
  L68,250 L14,250
  C12,218 10,180 10,140
  C10,100 10,58 10,40
  Z"/>
${notch(88, 78)}
${grainLine(42, 14, 242)}
${pieceLabel(42, 162, 'Trouser Back', 'Cut 2')}
</svg>`

// A-Line Skirt ---------------------------------------------------------------
const SKIRT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 220">
<path ${PATTERN_STROKE} d="
  M44,10 L136,10
  C140,10 144,14 144,18
  L160,205 L20,205
  C18,195 18,180 20,160
  L36,18
  C36,14 40,10 44,10
  Z"/>
${notch(90, 10, 180)}
${grainLine(90, 18, 198)}
${pieceLabel(90, 140, 'Skirt Front/Back', 'Cut 2')}
</svg>`

// Flat Collar ----------------------------------------------------------------
const COLLAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
<path ${PATTERN_STROKE} d="
  M100,10
  C68,10 38,24 20,48
  C16,54 14,60 14,66
  L36,66
  C38,58 44,52 54,46
  C66,38 82,34 100,34
  C118,34 134,38 146,46
  C156,52 162,58 164,66
  L186,66
  C186,60 184,54 180,48
  C162,24 132,10 100,10
  Z"/>
${notch(100, 34, 180)}
<line x1="60" y1="50" x2="140" y2="50" stroke="#8090a0" stroke-width="0.9"/>
<polygon points="60,50 66,46 66,54" fill="#8090a0"/>
<polygon points="140,50 134,46 134,54" fill="#8090a0"/>
${pieceLabel(100, 84, 'Flat Collar', 'Cut 2')}
</svg>`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PatternPiece {
  id: string
  name: string
  category: "bodice" | "sleeve" | "trouser" | "skirt" | "collar"
  svg: string
  /** canvas units at scale=1 */
  width: number
  height: number
}

export const PATTERN_PIECES: PatternPiece[] = [
  { id: "front-bodice",   name: "Front Bodice",     category: "bodice",   svg: FRONT_BODICE_SVG,   width: 150, height: 190 },
  { id: "back-bodice",    name: "Back Bodice",      category: "bodice",   svg: BACK_BODICE_SVG,    width: 150, height: 190 },
  { id: "sleeve",         name: "Sleeve",           category: "sleeve",   svg: SLEEVE_SVG,         width: 170, height: 200 },
  { id: "trouser-front",  name: "Trouser Front",    category: "trouser",  svg: TROUSER_FRONT_SVG,  width: 120, height: 260 },
  { id: "trouser-back",   name: "Trouser Back",     category: "trouser",  svg: TROUSER_BACK_SVG,   width: 130, height: 260 },
  { id: "skirt",          name: "Skirt Front/Back", category: "skirt",    svg: SKIRT_SVG,          width: 180, height: 220 },
  { id: "collar",         name: "Flat Collar",      category: "collar",   svg: COLLAR_SVG,         width: 200, height: 100 },
]

function randomId() { return Math.random().toString(36).slice(2) }

/** Returns { fileId, dataUrl, element } — call addFiles([{id:fileId,dataURL,...}]) then updateScene */
export function createPatternPieceElement(
  piece: PatternPiece,
  centerX: number,
  centerY: number,
  scale = 1
): { fileId: string; dataUrl: string; element: object } {
  const w = piece.width * scale
  const h = piece.height * scale
  const dataUrl = `data:image/svg+xml;base64,${btoa(piece.svg)}`
  const fileId = randomId()
  const id = randomId()

  return {
    fileId,
    dataUrl,
    element: {
      type: "image",
      id,
      fileId,
      x: centerX - w / 2,
      y: centerY - h / 2,
      width: w,
      height: h,
      angle: 0,
      opacity: 100,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      status: "saved",
      scale: [1, 1],
      customData: { fashionPattern: piece.id },
    },
  }
}
