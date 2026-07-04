/**
 * Fixture modeled on the real tech pack SS26–CR–TP-08 (Craft Revival top) — the gold
 * standard from GitHub #892. Used to unit-test build-moodboard-scene.ts frame builders.
 * Measurement values are the real callouts from page 2 of that tech pack; unit is cm.
 */
import type { TechPackSceneInput } from "../build-moodboard-scene"

export const SS26_CR_TP08: TechPackSceneInput = {
  design: {
    title: "Craft Revival Top",
    style_code: "SS26–CR–TP-08",
    season: "SS26",
    category: "Womenswear / Top",
    capsule: "Craft Revival",
  },
  garment_type: "blouse",
  flats: {
    front_image_url: "https://cdn.example.com/ss26-cr-tp08-front.png",
    back_image_url: "https://cdn.example.com/ss26-cr-tp08-back.png",
  },
  sizeSet: {
    size_label: "M",
    unit: "cm",
    measurements: {
      total_length_hps: 66,
      shoulder_across: 38,
      neck_width: 24,
      neck_drop: 12,
      yoke_drop: 30,
      sleeve_length: 62,
      hem_opening: 160,
    },
    // yoke_drop is a vision guess in this fixture; the rest are spec-confirmed.
    suggested: ["yoke_drop"],
  },
  regions: [
    {
      label: "Neckline embroidery",
      bbox: [120, 40, 180, 120],
      note: "width 2–2.5 cm emb",
    },
    {
      label: "Sleeve embroidery",
      bbox: [30, 220, 140, 160],
      note: "flower emb 3.5 cm wide",
    },
  ],
  colorways: [
    { name: "Natural / Indigo", hex_code: "#2e3a59", thread_ref: "K-7" },
    { name: "Natural / Madder", hex_code: "#a83232", thread_ref: "K-10" },
    { name: "Natural / Myrobalan", hex_code: "#c9a227", thread_ref: "K-14" },
  ],
  seed: 42,
}
