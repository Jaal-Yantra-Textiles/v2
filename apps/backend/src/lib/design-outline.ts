// The picture a design shows when it has none of its own.
//
// `resolveDesignThumbnail` returns null for a design nobody has photographed
// yet, and a design-order line with no thumbnail checks out, emails and lists
// as a grey box. This picks a garment ICON for it instead: a teal outline on
// paper, labelled "ILLUSTRATION" inside the image so nobody mistakes it for a
// photo of their piece.
//
// 🔑 Nothing is written to the design. The outline is a fallback at READ time,
// so the first real photo uploaded to the design wins automatically.
//
// Icons: Phosphor Icons "light" weight (MIT, https://phosphoricons.com),
// recoloured #4f7f8c on #f6f3ec and rendered to 600×600 PNG, because Gmail and
// Outlook do not show SVG. Sources: `src/lib/design-outlines/*.svg`.
import {
  DesignThumbnailSource,
  resolveDesignThumbnail,
} from "./design-thumbnail"

export type GarmentKind =
  | "shirt"
  | "tshirt"
  | "trouser"
  | "dress"
  | "hoodie"
  | "bag"
  | "quilt"
  | "sock"
  | "shoe"
  | "garment"

/** Hosted on the media bucket (uploaded 2026-11-25). */
export const DESIGN_OUTLINE_URLS: Record<GarmentKind, string> = {
  shirt: "https://automatic.jaalyantra.com/automatica/design-outline-shirt-01M886MVSDN6RZESGD85GPEQ1H.png",
  tshirt: "https://automatic.jaalyantra.com/automatica/design-outline-tshirt-01M886MVSKKB43G8PPW5WAGDMT.png",
  trouser: "https://automatic.jaalyantra.com/automatica/design-outline-trouser-01M886MVSKQ6N831DXZ4AWFX5Y.png",
  dress: "https://automatic.jaalyantra.com/automatica/design-outline-dress-01M886MVSMXTYPPAF8HYGYB76R.png",
  hoodie: "https://automatic.jaalyantra.com/automatica/design-outline-hoodie-01M886MVSMRHBV8859N1NXP14R.png",
  bag: "https://automatic.jaalyantra.com/automatica/design-outline-bag-01M886MVSQM8GVJFX12T7SKV8N.png",
  quilt: "https://automatic.jaalyantra.com/automatica/design-outline-quilt-01M886MVSQ25A4BE11DPQ56X3S.png",
  sock: "https://automatic.jaalyantra.com/automatica/design-outline-sock-01M886MVSQ15ATT31H43P0NM27.png",
  shoe: "https://automatic.jaalyantra.com/automatica/design-outline-shoe-01M886MVSRT35JYJB9CDYY1D8X.png",
  garment: "https://automatic.jaalyantra.com/automatica/design-outline-garment-01M886MVSRHBYDE42M41YB8D5X.png",
}

const OUTLINE_URL_SET = new Set(Object.values(DESIGN_OUTLINE_URLS))

/** True when a stored thumbnail is one of ours — safe to replace with a real photo. */
export const isDesignOutlineUrl = (url: unknown): boolean =>
  typeof url === "string" && OUTLINE_URL_SET.has(url.trim())

/**
 * First match wins, so the more specific words come first: "shirt dress" is a
 * dress, "t-shirt" is not a shirt, a "rajai" is bedding.
 */
const RULES: Array<[GarmentKind, RegExp]> = [
  ["quilt", /\b(rajai|razai|quilts?|blankets?|duvets?|bed ?(cover|spread|sheet)s?|throws?)\b/],
  ["bag", /\b(bags?|totes?|pouch(es)?|clutch(es)?|backpacks?|potli)\b/],
  ["sock", /\bsocks?\b/],
  ["shoe", /\b(shoes?|sneakers?|boots?|sandals?|juttis?|mojaris?)\b/],
  ["hoodie", /\b(hoodies?|sweatshirts?|sweaters?|cardigans?|pullovers?|jumpers?)\b/],
  ["dress", /\b(dress(es)?|gowns?|frocks?|skirts?|lehengas?|sarees?|saris?|kaftans?|anarkalis?)\b/],
  ["trouser", /\b(trousers?|pants?|pyjamas?|pajamas?|chinos?|jeans?|shorts|salwars?|palazzos?|joggers?|culottes?)\b/],
  ["tshirt", /\b(t-?shirts?|tees?)\b/],
  ["shirt", /\b(shirts?|kurtas?|kurtis?|blouses?|tops?|tunics?|chupas?)\b/],
]

const kindOf = (text: unknown): GarmentKind | null => {
  if (typeof text !== "string" || !text.trim()) return null
  const t = text.toLowerCase().replace(/_/g, " ")
  for (const [kind, re] of RULES) if (re.test(t)) return kind
  return null
}

/**
 * The garment a design is, from its `product_type` (typed, preferred) and then
 * its name. Anything unrecognised — a jacket, an apron, a stole — is "garment"
 * (a coat hanger), which is honest rather than a wrong silhouette.
 */
export const designGarmentKind = (design: {
  product_type?: string | null
  name?: string | null
} | null | undefined): GarmentKind =>
  kindOf(design?.product_type) ?? kindOf(design?.name) ?? "garment"

export type DesignImageSource = DesignThumbnailSource & {
  name?: string | null
  product_type?: string | null
}

/**
 * The design's own picture, or its garment outline. Never null — use this
 * wherever a BUYER sees the design (cart lines, emails, order pages); keep
 * `resolveDesignThumbnail` where "has no picture" must stay visible.
 */
export const resolveDesignImage = (
  design: DesignImageSource | null | undefined,
  opts: { allowDataUrl?: boolean } = {}
): string =>
  resolveDesignThumbnail(design, opts) ?? DESIGN_OUTLINE_URLS[designGarmentKind(design)]
