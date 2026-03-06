---
title: "Fashion Library — Moodboard Canvas"
sidebar_label: "Fashion Library"
sidebar_position: 9
---

# Fashion Library — Moodboard Canvas

_Last updated: 2026-03-06_

A fashion-specific tooling panel embedded in the Excalidraw moodboard canvas. Accessible via the **"Fashion Library"** button injected into Excalidraw's top-right toolbar.

---

## Architecture

```
design-moodboard-section.tsx   ← adds button + panel state
    ↕
fashion-panel.tsx              ← floating panel, three tabs
    ├── fashion-croquis.ts     ← SVG croquis figures + sewing cut pattern pieces
    └── fashion-shapes.ts      ← garment flat-lay polygon shapes + element factory
```

All files live at:
```
src/admin/components/designs/
  fashion-panel.tsx
  fashion-croquis.ts
  fashion-shapes.ts
```

---

## Panel Tabs

### 1 — Figures

Inserts a 9-head fashion proportion croquis (guide figure) as an Excalidraw `image` element at 85% opacity. Users draw garments on top using the Garments tab or Excalidraw's native tools.

| Option | Details |
|--------|---------|
| Female | 160×480 viewBox, warm pink tones, hourglass silhouette |
| Male   | 180×480 viewBox, cool blue-gray tones, broader shoulders |

Each SVG is defined entirely inline (no external fetch) as a template literal in `fashion-croquis.ts`. The SVG includes head, hair, neck, torso, arms, legs, and dashed construction lines at bust / waist / hip.

**View toggle** (shared with Garments tab):
- **Flat-lay** — no transform, standard technical illustration angle
- **3/4 View** — oblique projection applied at insert time:
  - `x' = x × 0.78` (horizontal compression)
  - `y' = y × 1.04 − x × 0.24 × (1 − y × 0.35)` (shear with foreshortening)

---

### 2 — Garments

Inserts garment flat-lay shapes as Excalidraw `line` elements (one per region). All regions in a shape share a `groupId` so they move as one unit while remaining individually selectable and recolourable via Excalidraw's native colour picker.

**Available shapes:**

| ID | Name | Regions |
|----|------|---------|
| `female-front` | Female Figure | Silhouette (1) |
| `male-front` | Male Figure | Silhouette (1) |
| `tshirt` | T-Shirt | Body, Left Sleeve, Right Sleeve, Collar |
| `dress` | Dress | Bodice, Skirt, Left Sleeve, Right Sleeve |
| `trousers` | Trousers | Waistband, Left Leg, Right Leg |
| `jacket` | Jacket | Front Left, Front Right, Left Sleeve, Right Sleeve, Collar |
| `skirt` | Skirt | Waistband, Skirt Body |
| `blouse` | Blouse | Body, Left Sleeve, Right Sleeve, Collar |

**Shape quality:** Each region is defined by 13–50 normalised `[0–1, 0–1]` polygon points. An `arc(cx, cy, rx, ry, a1, a2, n)` helper generates smooth ellipse arc approximations for collar necklines, sleeve openings, armholes, skirt flares, and trouser crotch curves.

**Element type:** `line` with `roughness: 0`, `fillStyle: "solid"` — renders crisp clean filled polygons (not sketchy freedraw strokes).

**Perspective:** Same 3/4 oblique transform as Figures tab, applied to all polygon points before inserting.

---

### 3 — Cut Patterns

Inserts sewing construction pattern pieces as `image` elements. Each piece is a self-contained inline SVG with:
- Garment piece outline
- Double-headed grain line arrow
- Notch triangles at seam alignment points
- Piece name + "Cut 1" / "Cut 2" label

**Available pieces:**

| ID | Name | Category |
|----|------|----------|
| `front-bodice` | Front Bodice | bodice |
| `back-bodice` | Back Bodice | bodice |
| `sleeve` | Sleeve | sleeve |
| `trouser-front` | Trouser Front | trouser |
| `trouser-back` | Trouser Back | trouser |
| `skirt` | Skirt Front/Back | skirt |
| `collar` | Flat Collar | collar |

---

## Key Implementation Details

### `fashion-shapes.ts` — `createShapeElements()`

```typescript
createShapeElements(
  shape: FashionShape,
  centerX: number,
  centerY: number,
  scale = 1,
  perspective: "flat" | "three-quarter" = "flat"
): object[]
```

- Scales normalised 0–1 region points to canvas units
- Optionally applies `perspectiveTransformPoints()` for 3/4 view
- Translates so `points[0]` is `[0, 0]` (Excalidraw `line` element convention)
- Closes each polygon by appending `[0, 0]` at end of points array
- All regions share one `groupId` (move together, select individually)

### `fashion-croquis.ts` — `createCrquisElements()` / `createPatternPieceElement()`

Both return `{ fileId, dataUrl, element }`. The caller must:
```typescript
api.addFiles([{ id: fileId, dataURL: dataUrl, mimeType: "image/svg+xml", ... }])
api.updateScene({ elements: [...api.getSceneElements(), element] })
```

SVG strings are encoded with `btoa()` (ASCII-safe, no Unicode).

### `design-moodboard-section.tsx` — `getCanvasCenter()`

```typescript
function getCanvasCenter() {
  const { scrollX, scrollY, zoom, width, height } = api.getAppState()
  const zoomValue = typeof zoom === "object" ? zoom.value : zoom
  return {
    x: (width / 2 - scrollX) / zoomValue,
    y: (height / 2 - scrollY) / zoomValue,
  }
}
```

All inserts use this as the drop point so shapes appear centred in the current viewport regardless of scroll/zoom.

---

## Persistence

No schema changes required. All Excalidraw elements (line, image) are serialised into the existing `design.moodboard` JSON field via the existing `useMoodboard` hook / `handleExcalidrawChange` handler. SVG files (croquis, pattern pieces) are stored in the `files` sub-object of the moodboard JSON.
