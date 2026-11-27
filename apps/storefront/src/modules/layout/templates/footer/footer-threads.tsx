/**
 * Loose sewing threads in natural-dye colours, drifting over the footer's
 * woven cloth — the same doubled strand as the thread in "The making".
 * Rough on purpose: every bend a different length and height, a few loose
 * loops. Generated from a fixed seed (identical server/browser/every visit)
 * at real pixel size, cropped from the centre like the weave.
 */
import { FOOTER_ART_H, FOOTER_ART_W, f, rng } from "./footer-art"

const W = FOOTER_ART_W

type ThreadSpec = { color: string; y: number; loops: number }

// Madder, indigo, turmeric, leaf, walnut, rose. The first six sit within a
// desktop footer's height; the rest only show in a phone's taller one.
const THREADS: ThreadSpec[] = [
  { color: "#b8322a", y: 118, loops: 1 },
  { color: "#2f4a7a", y: 226, loops: 0 },
  { color: "#d39a2f", y: 344, loops: 1 },
  { color: "#5f7a4a", y: 476, loops: 0 },
  { color: "#7a5236", y: 592, loops: 1 },
  { color: "#c97b84", y: 708, loops: 0 },
  { color: "#2f4a7a", y: 930, loops: 1 },
  { color: "#d39a2f", y: 1110, loops: 0 },
  { color: "#b8322a", y: 1290, loops: 1 },
  { color: "#5f7a4a", y: 1470, loops: 0 },
]

const rand = rng(1752)
const between = (a: number, b: number) => a + rand() * (b - a)

/** The rough route one thread takes: uneven bends, and where it loops. */
type Bend = { len: number; amp: number; loop: number }
const route = (t: ThreadSpec): Bend[] => {
  const bends: Bend[] = []
  let x = -between(40, 160)
  const loopsAt = new Set<number>()
  while (loopsAt.size < t.loops) loopsAt.add(Math.floor(between(1, 6)))
  for (let i = 0; x < W + 200; i++) {
    const len = between(120, 320)
    bends.push({
      len,
      amp: between(5, 19) * (i % 2 ? 1 : -1),
      loop: loopsAt.has(i) ? between(18, 34) : 0,
    })
    x += len
  }
  return bends
}

/** Walk a route; the twin strand walks it slightly offset and flatter. */
const strand = (t: ThreadSpec, start: number, bends: Bend[], dx: number, dy: number, k: number) => {
  let x = start + dx
  const y = t.y + dy
  let d = `M ${f(x)} ${f(y)}`
  for (const b of bends) {
    const end = x + b.len
    d += ` Q ${f((x + end) / 2)} ${f(y + b.amp * k)} ${f(end)} ${f(y)}`
    x = end
    if (b.loop) {
      const r = b.loop
      d +=
        ` C ${f(x + r)} ${f(y - r * 0.2)} ${f(x + r * 0.9)} ${f(y - r * 1.5)} ${f(x + r * 0.1)} ${f(y - r * 1.3)}` +
        ` C ${f(x - r * 0.7)} ${f(y - r * 1.1)} ${f(x - r * 0.4)} ${f(y + r * 0.1)} ${f(x + r * 0.6)} ${f(y)}`
      x += r * 0.6
    }
  }
  return d
}

const PATHS = THREADS.map((t, i) => {
  const start = -between(40, 160)
  const bends = route(t)
  return {
    key: `${t.color}-${i}`,
    color: t.color,
    strand: strand(t, start, bends, 0, 0, 1),
    twin: strand(t, start, bends, 1.6, 2.4, 0.82),
  }
})

const FooterThreads = () => (
  <svg
    aria-hidden
    width={W}
    height={FOOTER_ART_H}
    viewBox={`0 0 ${W} ${FOOTER_ART_H}`}
    className="pointer-events-none absolute left-1/2 top-0 z-0 max-w-none -translate-x-1/2"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {PATHS.map((p) => (
      <g key={p.key} stroke={p.color}>
        <path d={p.strand} strokeWidth="1.3" strokeOpacity="0.32" />
        <path d={p.twin} strokeWidth="0.9" strokeOpacity="0.16" />
      </g>
    ))}
  </svg>
)

export default FooterThreads
