/**
 * Shared bits for the footer's cloth and threads. Both are drawn at this real
 * pixel size and cropped from the centre by the footer (overflow-hidden):
 * wide enough for any desktop, tall enough for a phone's stacked footer.
 */
export const FOOTER_ART_W = 1600
export const FOOTER_ART_H = 1900

/** One decimal place — keeps the SVG small and the server/browser output equal. */
export const f = (n: number) => Math.round(n * 10) / 10

/** Small deterministic PRNG (mulberry32): the same numbers on every render. */
export const rng = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
