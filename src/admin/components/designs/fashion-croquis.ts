// ---------------------------------------------------------------------------
// Fashion Croquis — inline SVG figures and sewing cut pattern pieces
// All SVG strings are ASCII-safe for btoa() encoding
// ---------------------------------------------------------------------------

export type CrquisType = "female" | "male"

// ---------------------------------------------------------------------------
// FEMALE CROQUIS  (9-head proportion, 160 x 480 viewBox)
// ---------------------------------------------------------------------------
const FEMALE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 480">
<defs>
  <style>
    .b{stroke:#c4b2a8;stroke-width:1.3;fill:#fef9f6;stroke-linejoin:round;stroke-linecap:round}
    .g{stroke:#ddd0ca;stroke-width:0.7;fill:none;stroke-dasharray:4,3}
    .l{font:8px sans-serif;fill:#c0aea8;text-anchor:start}
  </style>
</defs>
<!-- hair -->
<path class="b" d="M62,18 C60,3 68,0 80,0 C92,0 100,3 98,18" fill="#ead5cc"/>
<!-- head -->
<ellipse class="b" cx="80" cy="26" rx="19" ry="24"/>
<!-- neck -->
<path class="b" d="M73,48 C72,56 72,63 72,71 L88,71 C88,63 88,56 87,48 Z"/>
<!-- torso: L-neck-base -> L-shoulder -> L-armpit -> L-bust -> L-waist -> L-hip -> crotch -> mirror -->
<path class="b" d="
  M72,71
  C57,74 35,83 24,97
  C18,108 20,121 32,128
  C38,132 45,137 50,147
  C53,163 57,182 59,198
  C57,216 51,237 45,256
  C47,270 53,282 60,292
  L80,297 L100,292
  C107,282 113,270 115,256
  C109,237 103,216 101,198
  C103,182 107,163 110,147
  C115,137 122,132 128,128
  C140,121 142,108 136,97
  C125,83 103,74 88,71
  Z"/>
<!-- left arm -->
<path class="b" d="
  M24,97
  C18,114 16,134 16,160
  C15,180 14,200 12,222
  C10,242 8,260 8,278
  C8,292 10,304 10,312
  C12,310 14,306 14,298
  C16,280 16,262 18,242
  C20,222 22,200 24,180
  C26,156 28,134 32,112
  Z"/>
<!-- right arm -->
<path class="b" d="
  M136,97
  C142,114 144,134 144,160
  C145,180 146,200 148,222
  C150,242 152,260 152,278
  C152,292 150,304 150,312
  C148,310 146,306 146,298
  C144,280 144,262 142,242
  C140,222 138,200 136,180
  C134,156 132,134 128,112
  Z"/>
<!-- left leg -->
<path class="b" d="
  M45,292
  C42,310 42,334 44,360
  C44,374 42,386 42,400
  C42,420 44,440 44,460
  C44,470 44,478 44,480
  L58,480
  C58,478 58,470 58,460
  C58,440 58,420 58,400
  C58,386 58,374 58,360
  C60,334 60,310 60,292
  Z"/>
<!-- right leg -->
<path class="b" d="
  M100,292
  C103,310 100,334 102,360
  C102,374 102,386 102,400
  C102,420 102,440 102,460
  C102,470 102,478 102,480
  L116,480
  C116,478 116,470 116,460
  C116,440 116,420 116,400
  C116,386 118,374 118,360
  C118,334 118,310 115,292
  Z"/>
<!-- guide lines: bust / waist / hip -->
<line class="g" x1="44" y1="147" x2="116" y2="147"/>
<line class="g" x1="55" y1="198" x2="105" y2="198"/>
<line class="g" x1="41" y1="256" x2="119" y2="256"/>
<text class="l" x="120" y="150">B</text>
<text class="l" x="108" y="201">W</text>
<text class="l" x="121" y="259">H</text>
</svg>`

// ---------------------------------------------------------------------------
// MALE CROQUIS  (9-head proportion, 180 x 480 viewBox, broader shoulders)
// ---------------------------------------------------------------------------
const MALE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 480">
<defs>
  <style>
    .b{stroke:#a8b4c4;stroke-width:1.3;fill:#f6f8fe;stroke-linejoin:round;stroke-linecap:round}
    .g{stroke:#c8d0da;stroke-width:0.7;fill:none;stroke-dasharray:4,3}
    .l{font:8px sans-serif;fill:#a0aab8;text-anchor:start}
  </style>
</defs>
<!-- hair -->
<path class="b" d="M70,18 C68,2 76,0 90,0 C104,0 112,2 110,18" fill="#c8d0d8"/>
<!-- head -->
<ellipse class="b" cx="90" cy="26" rx="20" ry="24"/>
<!-- neck (wider for male) -->
<path class="b" d="M80,48 C79,56 78,63 78,72 L102,72 C102,63 101,56 100,48 Z"/>
<!-- torso: broader shoulders, straighter sides, less hip flare -->
<path class="b" d="
  M78,72
  C60,75 34,84 20,100
  C12,112 14,126 28,134
  C36,138 46,143 52,154
  C56,170 58,190 60,208
  C59,224 57,244 56,260
  C58,274 64,286 70,296
  L90,300 L110,296
  C116,286 122,274 124,260
  C123,244 121,224 120,208
  C122,190 124,170 128,154
  C134,143 144,138 152,134
  C166,126 168,112 160,100
  C146,84 120,75 102,72
  Z"/>
<!-- left arm (thicker) -->
<path class="b" d="
  M20,100
  C14,118 11,140 11,168
  C10,190 9,212 7,234
  C5,254 4,272 4,288
  C4,300 6,312 6,320
  C8,318 11,314 12,306
  C14,288 14,268 16,248
  C18,228 20,206 22,184
  C24,158 26,136 30,114
  Z"/>
<!-- right arm -->
<path class="b" d="
  M160,100
  C166,118 169,140 169,168
  C170,190 171,212 173,234
  C175,254 176,272 176,288
  C176,300 174,312 174,320
  C172,318 169,314 168,306
  C166,288 166,268 164,248
  C162,228 160,206 158,184
  C156,158 154,136 150,114
  Z"/>
<!-- left leg -->
<path class="b" d="
  M56,296
  C52,314 52,338 54,364
  C54,380 52,394 52,410
  C52,430 54,450 54,468
  C54,474 54,480 54,480
  L70,480
  C70,480 70,474 70,468
  C70,450 70,430 70,410
  C70,394 70,380 70,364
  C72,338 72,314 70,296
  Z"/>
<!-- right leg -->
<path class="b" d="
  M110,296
  C114,314 108,338 110,364
  C110,380 110,394 110,410
  C110,430 110,450 110,468
  C110,474 110,480 110,480
  L126,480
  C126,480 126,474 126,468
  C126,450 126,430 126,410
  C126,394 128,380 128,364
  C128,338 128,314 126,296
  Z"/>
<!-- guide lines: chest / waist / hip -->
<line class="g" x1="46" y1="154" x2="134" y2="154"/>
<line class="g" x1="56" y1="208" x2="124" y2="208"/>
<line class="g" x1="52" y1="260" x2="128" y2="260"/>
<text class="l" x="136" y="157">C</text>
<text class="l" x="126" y="211">W</text>
<text class="l" x="130" y="263">H</text>
</svg>`

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

export interface CrquisConfig {
  type: CrquisType
}

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
export function createCrquisElements(
  config: CrquisConfig,
  centerX: number,
  centerY: number,
  scale = 1
): { fileId: string; dataUrl: string; element: object } {
  const isF = config.type === "female"
  const rawW = isF ? 160 : 180
  const rawH = 480
  const w = rawW * scale
  const h = rawH * scale
  const svg = isF ? FEMALE_SVG : MALE_SVG
  const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`
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
      opacity: 85,
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
      customData: { fashionCroquis: config.type },
    },
  }
}

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
