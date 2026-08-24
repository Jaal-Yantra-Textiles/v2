/**
 * The curated colour vocabulary — the whole of it.
 *
 * A partner picks from this list and nothing else. The names are what a buyer
 * reads on the storefront; the hex is what gets drawn as the swatch, and it
 * rides on `product_option_value.metadata.hex`.
 *
 * 🔑 This constant SEEDS the shared `Colour` option row — it is not the runtime
 * source of truth. Once seeded, the palette lives in the database and is read
 * back through the API, so an admin can add a 56th colour through
 * `POST /admin/product-options/:id/values` without a deploy, and the partner
 * picker and both storefronts pick it up on their next read.
 */
export const COLOUR_OPTION_TITLE = "Colour"

export type PaletteColour = { value: string; hex: string }

export const COLOUR_PALETTE: PaletteColour[] = [
  { value: "Blush Mist", hex: "#FFEBE5" },
  { value: "Dusty Mauve", hex: "#D8BCCE" },
  { value: "Cotton Candy", hex: "#FBCDEB" },
  { value: "Lilac", hex: "#D3A1CE" },
  { value: "Coral Pink", hex: "#FF8886" },
  { value: "Rose Quartz", hex: "#FFA4BA" },
  { value: "Rust", hex: "#A83804" },
  { value: "Raspberry", hex: "#D62768" },
  { value: "Peach", hex: "#F7C1A4" },
  { value: "Apricot", hex: "#E3825F" },
  { value: "Salmon", hex: "#FA8C84" },
  { value: "Melon", hex: "#FA8074" },
  { value: "Tangerine", hex: "#FF6E27" },
  { value: "Vermilion", hex: "#FF5939" },
  { value: "Marigold", hex: "#FDC835" },
  { value: "Amber", hex: "#DA8E2F" },
  { value: "Copper", hex: "#BF6C3B" },
  { value: "Mint Cream", hex: "#D5ECE1" },
  { value: "Aqua", hex: "#7CE0EE" },
  { value: "Turquoise", hex: "#6DE5D8" },
  { value: "Periwinkle", hex: "#C7C4EB" },
  { value: "Chartreuse", hex: "#CEF21F" },
  { value: "Emerald", hex: "#0EA347" },
  { value: "Forest Green", hex: "#06622E" },
  { value: "Teal", hex: "#008489" },
  { value: "Powder Blue", hex: "#B2C9F5" },
  { value: "Slate Blue", hex: "#41668B" },
  { value: "Cerulean", hex: "#189ECE" },
  { value: "Azure", hex: "#1F6ED4" },
  { value: "Cobalt", hex: "#1047A0" },
  { value: "Midnight Blue", hex: "#020766" },
  { value: "Ink", hex: "#2A2744" },
  { value: "Heather", hex: "#97819B" },
  { value: "Plum", hex: "#561543" },
  { value: "Mulberry", hex: "#5D1648" },
  { value: "Violet", hex: "#742D9F" },
  { value: "Brick Red", hex: "#A72C38" },
  { value: "Oxblood", hex: "#80011F" },
  { value: "Magenta", hex: "#B0096B" },
  { value: "Scarlet", hex: "#D02619" },
  { value: "Maroon", hex: "#59131D" },
  { value: "Sand", hex: "#E6CA9F" },
  { value: "Terracotta", hex: "#BF7B61" },
  { value: "Burnt Orange", hex: "#CC4714" },
  { value: "Rosewood", hex: "#693E41" },
  { value: "Chestnut", hex: "#6E391A" },
  { value: "Sienna", hex: "#A95C26" },
  { value: "Espresso", hex: "#4A2A14" },
  { value: "Taupe", hex: "#75594C" },
  { value: "Bark", hex: "#523F3A" },
  { value: "Stone Grey", hex: "#7F7F84" },
  { value: "Pearl Grey", hex: "#D6D6DB" },
  { value: "Ivory", hex: "#FAF8EF" },
  { value: "Black", hex: "#000000" },
  { value: "Camel", hex: "#C79453" },
]
