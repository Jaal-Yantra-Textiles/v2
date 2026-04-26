/**
 * Unit tests for the Konva ↔ Excalidraw conversion utilities.
 *
 * Run with: pnpm test
 * (uses vitest, no external deps required)
 *
 * Covers:
 *  - convertToExcalidraw: Konva layers → Excalidraw JSON (for moodboard storage)
 *  - excalidrawToKonvaLayers: Excalidraw JSON → Konva layers (for editor restore)
 *  - Round-trip awareness (offset is expected, documented here)
 *  - All layer types: text, image (http), image (blob placeholder), rect, circle
 *  - Utility element filtering in excalidrawToKonvaLayers
 */

import { describe, it, expect } from "vitest"
import { convertToExcalidraw } from "../excalidraw-converter"
import { excalidrawToKonvaLayers } from "../excalidraw-to-konva"
import type { DesignLayer } from "../../types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLayer(overrides: Partial<DesignLayer>): DesignLayer {
  return {
    id: "layer1",
    type: "text",
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    draggable: true,
    ...overrides,
  }
}

// convertToExcalidraw uses Math.random() for seeds — we don't care about those values
// so we only assert on the fields we control.

// ---------------------------------------------------------------------------
// convertToExcalidraw
// ---------------------------------------------------------------------------

describe("convertToExcalidraw", () => {
  // The encoder adds utility chrome (title, canvas frame, notes area) plus the
  // actual design layers. The offset applied to layer x/y is:
  //   offsetX = 20
  //   offsetY = canvasStartY
  // where canvasStartY = 70 + 28*materialPresent + 28*partnerPresent + 20
  // With no optional args → canvasStartY = 90 (infoY=70, then +20).
  const OFFSET_X = 20
  const OFFSET_Y = 90 // no product name, no material, no partner

  describe("text layer", () => {
    it("emits a text element with correct position, angle, and color", () => {
      const layer = makeLayer({
        id: "t1",
        type: "text",
        x: 100,
        y: 50,
        text: "Hello",
        fontSize: 24,
        fill: "#FF0000",
        rotation: 45,
        opacity: 0.8,
      })

      const result = convertToExcalidraw([layer])
      const el = result.elements.find((e) => e.id.startsWith("layer-t1"))

      expect(el).toBeDefined()
      expect(el!.type).toBe("text")
      expect(el!.x).toBe(OFFSET_X + 100)
      expect(el!.y).toBe(OFFSET_Y + 50)
      expect(el!.text).toBe("Hello")
      expect(el!.fontSize).toBe(24)
      expect(el!.strokeColor).toBe("#FF0000") // fill → strokeColor
      expect(el!.opacity).toBeCloseTo(80)     // 0.8 × 100
      // angle: degrees → radians
      expect(el!.angle).toBeCloseTo((45 * Math.PI) / 180)
      expect(el!.isDeleted).toBe(false)
    })
  })

  describe("image layer — persistent http URL", () => {
    it("emits an image element and stores the URL in files", () => {
      const layer = makeLayer({
        id: "img1",
        type: "image",
        x: 10,
        y: 20,
        width: 200,
        height: 150,
        src: "https://cdn.example.com/photo.jpg",
        rotation: 0,
        opacity: 1,
      })

      const result = convertToExcalidraw([layer])
      const el = result.elements.find((e) => e.id.startsWith("layer-img1"))

      expect(el).toBeDefined()
      expect(el!.type).toBe("image")
      expect(el!.fileId).toBe("file-img1")
      expect(el!.link).toBe("https://cdn.example.com/photo.jpg")
      expect(result.files["file-img1"].dataURL).toBe("https://cdn.example.com/photo.jpg")
      expect(el!.x).toBe(OFFSET_X + 10)
      expect(el!.y).toBe(OFFSET_Y + 20)
      expect(el!.width).toBe(200) // scaleX = 1
      expect(el!.height).toBe(150)
    })
  })

  describe("image layer — blob / missing URL", () => {
    it("emits a placeholder rectangle and a label text", () => {
      const layer = makeLayer({
        id: "blob1",
        type: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        src: "blob:http://localhost/abc",
        rotation: 0,
        opacity: 1,
      })

      const result = convertToExcalidraw([layer])
      const placeholder = result.elements.find((e) =>
        e.id.startsWith("layer-blob1") && e.type === "rectangle"
      )
      const label = result.elements.find((e) =>
        e.id.startsWith("layer-blob1") && e.id.endsWith("-label") && e.type === "text"
      )

      expect(placeholder).toBeDefined()
      expect(placeholder!.type).toBe("rectangle")
      expect(label).toBeDefined()
      expect(label!.text).toContain("not yet uploaded")
      // No files entry for blob images
      expect(result.files["file-blob1"]).toBeUndefined()
    })
  })

  describe("rect layer", () => {
    it("emits a rectangle element with fill and stroke", () => {
      const layer = makeLayer({
        id: "r1",
        type: "rect",
        x: 50,
        y: 60,
        width: 120,
        height: 80,
        fill: "#AABBCC",
        strokeColor: "#112233",
        strokeWidth: 2,
        rotation: 0,
        opacity: 1,
      })

      const result = convertToExcalidraw([layer])
      const el = result.elements.find((e) => e.id.startsWith("layer-r1"))

      expect(el).toBeDefined()
      expect(el!.type).toBe("rectangle")
      expect(el!.backgroundColor).toBe("#AABBCC")
      expect(el!.strokeColor).toBe("#112233")
      expect(el!.strokeWidth).toBe(2)
      expect(el!.x).toBe(OFFSET_X + 50)
      expect(el!.y).toBe(OFFSET_Y + 60)
      expect(el!.width).toBe(120)
      expect(el!.height).toBe(80)
    })

    it("uses defaults when fill/strokeColor are absent", () => {
      const layer = makeLayer({ id: "r2", type: "rect", opacity: 1 })

      const result = convertToExcalidraw([layer])
      const el = result.elements.find((e) => e.id.startsWith("layer-r2"))

      expect(el!.backgroundColor).toBe("transparent")
      expect(el!.strokeColor).toBe("#000000")
    })
  })

  describe("circle layer", () => {
    it("emits an ellipse element", () => {
      const layer = makeLayer({
        id: "c1",
        type: "circle",
        x: 30,
        y: 40,
        width: 80,
        height: 80,
        fill: "#FFEECC",
        strokeColor: "#334455",
        rotation: 0,
        opacity: 0.5,
      })

      const result = convertToExcalidraw([layer])
      const el = result.elements.find((e) => e.id.startsWith("layer-c1"))

      expect(el).toBeDefined()
      expect(el!.type).toBe("ellipse")
      expect(el!.backgroundColor).toBe("#FFEECC")
      expect(el!.strokeColor).toBe("#334455")
      expect(el!.opacity).toBeCloseTo(50) // 0.5 × 100
    })
  })

  describe("scaleX / scaleY applied to dimensions", () => {
    it("multiplies width and height by scale", () => {
      const layer = makeLayer({
        id: "s1",
        type: "rect",
        width: 100,
        height: 50,
        scaleX: 2,
        scaleY: 3,
        opacity: 1,
      })

      const result = convertToExcalidraw([layer])
      const el = result.elements.find((e) => e.id.startsWith("layer-s1"))

      expect(el!.width).toBe(200)  // 100 × 2
      expect(el!.height).toBe(150) // 50 × 3
    })
  })

  describe("utility chrome elements", () => {
    it("includes canvas frame rectangle", () => {
      const result = convertToExcalidraw([])
      const frame = result.elements.find((e) => e.id.startsWith("canvas-frame-"))
      expect(frame).toBeDefined()
      expect(frame!.type).toBe("rectangle")
    })

    it("includes notes header text", () => {
      const result = convertToExcalidraw([])
      const notesHeader = result.elements.find((e) => e.id.startsWith("notes-header-"))
      expect(notesHeader).toBeDefined()
      expect(notesHeader!.text).toBe("Designer Notes:")
    })

    it("includes title text when productName is provided", () => {
      const result = convertToExcalidraw([], undefined, undefined, "Test Product")
      const title = result.elements.find((e) => e.id.startsWith("title-"))
      expect(title).toBeDefined()
      expect(title!.text).toBe("Design: Test Product")
    })

    it("does not include title when productName is absent", () => {
      const result = convertToExcalidraw([])
      const title = result.elements.find((e) => e.id.startsWith("title-"))
      expect(title).toBeUndefined()
    })

    it("increases canvasStartY when material and partner are provided", () => {
      const layer = makeLayer({ id: "pos1", type: "rect", x: 0, y: 0, opacity: 1 })

      // No args → offsetY = 90
      const noArgs = convertToExcalidraw([layer])
      const elNoArgs = noArgs.elements.find((e) => e.id.startsWith("layer-pos1"))!

      // With product + material + partner → canvasStartY = 70 + 28 + 28 + 20 = 146
      const withAll = convertToExcalidraw(
        [layer],
        undefined,
        undefined,
        "Product",
        "Silk",
        "Partner Co"
      )
      const elWithAll = withAll.elements.find((e) => e.id.startsWith("layer-pos1"))!

      expect(elWithAll.y).toBeGreaterThan(elNoArgs.y)
    })
  })
})

// ---------------------------------------------------------------------------
// excalidrawToKonvaLayers
// ---------------------------------------------------------------------------

describe("excalidrawToKonvaLayers", () => {
  const now = Date.now()

  function makeMoodboard(elements: any[], files: Record<string, any> = {}) {
    return { type: "excalidraw", version: 2, elements, files }
  }

  describe("image element", () => {
    it("converts image with fileId to Konva image layer using dataURL", () => {
      const el = {
        id: "img1",
        type: "image",
        x: 100,
        y: 200,
        width: 300,
        height: 200,
        angle: 0,
        opacity: 100,
        isDeleted: false,
        fileId: "f1",
      }
      const moodboard = makeMoodboard([el], {
        f1: { id: "f1", dataURL: "https://cdn.example.com/img.jpg", mimeType: "image/jpeg", created: now },
      })

      const layers = excalidrawToKonvaLayers(moodboard)

      expect(layers).toHaveLength(1)
      const layer = layers[0]
      expect(layer.type).toBe("image")
      expect(layer.src).toBe("https://cdn.example.com/img.jpg")
      expect(layer.x).toBe(100)
      expect(layer.y).toBe(200)
      expect(layer.width).toBe(300)
      expect(layer.height).toBe(200)
      expect(layer.opacity).toBe(1) // 100 / 100
      expect(layer.rotation).toBeCloseTo(0)
      expect(layer.draggable).toBe(true)
    })

    it("falls back to element.link when file entry is missing", () => {
      const el = {
        id: "img2",
        type: "image",
        x: 0, y: 0, width: 100, height: 100,
        angle: 0, opacity: 80, isDeleted: false,
        fileId: "missing-file",
        link: "https://fallback.example.com/img.jpg",
      }
      const moodboard = makeMoodboard([el], {}) // no files

      const layers = excalidrawToKonvaLayers(moodboard)

      expect(layers).toHaveLength(1)
      expect(layers[0].src).toBe("https://fallback.example.com/img.jpg")
    })

    it("skips image when both file and link are missing", () => {
      const el = {
        id: "img3",
        type: "image",
        x: 0, y: 0, width: 100, height: 100,
        angle: 0, opacity: 100, isDeleted: false,
        fileId: "no-file",
      }
      const layers = excalidrawToKonvaLayers(makeMoodboard([el]))
      expect(layers).toHaveLength(0)
    })

    it("skips deleted image elements", () => {
      const el = {
        id: "img4",
        type: "image",
        x: 0, y: 0, width: 100, height: 100,
        angle: 0, opacity: 100,
        isDeleted: true,
        fileId: "f2",
      }
      const moodboard = makeMoodboard([el], {
        f2: { id: "f2", dataURL: "https://example.com/x.jpg", mimeType: "image/jpeg", created: now },
      })
      expect(excalidrawToKonvaLayers(moodboard)).toHaveLength(0)
    })
  })

  describe("text element", () => {
    it("converts text to Konva text layer mapping strokeColor → fill", () => {
      const el = {
        id: "txt1",
        type: "text",
        x: 50, y: 75,
        width: 200, height: 30,
        angle: (30 * Math.PI) / 180, // 30° in radians
        strokeColor: "#CC0000",
        opacity: 60,
        isDeleted: false,
        text: "Hello World",
        fontSize: 18,
        fontFamily: 2, // Helvetica
      }
      const layers = excalidrawToKonvaLayers(makeMoodboard([el]))

      expect(layers).toHaveLength(1)
      const layer = layers[0]
      expect(layer.type).toBe("text")
      expect(layer.text).toBe("Hello World")
      expect(layer.fill).toBe("#CC0000")
      expect(layer.fontSize).toBe(18)
      expect(layer.fontFamily).toBe("Helvetica")
      expect(layer.opacity).toBeCloseTo(0.6)       // 60 / 100
      expect(layer.rotation).toBeCloseTo(30)        // radians → degrees
      expect(layer.x).toBe(50)
      expect(layer.y).toBe(75)
    })

    it("maps fontFamily 1 → Virgil, 3 → Cascadia", () => {
      const make = (fontFamily: number) => ({
        id: `f${fontFamily}`,
        type: "text",
        x: 0, y: 0, width: 100, height: 20,
        angle: 0, strokeColor: "#000", opacity: 100,
        isDeleted: false,
        text: "T",
        fontSize: 14,
        fontFamily,
      })

      const [virgil] = excalidrawToKonvaLayers(makeMoodboard([make(1)]))
      expect(virgil.fontFamily).toBe("Virgil")

      const [cascadia] = excalidrawToKonvaLayers(makeMoodboard([make(3)]))
      expect(cascadia.fontFamily).toBe("Cascadia")
    })

    it("defaults fontSize to 16 when absent", () => {
      const el = {
        id: "txt2",
        type: "text",
        x: 0, y: 0, width: 100, height: 20,
        angle: 0, strokeColor: "#000", opacity: 100,
        isDeleted: false,
        text: "Hi",
      }
      const [layer] = excalidrawToKonvaLayers(makeMoodboard([el]))
      expect(layer.fontSize).toBe(16)
    })

    it("uses #1e1e1e when strokeColor is absent", () => {
      const el = {
        id: "txt3",
        type: "text",
        x: 0, y: 0, width: 100, height: 20,
        angle: 0, opacity: 100, isDeleted: false,
        text: "Hi",
      }
      const [layer] = excalidrawToKonvaLayers(makeMoodboard([el]))
      expect(layer.fill).toBe("#1e1e1e")
    })

    it("skips text elements with no text content", () => {
      const el = {
        id: "txt4",
        type: "text",
        x: 0, y: 0, width: 100, height: 20,
        angle: 0, strokeColor: "#000", opacity: 100,
        isDeleted: false,
        text: "",
      }
      expect(excalidrawToKonvaLayers(makeMoodboard([el]))).toHaveLength(0)
    })
  })

  describe("rectangle element", () => {
    it("converts rectangle to Konva rect layer", () => {
      const el = {
        id: "rect1",
        type: "rectangle",
        x: 10, y: 20, width: 80, height: 40,
        angle: (90 * Math.PI) / 180,
        strokeColor: "#112233",
        backgroundColor: "#AABBCC",
        opacity: 50,
        isDeleted: false,
      }
      const layers = excalidrawToKonvaLayers(makeMoodboard([el]))

      expect(layers).toHaveLength(1)
      const layer = layers[0]
      expect(layer.type).toBe("rect")
      expect(layer.fill).toBe("#AABBCC")
      expect(layer.strokeColor).toBe("#112233")
      expect(layer.rotation).toBeCloseTo(90)
      expect(layer.opacity).toBeCloseTo(0.5)
    })

    it("defaults fill to 'transparent' and strokeColor to '#000000'", () => {
      const el = {
        id: "rect2",
        type: "rectangle",
        x: 0, y: 0, width: 50, height: 50,
        angle: 0, opacity: 100, isDeleted: false,
      }
      const [layer] = excalidrawToKonvaLayers(makeMoodboard([el]))
      expect(layer.fill).toBe("transparent")
      expect(layer.strokeColor).toBe("#000000")
    })
  })

  describe("ellipse element", () => {
    it("converts ellipse to Konva circle layer", () => {
      const el = {
        id: "ell1",
        type: "ellipse",
        x: 5, y: 10, width: 60, height: 60,
        angle: 0,
        strokeColor: "#FF0000",
        backgroundColor: "#00FF00",
        opacity: 100,
        isDeleted: false,
      }
      const layers = excalidrawToKonvaLayers(makeMoodboard([el]))

      expect(layers).toHaveLength(1)
      expect(layers[0].type).toBe("circle")
      expect(layers[0].fill).toBe("#00FF00")
    })
  })

  describe("unsupported element types", () => {
    it("skips freedraw, arrow, line, and frame elements", () => {
      const unsupported = ["freedraw", "arrow", "line", "frame"].map((type, i) => ({
        id: `skip${i}`,
        type,
        x: 0, y: 0, width: 10, height: 10,
        angle: 0, opacity: 100, isDeleted: false,
      }))
      expect(excalidrawToKonvaLayers(makeMoodboard(unsupported))).toHaveLength(0)
    })
  })

  describe("utility element filtering", () => {
    it("skips auto-generated chrome elements from convertToExcalidraw", () => {
      // These IDs are produced by the encoder — they should be filtered out
      const utilityEls = [
        "title-",
        "material-info-",
        "partner-info-",
        "canvas-frame-",
        "notes-header-",
        "notes-area-",
        "notes-placeholder-",
      ].map((prefix, i) => ({
        id: `${prefix}${Date.now() + i}`,
        type: "text",
        x: 0, y: 0, width: 100, height: 20,
        angle: 0, strokeColor: "#000", opacity: 100,
        isDeleted: false,
        text: "chrome element",
      }))

      expect(excalidrawToKonvaLayers(makeMoodboard(utilityEls))).toHaveLength(0)
    })

    it("keeps actual design layers that have 'layer-' prefix", () => {
      // The encoder produces IDs like `layer-<layerId>-<timestamp>`
      const designEl = {
        id: `layer-abc123-${Date.now()}`,
        type: "text",
        x: 10, y: 10, width: 100, height: 20,
        angle: 0, strokeColor: "#333", opacity: 100,
        isDeleted: false,
        text: "Design content",
      }
      const layers = excalidrawToKonvaLayers(makeMoodboard([designEl]))
      expect(layers).toHaveLength(1)
      expect(layers[0].text).toBe("Design content")
    })
  })

  describe("opacity edge cases", () => {
    it("defaults opacity to 1 when field is missing", () => {
      const el = {
        id: "op1",
        type: "text",
        x: 0, y: 0, width: 100, height: 20,
        angle: 0, strokeColor: "#000",
        isDeleted: false,
        text: "Hi",
        // no opacity field
      }
      const [layer] = excalidrawToKonvaLayers(makeMoodboard([el]))
      expect(layer.opacity).toBe(1)
    })
  })

  describe("empty / null moodboard", () => {
    it("returns [] for null input", () => {
      expect(excalidrawToKonvaLayers(null as any)).toEqual([])
    })

    it("returns [] for empty elements array", () => {
      expect(excalidrawToKonvaLayers(makeMoodboard([]))).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// Round-trip: Konva → Excalidraw → Konva
// ---------------------------------------------------------------------------

describe("round-trip (Konva → Excalidraw → Konva)", () => {
  // Important: this round-trip is NOT lossless for x/y because convertToExcalidraw
  // adds a canvas offset (offsetX=20, offsetY=canvasStartY≥90). The encoder
  // documents this and metadata.layers always takes priority in the editor, so
  // this path is only hit when admin-drawn Excalidraw elements need to be
  // shown on the canvas.
  //
  // What IS preserved: type, text content, fill/color, rotation, opacity, dimensions.

  it("preserves text content, color, font size and rotation", () => {
    const original = makeLayer({
      id: "rt-text",
      type: "text",
      x: 100, y: 50,
      text: "Round-trip test",
      fontSize: 20,
      fill: "#ABCDEF",
      rotation: 30,
      opacity: 0.7,
    })

    const moodboard = convertToExcalidraw([original])
    // Strip utility elements before converting back — they'd add noise
    const layers = excalidrawToKonvaLayers(moodboard)
    const restored = layers.find((l) => l.text === "Round-trip test")

    expect(restored).toBeDefined()
    expect(restored!.type).toBe("text")
    expect(restored!.fill).toBe("#ABCDEF")
    expect(restored!.fontSize).toBe(20)
    expect(restored!.rotation).toBeCloseTo(30, 0)
    expect(restored!.opacity).toBeCloseTo(0.7, 1)
  })

  it("preserves image src for http URLs", () => {
    const original = makeLayer({
      id: "rt-img",
      type: "image",
      x: 0, y: 0,
      width: 200, height: 150,
      src: "https://cdn.example.com/design.png",
      rotation: 0,
      opacity: 1,
    })

    const moodboard = convertToExcalidraw([original])
    const layers = excalidrawToKonvaLayers(moodboard)
    const restored = layers.find((l) => l.type === "image")

    expect(restored).toBeDefined()
    expect(restored!.src).toBe("https://cdn.example.com/design.png")
  })

  it("preserves rect fill, strokeColor, and dimensions", () => {
    const original = makeLayer({
      id: "rt-rect",
      type: "rect",
      x: 0, y: 0,
      width: 120, height: 80,
      fill: "#FFCC00",
      strokeColor: "#003366",
      rotation: 15,
      opacity: 0.9,
    })

    const moodboard = convertToExcalidraw([original])
    const layers = excalidrawToKonvaLayers(moodboard)
    // exclude utility chrome, find our rect
    const rects = layers.filter((l) => l.type === "rect" && l.fill === "#FFCC00")

    expect(rects).toHaveLength(1)
    expect(rects[0].strokeColor).toBe("#003366")
    expect(rects[0].width).toBe(120)
    expect(rects[0].height).toBe(80)
    expect(rects[0].rotation).toBeCloseTo(15, 0)
  })

  it("preserves circle/ellipse fill", () => {
    const original = makeLayer({
      id: "rt-circle",
      type: "circle",
      x: 0, y: 0,
      width: 80, height: 80,
      fill: "#FF00FF",
      strokeColor: "#000000",
      rotation: 0,
      opacity: 1,
    })

    const moodboard = convertToExcalidraw([original])
    const layers = excalidrawToKonvaLayers(moodboard)
    const circle = layers.find((l) => l.type === "circle")

    expect(circle).toBeDefined()
    expect(circle!.fill).toBe("#FF00FF")
  })

  it("x/y coordinates are offset (documented behavior)", () => {
    // The encoder adds OFFSET_X=20 and OFFSET_Y≥90.
    // This test documents and asserts that behavior explicitly.
    const original = makeLayer({
      id: "rt-pos",
      type: "text",
      x: 0, y: 0,
      text: "Position test",
      opacity: 1,
    })

    const moodboard = convertToExcalidraw([original])
    const layers = excalidrawToKonvaLayers(moodboard)
    const restored = layers.find((l) => l.text === "Position test")

    expect(restored).toBeDefined()
    // x = 20 + 0 = 20
    expect(restored!.x).toBe(20)
    // y = canvasStartY + 0 = 90 (no productName/material/partner)
    expect(restored!.y).toBe(90)
  })
})
