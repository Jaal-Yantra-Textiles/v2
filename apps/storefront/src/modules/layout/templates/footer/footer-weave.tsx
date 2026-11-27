/**
 * A loose, rough hand-woven cloth behind the footer: an open grid of wavy,
 * uneven warp and weft — the warp in bands of natural-dye colour (a handloom
 * check) — with missing ends, doubled yarns, slow bowing, and frayed fringe
 * at the top and bottom edges.
 *
 * Generated from a fixed seed, so it is identical on the server, in the
 * browser and on every visit. Drawn at real pixel size (FOOTER_ART_W ×
 * FOOTER_ART_H) and cropped from the centre — a phone sees the same fine
 * cloth, not a magnified one. Very faint: texture under the links.
 */
import { FOOTER_ART_H, FOOTER_ART_W, f, rng } from "./footer-art"

const W = FOOTER_ART_W
const H = FOOTER_ART_H
/** Woven body; outside it the warp hangs loose as fringe. */
const WOVEN_TOP = 70
const WOVEN_BOTTOM = H - 60

// Madder, indigo, turmeric, leaf, walnut, rose — each a band of warp ends.
const DYES = ["#b8322a", "#2f4a7a", "#d39a2f", "#5f7a4a", "#7a5236", "#c97b84"]

const rand = rng(2659)
const between = (a: number, b: number) => a + rand() * (b - a)

/**
 * A yarn that wanders: small wobble at every bend, plus a slow bow over the
 * whole run (uneven tension), with bends at uneven intervals.
 */
const yarn = (from: number, to: number, at: number, vertical: boolean, wobble: number) => {
  const pt = (along: number, across: number) =>
    vertical ? `${f(across)} ${f(along)}` : `${f(along)} ${f(across)}`
  const bow = between(-7, 7)
  const bowAt = (a: number) => bow * Math.sin(((a - from) / (to - from)) * Math.PI)
  let a = from
  let d = `M ${pt(a, at + between(-wobble, wobble))}`
  while (a < to) {
    const step = between(40, 110)
    const end = Math.min(a + step, to)
    const mid = (a + end) / 2
    d += ` Q ${pt(mid, at + bowAt(mid) + between(-wobble, wobble) * 1.8)} ${pt(end, at + bowAt(end) + between(-wobble, wobble))}`
    a = end
  }
  return d
}

/** A loose end: hangs off the cloth, curling a little sideways. */
const fringe = (x: number, edge: number, dir: 1 | -1) => {
  const len = between(14, 70)
  const drift = between(-22, 22)
  const tip = edge - dir * len
  return `M ${f(x)} ${f(edge)} Q ${f(x + drift * 0.3)} ${f((edge + tip) / 2)} ${f(x + drift)} ${f(tip)}`
}

type Line = { d: string; color: string; opacity: number; width: number }
const LINES: Line[] = []

// Warp: vertical, uneven spacing, dye bands of uneven width.
let band = 0
let bandLeft = Math.round(between(5, 9))
for (let x = between(4, 10); x < W; x += between(9, 18)) {
  if (bandLeft-- <= 0) {
    band = (band + 1) % DYES.length
    bandLeft = Math.round(between(5, 9))
  }
  // The odd broken end: an open patch in the cloth.
  if (rand() < 0.05) continue
  const color = DYES[band]
  const opacity = between(0.07, 0.15)
  const width = between(0.6, 1.5)
  LINES.push({ d: yarn(WOVEN_TOP, WOVEN_BOTTOM, x, true, 3.2), color, opacity, width })
  LINES.push({ d: fringe(x, WOVEN_TOP, 1), color, opacity, width })
  LINES.push({ d: fringe(x, WOVEN_BOTTOM, -1), color, opacity, width })
  // Now and then a doubled yarn lies alongside.
  if (rand() < 0.12) {
    LINES.push({ d: yarn(WOVEN_TOP, WOVEN_BOTTOM, x + between(1.6, 3), true, 3.2), color, opacity: opacity * 0.6, width: width * 0.8 })
  }
}

// Weft: horizontal, ink-dark, uneven picks; some skipped, some doubled.
for (let y = WOVEN_TOP + between(4, 8); y < WOVEN_BOTTOM; y += between(9, 18)) {
  if (rand() < 0.07) continue
  const opacity = between(0.035, 0.085)
  const width = between(0.6, 1.4)
  LINES.push({ d: yarn(-20, W + 20, y, false, 3.4), color: "#1c1917", opacity, width })
  if (rand() < 0.1) {
    LINES.push({ d: yarn(-20, W + 20, y + between(1.6, 3), false, 3.4), color: "#1c1917", opacity: opacity * 0.6, width: width * 0.8 })
  }
}

const FooterWeave = () => (
  <svg
    aria-hidden
    width={W}
    height={H}
    viewBox={`0 0 ${W} ${H}`}
    className="pointer-events-none absolute left-1/2 top-0 z-0 max-w-none -translate-x-1/2"
    fill="none"
    strokeLinecap="round"
  >
    {LINES.map((l, i) => (
      <path
        key={i}
        d={l.d}
        stroke={l.color}
        strokeOpacity={f(l.opacity * 1000) / 1000}
        strokeWidth={f(l.width)}
      />
    ))}
  </svg>
)

export default FooterWeave
