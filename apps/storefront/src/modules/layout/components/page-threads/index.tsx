/**
 * Painted hero for the CMS pages route (`/pages/[slug]`).
 *
 * A hand-drawn study of poppies after the reference painting: loose outlines,
 * translucent washes that deepen where the petals overlap, ray hatching
 * fanning out of every petal base, long sketchy stems, leaves and closed buds.
 * Everything is line work on warm paper, so it sits in the same material
 * world as the rest of the storefront.
 *
 * Each page gets its own garden: `PageHero` hashes the page slug into one of
 * six dye palettes (gold, indigo, madder, sage, plum, terracotta) and derives
 * per-bloom sway durations and offsets from the same hash. The result is
 * stable across reloads — no hydration drift — but /pages/privacy-policy and
 * /pages/terms-and-conditions never share a colour or a rhythm.
 *
 * `PageHero` sets the page title on top of that painting. The painting is the
 * hero, edge to edge and unbounded — no card, no rounding, no border — with a
 * soft paper veil behind the type. The flowers stay sharp and saturated at
 * the crop rather than sitting in a separate band under the heading.
 *
 * Pure SVG + CSS keyframes, no client JS. Everything decorative is
 * aria-hidden, and all motion stops under `prefers-reduced-motion`.
 */

import type { CSSProperties } from "react"

// Madder, indigo, turmeric, leaf, walnut, rose — the stitched rule under the
// hero title rotates through these.
const DYES = ["#b8322a", "#2f4a7a", "#d39a2f", "#5f7a4a", "#7a5236", "#c97b84"]

type Palette = {
  key: string
  /** Petal outline. */
  ink: string
  /** Second sketch pass, hatching, veins. */
  inkDeep: string
  stem: string
  /** Top, middle and bottom of the paper gradient. */
  paper: [string, string, string]
  /** Petal wash: base, middle, tip. */
  wash: [string, string, string]
  /** Lighter wash for the soft-toned petals and leaves. */
  soft: [string, string, string]
  pool: string
  title: string
  subtitle: string
}

const PALETTES: Palette[] = [
  {
    key: "gold",
    ink: "#d2800a",
    inkDeep: "#b06404",
    stem: "#cf9612",
    paper: ["#fbf3e0", "#f9f1e3", "#f7f4ef"],
    wash: ["#e9a300", "#f4bf0f", "#fbd951"],
    soft: ["#f2b605", "#f8cd2c", "#fde58a"],
    pool: "#e7a200",
    title: "#2f2210",
    subtitle: "#6b5535",
  },
  {
    key: "indigo",
    ink: "#3f6094",
    inkDeep: "#2b4570",
    stem: "#4d6f9f",
    paper: ["#eef3f8", "#f2f4f2", "#f7f4ef"],
    wash: ["#2f4a7a", "#4a6fa8", "#93b3d8"],
    soft: ["#5b7fb0", "#82a4cd", "#c3d6ea"],
    pool: "#2f4a7a",
    title: "#1f2c3f",
    subtitle: "#4c5b70",
  },
  {
    key: "madder",
    ink: "#bf3b30",
    inkDeep: "#8f231d",
    stem: "#c2584a",
    paper: ["#fdf0e9", "#fbf2ea", "#f7f4ef"],
    wash: ["#b8322a", "#d4553f", "#f0a08a"],
    soft: ["#c85a45", "#e07a5f", "#f6c8b8"],
    pool: "#b8322a",
    title: "#3a1a16",
    subtitle: "#7a4a40",
  },
  {
    key: "sage",
    ink: "#66834f",
    inkDeep: "#475f36",
    stem: "#74915a",
    paper: ["#f2f5ea", "#f5f5ee", "#f7f4ef"],
    wash: ["#5f7a4a", "#7f9a62", "#bacb9b"],
    soft: ["#7f9a62", "#a0b683", "#d2dfba"],
    pool: "#5f7a4a",
    title: "#2a3320",
    subtitle: "#5a6647",
  },
  {
    key: "plum",
    ink: "#834574",
    inkDeep: "#5c2a51",
    stem: "#8f5580",
    paper: ["#f7eef4", "#f8f1f0", "#f7f4ef"],
    wash: ["#7a3f6d", "#9a5a8a", "#cba2c0"],
    soft: ["#9a5a8a", "#b77ba7", "#dfc5d6"],
    pool: "#7a3f6d",
    title: "#35202f",
    subtitle: "#6b4a60",
  },
  {
    key: "terracotta",
    ink: "#ad5c2f",
    inkDeep: "#7f3f1e",
    stem: "#b76f40",
    paper: ["#fbf1e6", "#faf2e9", "#f7f4ef"],
    wash: ["#a4552a", "#c4713f", "#e7b58e"],
    soft: ["#b8693a", "#d18c5e", "#f0cdb0"],
    pool: "#a4552a",
    title: "#3a2417",
    subtitle: "#6e4c34",
  },
]

/** FNV-1a. Small, fast, and stable across server and client. */
const hashSeed = (input: string): number => {
  let hash = 2166136261

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

/** Mulberry32 — deterministic pseudo-random in [0, 1). */
const makeRandom = (seed: number) => {
  let state = seed

  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Motion = {
  /** Seconds for one full sway. */
  dur: number
  /** Negative delay so the bloom is already mid-motion on first paint. */
  delay: number
  /** Degrees, signed. */
  sway: number
  /** Seconds before this bloom unfolds on first paint. */
  open: number
}

type PetalSpec = {
  /** Degrees from straight up, clockwise. */
  angle: number
  length: number
  width: number
  /** 0 soft, 1 full. */
  tone?: 0 | 1 | 2
  /** Small deterministic asymmetry, so no two petals are the same shape. */
  seed?: number
}

/**
 * One poppy petal: a broad, slightly crumpled fan, washed in the page's dye,
 * edged twice and hatched with rays running out of the base — the tell that
 * makes the reference read as a sketch rather than a flat shape.
 */
const Petal = ({
  id,
  angle,
  length,
  width,
  tone = 1,
  seed = 0,
  c,
}: PetalSpec & { id: string; c: Palette }) => {
  const clipId = `poppy-petal-${c.key}-${id}`
  const wash =
    tone === 0
      ? `url(#poppy-wash-soft-${c.key})`
      : `url(#poppy-wash-${c.key})`

  // Two halves of the petal are never quite the same width.
  const lean = ((seed % 5) - 2) * 0.045
  const wL = width * (1 + lean)
  const wR = width * (1 - lean)

  // Eight segments, alternating bulges and pinches, so the edge is never a
  // clean arc — it is a wet brush line that wanders.
  const outline =
    `M 0 0` +
    ` Q ${-wL * 0.95} ${-length * 0.15} ${-wL * 0.88} ${-length * 0.3}` +
    ` Q ${-wL * 1.08} ${-length * 0.46} ${-wL * 0.72} ${-length * 0.62}` +
    ` Q ${-wL * 0.5} ${-length * 0.8} ${-wL * 0.24} ${-length * 0.94}` +
    ` Q 0 ${-length * 1.04} ${wR * 0.24} ${-length * 0.94}` +
    ` Q ${wR * 0.52} ${-length * 0.79} ${wR * 0.72} ${-length * 0.6}` +
    ` Q ${wR * 1.04} ${-length * 0.43} ${wR * 0.84} ${-length * 0.27}` +
    ` Q ${wR * 0.92} ${-length * 0.11} 0 0 Z`

  // Broad, low-opacity strokes following the rays: the streak of pigment a
  // wet brush leaves behind.
  const streaks = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 6 - 0.5) * 1
    const r0 = length * 0.08
    const r1 = length * (0.55 + 0.34 * Math.sin((i / 6) * Math.PI))

    return {
      d: `M ${(Math.sin(a) * r0).toFixed(1)} ${(-Math.cos(a) * r0).toFixed(
        1
      )} L ${(Math.sin(a) * r1).toFixed(1)} ${(-Math.cos(a) * r1).toFixed(1)}`,
      width: 5 + (i % 3) * 4,
    }
  })

  const rays = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8
    const a = (t - 0.5) * 1.12
    const inner = length * (0.1 + 0.12 * Math.abs(t - 0.5))
    const outer = length * (0.58 + 0.36 * Math.sin(t * Math.PI))
    const x0 = Math.sin(a) * inner
    const y0 = -Math.cos(a) * inner
    const x1 = Math.sin(a) * outer
    const y1 = -Math.cos(a) * outer
    const mx = Math.sin(a) * length * 0.38 + Math.sin(a + 1.1) * length * 0.06
    const my = -Math.cos(a) * length * 0.38 - Math.cos(a + 1.1) * length * 0.06

    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(
      1
    )} ${x1.toFixed(1)} ${y1.toFixed(1)}`
  })

  return (
    <g transform={`rotate(${angle})`}>
      <clipPath id={clipId}>
        <path d={outline} />
      </clipPath>

      <path d={outline} fill={wash} />
      {/* The poppy's dark heart: pigment pooled where the petal meets the
          centre, feathering out before the midpoint. */}
      <ellipse
        cx={0}
        cy={-length * 0.16}
        rx={width * 0.42}
        ry={length * 0.2}
        fill={`url(#poppy-heart-${c.key})`}
        clipPath={`url(#${clipId})`}
      />
      <path
        d={outline}
        fill="none"
        stroke={c.ink}
        strokeWidth={1.6}
        strokeOpacity={0.78}
        strokeLinejoin="round"
      />
      <path
        d={outline}
        transform="translate(3 -2) rotate(1.6)"
        fill="none"
        stroke={c.inkDeep}
        strokeWidth={0.9}
        strokeOpacity={0.24}
        strokeDasharray="34 6 14 5"
      />

      <g
        clipPath={`url(#${clipId})`}
        fill="none"
        stroke={c.inkDeep}
        strokeLinecap="round"
      >
        {/* Pigment gathering at the rim. */}
        <path d={outline} strokeWidth={7} strokeOpacity={0.1} />
        {streaks.map((streak, i) => (
          <path
            key={`s-${i}`}
            d={streak.d}
            strokeWidth={streak.width}
            strokeOpacity={0.06}
          />
        ))}
        <g strokeWidth={0.9} strokeOpacity={0.22}>
          {rays.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        {/* Crumple at the base, as in the painting. */}
        <path
          d={`M ${-width * 0.56} ${-length * 0.18} Q 0 ${-length * 0.32} ${
            width * 0.6
          } ${-length * 0.11}`}
          strokeWidth={1.1}
          strokeOpacity={0.3}
        />
        <path
          d={`M ${-width * 0.46} ${-length * 0.06} Q ${width * 0.12} ${
            -length * 0.2
          } ${width * 0.46} ${-length * 0.05}`}
          strokeWidth={0.9}
          strokeOpacity={0.22}
        />
        <path
          d={`M ${-width * 0.3} ${-length * 0.3} Q ${width * 0.02} ${
            -length * 0.44
          } ${width * 0.3} ${-length * 0.32}`}
          strokeWidth={0.8}
          strokeOpacity={0.16}
        />
      </g>
    </g>
  )
}

/** A ring of petals around a centre, deliberately uneven. */
const rosette = (
  count: number,
  length: number,
  width: number,
  seed = 0
): PetalSpec[] =>
  Array.from({ length: count }, (_, i) => ({
    angle: (360 / count) * i + seed + (i % 2 === 0 ? 5 : -7),
    length: length * (i % 3 === 0 ? 1.08 : i % 3 === 1 ? 0.9 : 1),
    width: width * (i % 2 === 0 ? 1 : 0.88),
    tone: (i % 3 === 0 ? 0 : 1) as 0 | 1,
    seed: i + seed,
  }))

const Bloom = ({
  id,
  x,
  y,
  petals,
  tilt = 0,
  scale = 1,
  c,
  motion,
}: {
  id: string
  x: number
  y: number
  petals: PetalSpec[]
  tilt?: number
  scale?: number
  c: Palette
  motion: Motion
}) => {
  const reach = petals.reduce((max, petal) => Math.max(max, petal.length), 0)

  // Position and sway are separate groups: the outer one places the bloom,
  // the inner one is free to rotate around its own base in CSS.
  return (
    <g transform={`translate(${x} ${y})`}>
      <g
        className="poppy-sway"
        style={
          {
            "--dur": `${motion.dur}s`,
            "--delay": `${motion.delay}s`,
            "--sway": `${motion.sway}deg`,
          } as CSSProperties
        }
      >
        <g transform={`rotate(${tilt}) scale(${scale})`}>
          <g
            className="poppy-open"
            style={{ "--open-delay": `${motion.open}s` } as CSSProperties}
          >
            {/* Pigment pooled under the bloom, the watercolour halo. */}
            <circle r={reach * 0.92} fill={`url(#poppy-pool-${c.key})`} />
            {petals.map((petal, i) => (
              <Petal key={`${id}-${i}`} id={`${id}-${i}`} {...petal} c={c} />
            ))}
            {/* Stamens: fine filaments ending in a dusted tip. */}
            <g stroke={c.inkDeep} strokeLinecap="round">
              {Array.from({ length: 14 }, (_, i) => {
                const a = (i / 14) * Math.PI * 2 + 0.2
                const r0 = reach * 0.07
                const r1 = reach * (0.15 + (i % 3) * 0.02)
                return (
                  <g key={i}>
                    <path
                      d={`M ${Math.sin(a) * r0} ${-Math.cos(a) * r0} L ${
                        Math.sin(a) * r1
                      } ${-Math.cos(a) * r1}`}
                      strokeWidth={0.8}
                      strokeOpacity={0.4}
                    />
                    <circle
                      cx={Math.sin(a) * r1}
                      cy={-Math.cos(a) * r1}
                      r={reach * 0.011}
                      fill={c.inkDeep}
                      fillOpacity={0.55}
                      stroke="none"
                    />
                  </g>
                )
              })}
            </g>
            {/* Seed head: a dark crown with the ribbed cap on top. */}
            <circle r={reach * 0.07} fill={c.inkDeep} fillOpacity={0.78} />
            <circle
              r={reach * 0.045}
              fill="none"
              stroke="#fffdf6"
              strokeOpacity={0.35}
              strokeWidth={0.8}
            />
            <g stroke="#fffdf6" strokeOpacity={0.28} strokeWidth={0.7}>
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const a = (i / 6) * Math.PI * 2
                return (
                  <path
                    key={i}
                    d={`M 0 0 L ${Math.sin(a) * reach * 0.045} ${
                      -Math.cos(a) * reach * 0.045
                    }`}
                  />
                )
              })}
            </g>
          </g>
        </g>
      </g>
    </g>
  )
}

/** Stem drawn twice, the second pass offset, so it wobbles like a pen line. */
const Stem = ({ d, width = 3, c }: { d: string; width?: number; c: Palette }) => (
  <>
    <path
      d={d}
      fill="none"
      stroke={c.stem}
      strokeWidth={width}
      strokeOpacity={0.8}
      strokeLinecap="round"
    />
    <path
      d={d}
      transform="translate(3 0)"
      fill="none"
      stroke={c.inkDeep}
      strokeWidth={1.1}
      strokeOpacity={0.3}
      strokeLinecap="round"
    />
  </>
)

/** A slender leaf: washed body, centre vein, a few side veins. */
const Leaf = ({
  x,
  y,
  angle,
  length,
  width,
  c,
}: {
  x: number
  y: number
  angle: number
  length: number
  width: number
  c: Palette
}) => {
  const clipId = `poppy-leaf-${c.key}-${Math.round(x)}-${Math.round(y)}`

  const d =
    `M 0 0 C ${width} ${-length * 0.26} ${width * 0.72} ${-length * 0.76} 0 ${-length}` +
    ` C ${-width * 0.72} ${-length * 0.76} ${-width} ${-length * 0.26} 0 0 Z`

  const veins = Array.from({ length: 6 }, (_, i) => {
    const t = 0.18 + i * 0.13
    const side = i % 2 === 0 ? 1 : -1

    return `M 0 ${-length * t} Q ${side * width * 0.55} ${-length * (t + 0.04)} ${
      side * width * 0.82
    } ${-length * (t + 0.12)}`
  })

  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <clipPath id={clipId}>
        <path d={d} />
      </clipPath>

      <path d={d} fill={`url(#poppy-wash-soft-${c.key})`} />
      <path d={d} fill="none" stroke={c.ink} strokeWidth={1.8} />

      <g
        clipPath={`url(#${clipId})`}
        fill="none"
        stroke={c.inkDeep}
        strokeWidth={1.1}
        strokeOpacity={0.45}
        strokeLinecap="round"
      >
        <path d={`M 0 0 L 0 ${-length}`} strokeWidth={1.6} />
        {veins.map((vein, i) => (
          <path key={i} d={vein} />
        ))}
      </g>
    </g>
  )
}

/** Closed poppy head: three narrow petals, vertical hatching, a sepal. */
const Bud = ({
  x,
  y,
  angle = 0,
  scale = 1,
  c,
}: {
  x: number
  y: number
  angle?: number
  scale?: number
  c: Palette
}) => (
  <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
    <path
      d="M 0 0 C -22 -18 -26 -58 -10 -84 C -2 -96 2 -96 10 -84 C 26 -58 22 -18 0 0 Z"
      fill={`url(#poppy-wash-${c.key})`}
      stroke={c.ink}
      strokeWidth={1.8}
    />
    <path
      d="M -14 0 C -34 -16 -40 -52 -24 -78 C -16 -90 -8 -88 -4 -76 C -12 -48 -6 -20 -14 0 Z"
      fill={`url(#poppy-wash-soft-${c.key})`}
      stroke={c.ink}
      strokeWidth={1.4}
    />
    <path
      d="M 14 0 C 34 -16 40 -52 24 -78 C 16 -90 8 -88 4 -76 C 12 -48 6 -20 14 0 Z"
      fill={`url(#poppy-wash-soft-${c.key})`}
      stroke={c.ink}
      strokeWidth={1.4}
    />
    {[-10, -4, 2, 8].map((v) => (
      <path
        key={v}
        d={`M ${v} -12 C ${v - 3} -34 ${v + 2} -56 ${v} -74`}
        fill="none"
        stroke={c.inkDeep}
        strokeWidth={1.1}
        strokeOpacity={0.4}
        strokeLinecap="round"
      />
    ))}
    <path
      d="M -18 2 C -10 -6 10 -6 18 2"
      fill="none"
      stroke={c.ink}
      strokeWidth={1.8}
      strokeLinecap="round"
    />
  </g>
)

type BloomSpec = {
  id: string
  x: number
  y: number
  tilt: number
  count: number
  length: number
  width: number
  seed: number
}

const BLOOMS: BloomSpec[] = [
  { id: "a", x: 170, y: 60, tilt: 10, count: 6, length: 200, width: 158, seed: 8 },
  { id: "a2", x: 330, y: 10, tilt: -14, count: 5, length: 150, width: 120, seed: 2 },
  { id: "b", x: 600, y: 120, tilt: -6, count: 5, length: 146, width: 118, seed: 5 },
  { id: "c", x: 880, y: 50, tilt: 14, count: 6, length: 206, width: 162, seed: 14 },
  { id: "c2", x: 1040, y: 10, tilt: -18, count: 5, length: 142, width: 114, seed: 21 },
  { id: "d", x: 1330, y: 60, tilt: -10, count: 6, length: 186, width: 148, seed: 4 },
  { id: "d2", x: 1490, y: 20, tilt: 16, count: 5, length: 136, width: 108, seed: 11 },
  { id: "e", x: 1585, y: 265, tilt: 8, count: 5, length: 156, width: 124, seed: 7 },
  { id: "f", x: 520, y: 350, tilt: -16, count: 5, length: 114, width: 92, seed: 3 },
  { id: "g", x: 1120, y: 390, tilt: 12, count: 6, length: 152, width: 120, seed: 9 },
  { id: "h", x: 75, y: 400, tilt: -8, count: 5, length: 132, width: 106, seed: 16 },
]

const STEMS: Array<{ d: string; width?: number }> = [
  { d: "M 170 60 C 140 170 96 290 126 430", width: 3.4 },
  { d: "M 330 10 C 352 140 318 280 344 430" },
  { d: "M 600 120 C 630 220 592 320 626 430", width: 3.2 },
  { d: "M 880 50 C 856 170 906 290 874 430", width: 3.4 },
  { d: "M 1040 10 C 1062 140 1024 290 1054 430" },
  { d: "M 1330 60 C 1360 170 1310 290 1346 430", width: 3.4 },
  { d: "M 1490 20 C 1462 150 1508 280 1476 430" },
  { d: "M 1585 265 C 1548 330 1590 380 1566 430", width: 3.2 },
  { d: "M 520 350 C 508 380 534 406 524 430", width: 2.6 },
  { d: "M 1120 390 C 1110 404 1132 416 1120 430" },
  { d: "M 75 400 C 68 412 84 420 76 430", width: 2.6 },
  { d: "M 250 362 C 242 386 258 408 248 430", width: 2.2 },
  { d: "M 1230 320 C 1240 360 1218 396 1234 430", width: 2.2 },
]

/**
 * Keyframes live here rather than in globals so the hero carries its own
 * choreography. Durations are read from per-element custom properties, which
 * is how each page ends up with a different tempo from the same rules.
 */
const PoppyMotionStyles = () => (
  <style>{`
    @keyframes poppy-sway {
      0%   { transform: rotate(calc(var(--sway, 1.4deg) * -1)); }
      100% { transform: rotate(var(--sway, 1.4deg)); }
    }
    @keyframes poppy-breathe {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.012); }
    }
    @keyframes poppy-stem-drift {
      0%, 100% { transform: translateX(-7px); }
      50%      { transform: translateX(7px); }
    }
    @keyframes poppy-glow {
      0%, 100% { opacity: 0.04; }
      50%      { opacity: 0.16; }
    }
    @keyframes poppy-open {
      0%   { opacity: 0; transform: scale(0.82) rotate(-6deg); }
      60%  { opacity: 1; }
      100% { opacity: 1; transform: scale(1) rotate(0deg); }
    }
    @keyframes poppy-drift {
      0%   { transform: translate(-80px, 0) rotate(0deg); opacity: 0; }
      8%   { opacity: 0.85; }
      50%  { transform: translate(800px, var(--drift-rise, -40px)) rotate(calc(var(--drift-spin, 240deg) / 2)); }
      92%  { opacity: 0.85; }
      100% { transform: translate(1700px, 20px) rotate(var(--drift-spin, 240deg)); opacity: 0; }
    }

    .poppy-sway {
      animation: poppy-sway var(--dur, 12s) ease-in-out var(--delay, 0s) infinite alternate;
      transform-box: fill-box;
      transform-origin: 50% 92%;
      will-change: transform;
    }
    .poppy-bed {
      animation: poppy-breathe 24s ease-in-out infinite;
      transform-box: fill-box;
      transform-origin: 50% 100%;
    }
    .poppy-stems {
      animation: poppy-stem-drift 18s ease-in-out infinite;
    }
    .poppy-open {
      animation: poppy-open 1.6s cubic-bezier(0.22, 1, 0.36, 1) var(--open-delay, 0s) both;
      transform-box: fill-box;
      transform-origin: 50% 50%;
    }
    .poppy-drifter {
      animation: poppy-drift var(--drift-dur, 32s) linear var(--drift-delay, 0s) infinite;
      transform-box: fill-box;
      transform-origin: 50% 50%;
    }
    .poppy-glow {
      animation: poppy-glow 16s ease-in-out infinite;
      mix-blend-mode: soft-light;
    }

    @media (prefers-reduced-motion: reduce) {
      .poppy-sway,
      .poppy-bed,
      .poppy-stems,
      .poppy-glow,
      .poppy-open {
        animation: none;
      }
      .poppy-drifter {
        animation: none;
        display: none;
      }
    }
  `}</style>
)

/**
 * The whole still life, drawn on a wide canvas and `slice`d into the hero so
 * the blooms bleed off the edges on every screen size, the way the reference
 * is cropped. Palette and motion both come from the page seed.
 */
const PoppyBed = ({ palette, seed }: { palette: Palette; seed: number }) => {
  const rand = makeRandom(seed)

  const blooms = BLOOMS.map((bloom, i) => {
    const sway = (0.7 + rand() * 1.6) * (rand() > 0.5 ? 1 : -1)

    return {
      ...bloom,
      motion: {
        dur: 8 + rand() * 9,
        delay: -rand() * 14,
        sway,
        // Unfold left to right with a little jitter, like a breeze passing.
        open: (bloom.x / 1600) * 0.9 + rand() * 0.25 + i * 0.02,
      } as Motion,
    }
  })

  // A few loose petals drifting across the bed.
  const drifters = [0, 1, 2, 3].map((i) => ({
    y: 70 + rand() * 260,
    size: 0.55 + rand() * 0.4,
    dur: 26 + rand() * 18,
    delay: -(rand() * 40) - i * 9,
    spin: (rand() > 0.5 ? 1 : -1) * (160 + rand() * 200),
    rise: -(30 + rand() * 60),
  }))

  const stemTempo = 14 + rand() * 10
  const bedTempo = 20 + rand() * 10
  const glowTempo = 11 + rand() * 8

  return (
    <>
      <PoppyMotionStyles />
      <svg
        viewBox="0 0 1600 420"
        preserveAspectRatio="xMidYMid slice"
        className="block h-full w-full"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <defs>
          <linearGradient id={`poppy-paper-${palette.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.paper[0]} />
            <stop offset="55%" stopColor={palette.paper[1]} />
            <stop offset="100%" stopColor={palette.paper[2]} />
          </linearGradient>

          {/* Petal wash: deep where the petal meets the centre, lighter at the tip. */}
          <radialGradient id={`poppy-wash-${palette.key}`} cx="0.5" cy="0.98" r="0.98">
            <stop offset="0%" stopColor={palette.wash[0]} stopOpacity="0.85" />
            <stop offset="45%" stopColor={palette.wash[1]} stopOpacity="0.72" />
            <stop offset="100%" stopColor={palette.wash[2]} stopOpacity="0.52" />
          </radialGradient>
          <radialGradient
            id={`poppy-wash-soft-${palette.key}`}
            cx="0.5"
            cy="0.98"
            r="0.98"
          >
            <stop offset="0%" stopColor={palette.soft[0]} stopOpacity="0.5" />
            <stop offset="55%" stopColor={palette.soft[1]} stopOpacity="0.4" />
            <stop offset="100%" stopColor={palette.soft[2]} stopOpacity="0.3" />
          </radialGradient>
          <radialGradient id={`poppy-heart-${palette.key}`} cx="0.5" cy="0.85" r="0.6">
            <stop offset="0%" stopColor={palette.inkDeep} stopOpacity="0.42" />
            <stop offset="55%" stopColor={palette.inkDeep} stopOpacity="0.12" />
            <stop offset="100%" stopColor={palette.inkDeep} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`poppy-pool-${palette.key}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={palette.pool} stopOpacity="0.32" />
            <stop offset="100%" stopColor={palette.pool} stopOpacity="0" />
          </radialGradient>
        </defs>

        <g
          className="poppy-bed"
          style={{ animationDuration: `${bedTempo}s` } as CSSProperties}
        >
          <rect
            width="1600"
            height="420"
            fill={`url(#poppy-paper-${palette.key})`}
          />

          {/* A slow bloom of colour washing over the whole bed. */}
          <rect
            width="1600"
            height="420"
            fill={palette.wash[1]}
            className="poppy-glow"
            style={{ animationDuration: `${glowTempo}s` } as CSSProperties}
          />

          {/* Stems first, so every head sits in front of its own stalk. */}
          <g
            className="poppy-stems"
            style={{ animationDuration: `${stemTempo}s` } as CSSProperties}
          >
            {STEMS.map((stem, i) => (
              <Stem key={i} d={stem.d} width={stem.width} c={palette} />
            ))}
          </g>

          <Leaf x={355} y={424} angle={-22} length={176} width={34} c={palette} />
          <Leaf x={1000} y={424} angle={14} length={152} width={30} c={palette} />
          <Leaf x={860} y={372} angle={-44} length={132} width={24} c={palette} />
          <Leaf x={1330} y={424} angle={22} length={126} width={26} c={palette} />

          <Bud x={250} y={362} angle={-5} c={palette} />
          <Bud x={1230} y={320} angle={14} scale={0.78} c={palette} />
          <Bud x={975} y={400} angle={-32} scale={0.62} c={palette} />

          {blooms.map((bloom) => (
            <Bloom
              key={bloom.id}
              id={bloom.id}
              x={bloom.x}
              y={bloom.y}
              tilt={bloom.tilt}
              petals={rosette(
                bloom.count,
                bloom.length,
                bloom.width,
                bloom.seed
              )}
              c={palette}
              motion={bloom.motion}
            />
          ))}

          {drifters.map((petal, i) => (
            <g key={`drift-${i}`} transform={`translate(0 ${petal.y.toFixed(1)})`}>
              <g
                className="poppy-drifter"
                style={
                  {
                    "--drift-dur": `${petal.dur.toFixed(1)}s`,
                    "--drift-delay": `${petal.delay.toFixed(1)}s`,
                    "--drift-spin": `${petal.spin.toFixed(0)}deg`,
                    "--drift-rise": `${petal.rise.toFixed(0)}px`,
                  } as CSSProperties
                }
              >
                <path
                  transform={`scale(${petal.size.toFixed(2)})`}
                  d="M 0 0 C -16 -6 -22 -26 -10 -38 C -4 -44 4 -44 10 -38 C 22 -26 16 -6 0 0 Z"
                  fill={`url(#poppy-wash-${palette.key})`}
                  stroke={palette.ink}
                  strokeOpacity={0.5}
                  strokeWidth={0.9}
                />
              </g>
            </g>
          ))}
        </g>
      </svg>
    </>
  )
}

/**
 * A running stitch in six dyes as a short strip, used under the page hero
 * title so the page carries the natural-dye palette above the painting.
 */
export const StitchUnderline = ({
  className = "",
  dyes = DYES,
}: {
  className?: string
  dyes?: string[]
}) => (
  <svg
    aria-hidden
    viewBox="0 0 300 16"
    preserveAspectRatio="none"
    className={`block h-3 w-full ${className}`}
    fill="none"
    strokeLinecap="round"
  >
    {dyes.map((dye, i) => (
      <g key={`${dye}-${i}`}>
        <path
          d={`M ${i * 50 + 3} 8 Q ${i * 50 + 25} 3 ${(i + 1) * 50 - 3} 8`}
          stroke={dye}
          strokeWidth="2.2"
          strokeOpacity="0.8"
          strokeDasharray="6 5"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M ${i * 50 + 6} 11 Q ${i * 50 + 25} 6 ${(i + 1) * 50 - 6} 11`}
          stroke={dye}
          strokeWidth="1"
          strokeOpacity="0.3"
          strokeDasharray="4 6"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    ))}
  </svg>
)

/**
 * The page hero, painted rather than laid out: the poppy bed is the ground,
 * and the title sits on top of it. There is no frame at all — no rounding,
 * no border, no shadow, no side gutter — so the painting runs edge to edge
 * and simply stops where the page body begins. No frosting either; the paint
 * stays crisp, and a soft radial veil thickens only where the type sits.
 *
 * Pass the page slug as `seed`: every page gets its own dyes, its own sway
 * tempos and its own stitch order, but stays identical on every reload.
 */
export type PageHeroProps = {
  title?: string
  subtitle?: string
  align?: "left" | "center"
  /** Stable per-page seed — use the slug. */
  seed?: string
}

export const PageHero = ({
  title,
  subtitle,
  align = "center",
  seed,
}: PageHeroProps) => {
  const isLeft = align === "left"

  const hash = hashSeed(seed || title || "cicilabel")
  const palette = PALETTES[hash % PALETTES.length]

  // Rotate the stitch colours so the rule under the title changes too.
  const dyeOffset = hash % DYES.length
  const dyes = [...DYES.slice(dyeOffset), ...DYES.slice(0, dyeOffset)]

  const heroTitleStyle: CSSProperties = {
    color: palette.title,
    textShadow: `1px 1px 0 rgba(255,255,255,0.55), 2px 2px 0 ${palette.inkDeep}33`,
  }

  return (
    <section className="relative left-1/2 right-1/2 -mx-[50vw] mb-8 w-screen md:mb-12">
      <div className="relative flex min-h-[460px] w-full flex-col overflow-hidden small:min-h-[600px]">
        {/* Feathered top and bottom so the painting melts into the page
            instead of stopping on a hard line. */}
        <div
          aria-hidden
          className="absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent_0%,#000_9%,#000_80%,transparent_100%)]"
        >
          <PoppyBed palette={palette} seed={hash} />
        </div>

        {/* Paper veil, not frosting: densest behind the type so the words
            hold, clearing toward the crop so the blooms stay saturated. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,253,246,0.88)_0%,rgba(255,253,246,0.55)_48%,rgba(255,253,246,0.08)_80%)] small:bg-[radial-gradient(ellipse_at_center,rgba(255,253,246,0.8)_0%,rgba(255,253,246,0.44)_45%,rgba(255,253,246,0.06)_78%)]"
        />

        {/* Top sheen, the way glass catches a window. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent"
        />
        <div
          className={`relative flex flex-1 flex-col justify-center px-6 py-14 md:px-14 md:py-20 ${
            isLeft ? "items-start text-left" : "items-center text-center"
          }`}
        >
          {title && (
            <h1
              className="mb-3 font-serif text-4xl leading-[1.05] tracking-tight md:text-6xl"
              style={heroTitleStyle}
            >
              {title}
            </h1>
          )}

          {title && (
            <div className={`mb-4 w-36 md:w-48 ${isLeft ? "" : "mx-auto"}`}>
              <StitchUnderline dyes={dyes} />
            </div>
          )}

          {subtitle && (
            <p
              className={`text-[15px] leading-relaxed md:text-base ${
                isLeft ? "max-w-md" : "mx-auto max-w-lg"
              }`}
              style={{ color: palette.subtitle }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

export default PageHero
