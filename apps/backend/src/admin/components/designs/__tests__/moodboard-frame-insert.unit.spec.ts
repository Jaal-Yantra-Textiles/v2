import {
  planRedesignInsertion,
  fitInCell,
  frameDimensions,
  REDESIGN_FRAME_NAME,
  REDESIGN_FRAME_LAYOUT,
  SceneElementLike,
} from "../moodboard-frame-insert"

const { cell, pad, gap, cols } = REDESIGN_FRAME_LAYOUT
const idGen = () => "frame-fixed-id"

describe("#892 redesign auto-insert — layout planner", () => {
  describe("fitInCell", () => {
    it("scales a large image down to fit the cell", () => {
      expect(fitInCell(800, 400, 400)).toEqual({ width: 400, height: 200 })
    })
    it("never scales up a small image", () => {
      expect(fitInCell(100, 50, 400)).toEqual({ width: 100, height: 50 })
    })
    it("falls back to a square when a dimension is zero", () => {
      expect(fitInCell(0, 0, 400)).toEqual({ width: 400, height: 400 })
    })
  })

  describe("frameDimensions", () => {
    it("is one row for the first two renders", () => {
      const one = frameDimensions(1)
      const two = frameDimensions(2)
      expect(one).toEqual(two)
      expect(two.width).toBe(pad * 2 + cols * cell + (cols - 1) * gap)
      expect(two.height).toBe(pad * 2 + cell)
    })
    it("grows a row every `cols` renders", () => {
      expect(frameDimensions(3).height).toBe(pad * 2 + 2 * cell + gap)
      expect(frameDimensions(5).height).toBe(pad * 2 + 3 * cell + 2 * gap)
    })
  })

  describe("planRedesignInsertion", () => {
    it("creates a new frame to the right of existing content", () => {
      const elements: SceneElementLike[] = [
        { id: "a", type: "frame", x: 0, y: 0, width: 1200, height: 900 },
        { id: "b", type: "image", x: 100, y: 100, width: 200, height: 200, frameId: "a" },
      ]
      const plan = planRedesignInsertion(elements, { width: 400, height: 400 }, idGen)
      expect(plan.isNewFrame).toBe(true)
      expect(plan.frameId).toBe("frame-fixed-id")
      expect(plan.frame.name).toBe(REDESIGN_FRAME_NAME)
      // right of the widest element (frame a ends at 1200) + frameGap
      expect(plan.frame.x).toBe(1200 + REDESIGN_FRAME_LAYOUT.frameGap)
      expect(plan.frame.y).toBe(0)
      // first render sits in cell 0 (centred; 400 exactly fills the 400 cell)
      expect(plan.image.x).toBe(plan.frame.x + pad)
      expect(plan.image.y).toBe(0 + pad)
    })

    it("starts a frame at the origin on an empty canvas", () => {
      const plan = planRedesignInsertion([], { width: 200, height: 200 }, idGen)
      expect(plan.isNewFrame).toBe(true)
      expect(plan.frame.x).toBe(0)
      expect(plan.frame.y).toBe(0)
    })

    it("reuses an existing redesign frame and appends to the next cell", () => {
      const elements: SceneElementLike[] = [
        { id: "rf", type: "frame", x: 500, y: 0, width: 928, height: 496, name: REDESIGN_FRAME_NAME },
        { id: "img1", type: "image", x: 548, y: 48, width: 400, height: 400, frameId: "rf" },
      ]
      const plan = planRedesignInsertion(elements, { width: 400, height: 400 }, idGen)
      expect(plan.isNewFrame).toBe(false)
      expect(plan.frameId).toBe("rf")
      // one child already present → next render goes in column 1, row 0
      expect(plan.image.x).toBe(500 + pad + (cell + gap))
      expect(plan.image.y).toBe(0 + pad)
    })

    it("wraps to a second row and grows the frame after `cols` children", () => {
      const children: SceneElementLike[] = Array.from({ length: cols }, (_, i) => ({
        id: `img${i}`,
        type: "image",
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        frameId: "rf",
      }))
      const elements: SceneElementLike[] = [
        { id: "rf", type: "frame", x: 500, y: 0, width: 928, height: 496, name: REDESIGN_FRAME_NAME },
        ...children,
      ]
      const plan = planRedesignInsertion(elements, { width: 400, height: 400 }, idGen)
      // the (cols)-th render (0-indexed) starts row 1
      expect(plan.image.y).toBe(0 + pad + (cell + gap))
      expect(plan.frame.height).toBe(frameDimensions(cols + 1).height)
    })

    it("ignores deleted elements when placing", () => {
      const elements: SceneElementLike[] = [
        { id: "rf", type: "frame", x: 0, y: 0, width: 928, height: 496, name: REDESIGN_FRAME_NAME },
        { id: "old", type: "image", x: 0, y: 0, width: 10, height: 10, frameId: "rf", isDeleted: true },
      ]
      const plan = planRedesignInsertion(elements, { width: 400, height: 400 }, idGen)
      // the deleted child doesn't count → still the first cell
      expect(plan.image.x).toBe(0 + pad)
      expect(plan.image.y).toBe(0 + pad)
    })
  })
})
