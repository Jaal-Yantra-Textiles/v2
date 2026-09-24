/**
 * A recorded material is FREE TEXT. An inventory line's `material_name` and a
 * design item's title are whatever someone typed — "White Stripes Fabric",
 * "Red Jaamdani with white prints", "Pant Material Handloom (Split)" — and a
 * records scan copied them into `material` verbatim (#2249, 7 of 60 proposals
 * on 2026-09-24). A capability's material is searched ("who does tussar?"),
 * so it must be a fibre or nothing.
 *
 * PURE. Returns one of the MATERIALS labels in classify-evidence.ts, or null
 * when the text names no fibre. Fibres from two families ("Cotton and Wool
 * Handloom", "Ahimsa Silk and Cotton Robe") are a blend.
 */

type Fibre = { label: string; family: string; pattern: RegExp }

// Most specific first within a family: "kala cotton" before "cotton",
// "terry cotton" is terry, a named silk before bare "silk".
const FIBRES: Fibre[] = [
  { label: "kala cotton", family: "cotton", pattern: /\bkala\s*cotton\b/ },
  { label: "organic cotton", family: "cotton", pattern: /\borganic\s*cotton\b/ },
  { label: "khadi", family: "cotton", pattern: /\bkhadi\b/ },
  { label: "muslin", family: "cotton", pattern: /\b(muslin|mulmul)\b/ },
  { label: "denim", family: "cotton", pattern: /\bdenim\b/ },
  { label: "terry", family: "cotton", pattern: /\bterry\b/ },
  { label: "cotton", family: "cotton", pattern: /\bcotton\b/ },
  { label: "linen", family: "linen", pattern: /\blinen\b/ },
  { label: "hemp", family: "hemp", pattern: /\bhemp\b/ },
  { label: "nettle", family: "nettle", pattern: /\bnettle\b/ },
  { label: "jute", family: "jute", pattern: /\bjute\b/ },
  { label: "pashmina", family: "wool", pattern: /\b(pashmina|cashmere)\b/ },
  { label: "wool", family: "wool", pattern: /\b(wool|woolen|woollen|merino|tweed)\b/ },
  { label: "ahimsa silk", family: "silk", pattern: /\b(ahimsa|peace)\s*silk\b/ },
  { label: "tussar silk", family: "silk", pattern: /\b(tussar|tussah|tasar|tassar)\b/ },
  { label: "matka silk", family: "silk", pattern: /\bmatka\b/ },
  { label: "eri silk", family: "silk", pattern: /\beri\s*silk\b/ },
  { label: "mulberry silk", family: "silk", pattern: /\b(mulberry\s*)?silk\b/ },
]

export const materialFromText = (text: string | null | undefined): string | null => {
  const s = (text ?? "").toLowerCase()
  if (!s.trim()) return null
  if (/\b(blend|blended|poly|polyester|viscose|rayon|synthetic)\b/.test(s)) return "blend"
  const hits = FIBRES.filter((f) => f.pattern.test(s))
  if (!hits.length) return null
  const families = new Set(hits.map((f) => f.family))
  return families.size > 1 ? "blend" : hits[0].label
}
