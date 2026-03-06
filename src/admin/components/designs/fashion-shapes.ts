export interface FashionRegion {
  label: string
  points: [number, number][]
  defaultColor: string
}

export interface FashionShape {
  id: string
  name: string
  category: "body" | "garment"
  width: number
  height: number
  regions: FashionRegion[]
}

// ---------------------------------------------------------------------------
// Helper: arc points
// Generates n+1 points on an ellipse arc from angle a1 to a2 (radians, 0=right, π/2=down)
// ---------------------------------------------------------------------------
function arc(
  cx: number, cy: number,
  rx: number, ry: number,
  a1: number, a2: number,
  n = 10
): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const a = a1 + ((a2 - a1) * i) / n
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

const PI = Math.PI

// ---------------------------------------------------------------------------
// SHAPES
// ---------------------------------------------------------------------------

// T-shirt collar crescent — reused by tshirt + blouse
// Outer arc (right-to-left through y=0.15), then inner arc back (left-to-right through y=0.09)
function collarCrescent(): [number, number][] {
  return [
    ...arc(0.5, 0, 0.22, 0.15, 0, PI, 10),          // outer arc R→L
    ...arc(0.5, 0, 0.16, 0.09, PI, 0, 10).reverse(), // inner arc L→R (reversed so polygon closes cleanly)
  ]
}

// Neckline arc for body region (inner arc left-to-right, going through y≈0.09)
function necklineArc(): [number, number][] {
  return arc(0.5, 0, 0.16, 0.09, PI, 0, 10)
}

export const FASHION_SHAPES: FashionShape[] = [
  // ─────────────────────────────────────────────
  // FEMALE FIGURE
  // ─────────────────────────────────────────────
  {
    id: "female-front",
    name: "Female Figure",
    category: "body",
    width: 200,
    height: 420,
    regions: [
      {
        label: "Silhouette",
        defaultColor: "#f5c5a3",
        points: [
          // Right side — head top-right → shoulder → bust → waist → hip → leg → foot
          [0.47, 0.00], [0.55, 0.00], [0.62, 0.02], [0.65, 0.06],
          [0.62, 0.10], [0.57, 0.12],
          // shoulder
          [0.65, 0.16], [0.70, 0.18], [0.72, 0.22],
          // chest / bust
          [0.68, 0.26], [0.65, 0.30], [0.67, 0.34],
          // waist dip
          [0.64, 0.38], [0.60, 0.42],
          // hip flare
          [0.63, 0.46], [0.68, 0.50],
          // thigh → knee → shin → ankle
          [0.66, 0.54], [0.64, 0.58], [0.61, 0.62],
          [0.60, 0.66], [0.60, 0.72], [0.58, 0.78],
          // foot
          [0.62, 0.80], [0.64, 0.88], [0.56, 0.90], [0.54, 1.00],

          // Left side — foot → ankle → knee → hip → waist → shoulder → head
          [0.46, 1.00], [0.44, 0.90], [0.36, 0.88], [0.38, 0.80],
          [0.42, 0.78], [0.40, 0.72], [0.40, 0.66], [0.38, 0.62],
          [0.35, 0.58], [0.33, 0.54],
          // hip
          [0.32, 0.50], [0.37, 0.46],
          // waist
          [0.40, 0.42], [0.36, 0.38],
          // bust
          [0.33, 0.34], [0.35, 0.30], [0.32, 0.26],
          // shoulder
          [0.28, 0.22], [0.30, 0.18], [0.35, 0.16],
          // neck
          [0.43, 0.12], [0.38, 0.10], [0.35, 0.06], [0.38, 0.02], [0.45, 0.00],
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // MALE FIGURE
  // ─────────────────────────────────────────────
  {
    id: "male-front",
    name: "Male Figure",
    category: "body",
    width: 220,
    height: 420,
    regions: [
      {
        label: "Silhouette",
        defaultColor: "#c8a882",
        points: [
          // Right side — head → broader shoulders → straight torso → leg → foot
          [0.47, 0.00], [0.55, 0.00], [0.63, 0.02], [0.66, 0.06],
          [0.63, 0.10], [0.58, 0.12],
          // broader shoulder
          [0.68, 0.16], [0.74, 0.18], [0.76, 0.22],
          // chest (wider, less hourglass)
          [0.72, 0.26], [0.70, 0.30], [0.70, 0.36],
          // straighter waist/hip
          [0.68, 0.42], [0.68, 0.48],
          // thigh → knee → shin → ankle
          [0.66, 0.54], [0.64, 0.58], [0.61, 0.62],
          [0.60, 0.66], [0.60, 0.72], [0.58, 0.78],
          // foot
          [0.62, 0.80], [0.63, 0.88], [0.56, 0.90], [0.54, 1.00],

          // Left side
          [0.46, 1.00], [0.44, 0.90], [0.37, 0.88], [0.38, 0.80],
          [0.42, 0.78], [0.40, 0.72], [0.40, 0.66], [0.38, 0.62],
          [0.35, 0.58], [0.33, 0.54],
          [0.32, 0.48], [0.32, 0.42],
          [0.30, 0.36], [0.30, 0.30], [0.28, 0.26],
          // shoulder
          [0.24, 0.22], [0.26, 0.18], [0.32, 0.16],
          // neck
          [0.42, 0.12], [0.37, 0.10], [0.34, 0.06], [0.37, 0.02], [0.45, 0.00],
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // T-SHIRT
  // ─────────────────────────────────────────────
  {
    id: "tshirt",
    name: "T-Shirt",
    category: "garment",
    width: 320,
    height: 280,
    regions: [
      {
        label: "Body",
        defaultColor: "#e8e8e8",
        // Clockwise from BL: bottom → right side → right shoulder → neckline arc → left shoulder → left side
        points: [
          [0.22, 1.00], [0.78, 1.00],
          [0.78, 0.30], [0.74, 0.08], [0.72, 0.02],
          ...necklineArc(),
          [0.28, 0.02], [0.26, 0.08], [0.22, 0.30],
        ],
      },
      {
        label: "Left Sleeve",
        defaultColor: "#d0d0d0",
        // From top-shoulder seam, sweep out and back to armhole-bottom seam
        points: [
          [0.28, 0.02], [0.24, 0.01], [0.16, 0.00], [0.07, 0.00],
          [0.01, 0.03],
          ...arc(0.00, 0.15, 0.02, 0.12, -PI / 2, PI / 2, 8), // rounded sleeve opening
          [0.01, 0.27], [0.05, 0.30], [0.12, 0.31], [0.20, 0.30],
          [0.26, 0.08], [0.22, 0.30],
        ],
      },
      {
        label: "Right Sleeve",
        defaultColor: "#d0d0d0",
        points: [
          [0.72, 0.02], [0.76, 0.01], [0.84, 0.00], [0.93, 0.00],
          [0.99, 0.03],
          ...arc(1.00, 0.15, 0.02, 0.12, PI / 2, -PI / 2, 8).reverse(),
          [0.99, 0.27], [0.95, 0.30], [0.88, 0.31], [0.80, 0.30],
          [0.74, 0.08], [0.78, 0.30],
        ],
      },
      {
        label: "Collar",
        defaultColor: "#b8b8b8",
        points: collarCrescent(),
      },
    ],
  },

  // ─────────────────────────────────────────────
  // DRESS
  // ─────────────────────────────────────────────
  {
    id: "dress",
    name: "Dress",
    category: "garment",
    width: 320,
    height: 440,
    regions: [
      {
        label: "Bodice",
        defaultColor: "#e8d0e0",
        points: [
          [0.22, 0.42], [0.78, 0.42],
          [0.78, 0.30], [0.74, 0.08], [0.72, 0.02],
          ...necklineArc(),
          [0.28, 0.02], [0.26, 0.08], [0.22, 0.30],
        ],
      },
      {
        label: "Skirt",
        defaultColor: "#d0b8e0",
        // A-line flare from waist to hem
        points: [
          [0.22, 0.42], [0.78, 0.42],
          ...arc(0.78, 0.42, 0.22, 0.18, 0, PI / 6, 4),  // gentle flare right
          [1.00, 1.00], [0.00, 1.00],
          ...arc(0.22, 0.42, 0.22, 0.18, PI - PI / 6, PI, 4), // gentle flare left
        ],
      },
      {
        label: "Left Sleeve",
        defaultColor: "#c8a8d8",
        points: [
          [0.28, 0.02], [0.24, 0.01], [0.16, 0.00], [0.07, 0.00],
          [0.01, 0.03],
          ...arc(0.00, 0.15, 0.02, 0.12, -PI / 2, PI / 2, 8),
          [0.01, 0.27], [0.05, 0.30], [0.12, 0.31], [0.20, 0.30],
          [0.26, 0.08], [0.22, 0.30],
        ],
      },
      {
        label: "Right Sleeve",
        defaultColor: "#c8a8d8",
        points: [
          [0.72, 0.02], [0.76, 0.01], [0.84, 0.00], [0.93, 0.00],
          [0.99, 0.03],
          ...arc(1.00, 0.15, 0.02, 0.12, PI / 2, -PI / 2, 8).reverse(),
          [0.99, 0.27], [0.95, 0.30], [0.88, 0.31], [0.80, 0.30],
          [0.74, 0.08], [0.78, 0.30],
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // TROUSERS
  // ─────────────────────────────────────────────
  {
    id: "trousers",
    name: "Trousers",
    category: "garment",
    width: 300,
    height: 420,
    regions: [
      {
        label: "Waistband",
        defaultColor: "#8a7a6a",
        points: [
          [0.10, 0.00], [0.90, 0.00],
          [0.90, 0.07], [0.10, 0.07],
        ],
      },
      {
        label: "Left Leg",
        defaultColor: "#5a4a3a",
        points: [
          [0.10, 0.07], [0.50, 0.07],
          // crotch curve
          ...arc(0.50, 0.36, 0.20, 0.28, -PI / 2, PI / 2, 8).map(
            ([x, y]): [number, number] => [1.00 - x, y] // mirror for left
          ).reverse(),
          // outside of left leg going down, slight taper
          [0.46, 0.50], [0.44, 0.70], [0.43, 0.90], [0.42, 1.00],
          [0.11, 1.00], [0.10, 0.90], [0.08, 0.70], [0.08, 0.50],
          [0.10, 0.36],
        ],
      },
      {
        label: "Right Leg",
        defaultColor: "#6a5a4a",
        points: [
          [0.50, 0.07], [0.90, 0.07],
          [0.90, 0.36],
          // outside of right leg
          [0.92, 0.50], [0.92, 0.70], [0.90, 0.90], [0.89, 1.00],
          [0.58, 1.00], [0.57, 0.90], [0.56, 0.70], [0.54, 0.50],
          // crotch curve
          ...arc(0.50, 0.36, 0.20, 0.28, -PI / 2, PI / 2, 8),
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // JACKET
  // ─────────────────────────────────────────────
  {
    id: "jacket",
    name: "Jacket",
    category: "garment",
    width: 360,
    height: 360,
    regions: [
      {
        label: "Front Left",
        defaultColor: "#3a3a4a",
        // Left half: from hem up to left shoulder, lapel, then down center to hem
        points: [
          [0.50, 1.00], [0.17, 1.00],
          [0.15, 0.70], [0.15, 0.50], [0.17, 0.30], [0.20, 0.22],
          // shoulder seam (body connects to sleeve here)
          [0.24, 0.08], [0.26, 0.02], [0.30, 0.00],
          // lapel curves toward center
          [0.38, 0.06], [0.44, 0.12],
          [0.50, 0.18], [0.50, 0.30],
        ],
      },
      {
        label: "Front Right",
        defaultColor: "#2a2a3a",
        points: [
          [0.50, 1.00], [0.83, 1.00],
          [0.85, 0.70], [0.85, 0.50], [0.83, 0.30], [0.80, 0.22],
          [0.76, 0.08], [0.74, 0.02], [0.70, 0.00],
          [0.62, 0.06], [0.56, 0.12],
          [0.50, 0.18], [0.50, 0.30],
        ],
      },
      {
        label: "Left Sleeve",
        defaultColor: "#4a4a5a",
        // Long sleeve — from shoulder seam, down to wrist (about 0.75 height)
        points: [
          [0.24, 0.08], [0.20, 0.06], [0.12, 0.04], [0.04, 0.06],
          [0.01, 0.10],
          ...arc(0.00, 0.42, 0.02, 0.10, -PI / 2, PI / 2, 6),
          [0.01, 0.74], [0.05, 0.78], [0.12, 0.80], [0.18, 0.78],
          [0.22, 0.74], [0.22, 0.22], [0.20, 0.22],
        ],
      },
      {
        label: "Right Sleeve",
        defaultColor: "#4a4a5a",
        points: [
          [0.76, 0.08], [0.80, 0.06], [0.88, 0.04], [0.96, 0.06],
          [0.99, 0.10],
          ...arc(1.00, 0.42, 0.02, 0.10, PI / 2, -PI / 2, 6).reverse(),
          [0.99, 0.74], [0.95, 0.78], [0.88, 0.80], [0.82, 0.78],
          [0.78, 0.74], [0.78, 0.22], [0.80, 0.22],
        ],
      },
      {
        label: "Collar",
        defaultColor: "#5a5a6a",
        // V-notch collar / lapel band at top
        points: [
          [0.30, 0.00], [0.70, 0.00],
          [0.64, 0.06], [0.58, 0.10], [0.52, 0.14], [0.50, 0.18],
          [0.48, 0.14], [0.42, 0.10], [0.36, 0.06],
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // SKIRT
  // ─────────────────────────────────────────────
  {
    id: "skirt",
    name: "Skirt",
    category: "garment",
    width: 280,
    height: 340,
    regions: [
      {
        label: "Waistband",
        defaultColor: "#9a8a7a",
        points: [
          [0.15, 0.00], [0.85, 0.00],
          ...arc(0.85, 0.08, 0.03, 0.08, -PI / 2, PI / 2, 3),
          [0.85, 0.16], [0.15, 0.16],
          ...arc(0.15, 0.08, 0.03, 0.08, PI / 2, -PI / 2, 3).reverse(),
        ],
      },
      {
        label: "Skirt Body",
        defaultColor: "#c8b0a8",
        // A-line flare — gentle curve on both sides
        points: [
          [0.15, 0.16], [0.85, 0.16],
          ...arc(0.85, 0.16, 0.18, 0.20, -PI / 10, PI / 4, 5),  // right flare
          [1.00, 1.00], [0.00, 1.00],
          ...arc(0.15, 0.16, 0.18, 0.20, PI - PI / 4, PI + PI / 10, 5), // left flare
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // BLOUSE
  // ─────────────────────────────────────────────
  {
    id: "blouse",
    name: "Blouse",
    category: "garment",
    width: 320,
    height: 300,
    regions: [
      {
        label: "Body",
        defaultColor: "#f0e8e0",
        points: [
          [0.22, 1.00], [0.78, 1.00],
          [0.78, 0.30], [0.74, 0.08], [0.72, 0.02],
          ...necklineArc(),
          [0.28, 0.02], [0.26, 0.08], [0.22, 0.30],
        ],
      },
      {
        label: "Left Sleeve",
        defaultColor: "#e0d0c8",
        // Longer sleeve with bell-like opening
        points: [
          [0.28, 0.02], [0.22, 0.01], [0.14, 0.00], [0.05, 0.00],
          [0.00, 0.04],
          // sleeve body going down
          [0.00, 0.12], [0.00, 0.26], [0.00, 0.42],
          // bell opening at cuff
          ...arc(0.03, 0.56, 0.08, 0.06, PI, 0, 6),
          [0.22, 0.56], [0.22, 0.30], [0.26, 0.08],
        ],
      },
      {
        label: "Right Sleeve",
        defaultColor: "#e0d0c8",
        points: [
          [0.72, 0.02], [0.78, 0.01], [0.86, 0.00], [0.95, 0.00],
          [1.00, 0.04],
          [1.00, 0.12], [1.00, 0.26], [1.00, 0.42],
          ...arc(0.97, 0.56, 0.08, 0.06, 0, PI, 6).reverse(),
          [0.78, 0.56], [0.78, 0.30], [0.74, 0.08],
        ],
      },
      {
        label: "Collar",
        defaultColor: "#d8c8c0",
        points: collarCrescent(),
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// 3/4 perspective transform (oblique projection)
// Compresses x and shears y so the right side recedes, faking a 3D angle.
// ---------------------------------------------------------------------------
const P_SX = 0.78   // x compression — right side squishes inward
const P_SY = 1.04   // slight vertical stretch to compensate
const P_SH = 0.24   // y-shear — right side rises by this fraction of height

/**
 * Apply 3/4 perspective to an array of already-scaled [x, y] canvas points.
 * Points are in canvas units (0…w, 0…h), not normalised.
 */
export function perspectiveTransformPoints(
  points: [number, number][],
  w: number,
  h: number
): [number, number][] {
  return points.map(([px, py]) => {
    const nx = px / w
    const ny = py / h
    // Foreshortening: shear is stronger near the top than the bottom
    const shearFactor = 1 - ny * 0.35
    return [nx * P_SX * w, (ny * P_SY - nx * P_SH * shearFactor) * h] as [number, number]
  })
}

// ---------------------------------------------------------------------------
// Element factory — creates Excalidraw `line` elements (one per region)
// ---------------------------------------------------------------------------
function randomId(): string {
  return Math.random().toString(36).slice(2)
}

export function createShapeElements(
  shape: FashionShape,
  centerX: number,
  centerY: number,
  scale = 1,
  perspective: "flat" | "three-quarter" = "flat"
): object[] {
  const groupId = randomId()
  const w = shape.width * scale
  const h = shape.height * scale
  const originX = centerX - w / 2
  const originY = centerY - h / 2

  return shape.regions.map((region) => {
    const id = randomId()

    // Scale normalised 0–1 coords to canvas units, then optionally transform
    let scaledPoints: [number, number][] = region.points.map(
      ([px, py]) => [px * w, py * h]
    )
    if (perspective === "three-quarter") {
      scaledPoints = perspectiveTransformPoints(scaledPoints, w, h)
    }

    // Excalidraw line: element (x,y) = absolute position of points[0],
    // all points[] are relative to (x,y)
    const [x0, y0] = scaledPoints[0]
    const relativePoints: [number, number][] = scaledPoints.map(
      ([px, py]) => [px - x0, py - y0]
    )
    // Close the polygon
    relativePoints.push([0, 0])

    return {
      type: "line",
      id,
      x: originX + x0,
      y: originY + y0,
      width: w,
      height: h,
      angle: 0,
      strokeColor: "#1a1a1a",
      backgroundColor: region.defaultColor,
      fillStyle: "solid",
      strokeWidth: 1.5,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [groupId],
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
      points: relativePoints,
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: null,
      customData: {
        fashionShape: shape.id,
        fashionRegion: region.label,
      },
    }
  })
}
