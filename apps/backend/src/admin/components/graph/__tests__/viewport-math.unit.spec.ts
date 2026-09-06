import {
  MAX_SCALE,
  MIN_SCALE,
  centreOffset,
  clampScale,
  fitScale,
  isPan,
  stepScale,
  zoomAbout,
} from "../viewport-math"

describe("fitScale", () => {
  it("shrinks a graph wider than its viewport", () => {
    expect(fitScale({ width: 2000, height: 400 }, { width: 1064, height: 800 })).toBeCloseTo(
      1000 / 2000
    )
  })

  it("never enlarges one that already fits", () => {
    /*
     * 🔴 Fit means "show me all of it", not "fill the space". Uncapped this
     * returns 2.5 and renders a six-node graph at 440px per box with the same
     * 10px edge labels.
     */
    expect(fitScale({ width: 400, height: 200 }, { width: 1200, height: 900 })).toBe(1)
  })

  it("returns 1 for a viewport that has not been measured yet", () => {
    // A first render has zero height. 0 and Infinity both paint an empty
    // canvas, which is indistinguishable from a graph with no nodes.
    expect(fitScale({ width: 800, height: 400 }, { width: 0, height: 0 })).toBe(1)
    expect(fitScale({ width: 0, height: 0 }, { width: 800, height: 400 })).toBe(1)
  })

  it("stays inside the scale bounds for an enormous graph", () => {
    expect(
      fitScale({ width: 100000, height: 100000 }, { width: 800, height: 600 })
    ).toBe(MIN_SCALE)
  })

  it("fits the constraining dimension, not the generous one", () => {
    /*
     * Short and very wide: width binds even though height has room to spare.
     * The ratio is kept above MIN_SCALE on purpose — at 4000 wide the floor
     * clamps the result and the assertion would pass for the wrong reason,
     * proving only that the clamp works (which the case above already does).
     */
    const s = fitScale({ width: 2500, height: 100 }, { width: 1064, height: 900 })
    expect(s).toBeCloseTo(1000 / 2500)
  })
})

describe("zoomAbout", () => {
  it("keeps the point under the cursor fixed", () => {
    const before = { scale: 1, x: 0, y: 0 }
    const cursor = { x: 300, y: 200 }
    const after = zoomAbout(cursor, before, 2)

    // The content coordinate under the cursor must be the same before & after.
    const contentBefore = {
      x: (cursor.x - before.x) / before.scale,
      y: (cursor.y - before.y) / before.scale,
    }
    const contentAfter = {
      x: (cursor.x - after.x) / after.scale,
      y: (cursor.y - after.y) / after.scale,
    }
    expect(contentAfter.x).toBeCloseTo(contentBefore.x)
    expect(contentAfter.y).toBeCloseTo(contentBefore.y)
  })

  it("holds the anchor across a zoom out from a panned position", () => {
    // The offset term is easiest to drop when it is already non-zero, so the
    // case that would still pass with `x` ignored is the one worth asserting.
    const before = { scale: 1.6, x: -240, y: 90 }
    const cursor = { x: 512, y: 300 }
    const after = zoomAbout(cursor, before, 0.8)
    expect((cursor.x - after.x) / after.scale).toBeCloseTo(
      (cursor.x - before.x) / before.scale
    )
    expect((cursor.y - after.y) / after.scale).toBeCloseTo(
      (cursor.y - before.y) / before.scale
    )
  })

  it("does not nudge the offset when already at the limit", () => {
    const at = { scale: MAX_SCALE, x: 40, y: 12 }
    // A wheel held down at the ceiling would otherwise walk the canvas away
    // a pixel per event while the scale never changes.
    expect(zoomAbout({ x: 100, y: 100 }, at, MAX_SCALE * 2)).toEqual(at)
  })
})

describe("clampScale and stepScale", () => {
  it("bounds both ends", () => {
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(0.001)).toBe(MIN_SCALE)
  })

  it("steps in and out symmetrically", () => {
    const start = 1
    expect(stepScale(stepScale(start, 1), -1)).toBeCloseTo(start)
  })
})

describe("centreOffset", () => {
  it("centres content smaller than the viewport", () => {
    expect(centreOffset({ width: 400, height: 200 }, { width: 1000, height: 600 }, 1)).toEqual(
      { x: 300, y: 200 }
    )
  })

  it("accounts for the scale, not just the raw size", () => {
    expect(
      centreOffset({ width: 400, height: 200 }, { width: 1000, height: 600 }, 0.5)
    ).toEqual({ x: 400, y: 250 })
  })
})

describe("isPan", () => {
  it("treats a steady click as a click", () => {
    // 🔴 Otherwise every pan that begins over a node opens that node's drawer
    // on release, mid-drag.
    expect(isPan({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(false)
  })

  it("treats a real drag as a pan", () => {
    expect(isPan({ x: 100, y: 100 }, { x: 140, y: 100 })).toBe(true)
  })

  it("measures the diagonal, not either axis alone", () => {
    // 4px on each axis is 5.6px of travel — a pan. An axis-wise check would
    // call this a click.
    expect(isPan({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(true)
  })
})
