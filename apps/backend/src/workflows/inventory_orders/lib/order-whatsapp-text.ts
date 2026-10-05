import {
  TEMPLATE_PARAM_MAX_LENGTH,
  sanitizeTemplateParam,
} from "../../whatsapp/whatsapp-template-params"

/**
 * The words a partner reads when an inventory order is sent to them.
 *
 * Deterministic, not model-written: this message carries QUANTITIES and PRICES
 * the partner is asked to confirm, and the outreach-prose model is told never
 * to invent numbers precisely because a reworded figure is a different order.
 * Every number here comes straight from the order lines.
 */

export type OrderMessageLine = {
  title: string
  quantity: number
  unit?: string | null
  /** Per-unit price. Omitted (or 0) on a sample. */
  price?: number | null
}

/** `proseLanguageFor()` output: "hinglish" | "devanagari" | "english". */
export type OrderMessageLanguage = string

export type OrderMessageFacts = {
  greet_name: string
  /** Short human reference, e.g. the last 6 chars of the order id. */
  order_ref: string
  lines: OrderMessageLine[]
  total_price: number
  currency_code?: string | null
  is_sample: boolean
  notes?: string | null
  language: OrderMessageLanguage
}

const UNIT_SHORT: Record<string, string> = {
  meter: "m",
  metre: "m",
  meters: "m",
  kilogram: "kg",
  gram: "g",
  piece: "pc",
  yard: "yd",
  roll: "roll",
}

const unitFor = (unit?: string | null): string => {
  if (!unit) return ""
  return UNIT_SHORT[unit.trim().toLowerCase()] ?? unit.trim()
}

/** Indian grouping for rupees (29000 → 29,000); others plain. */
export const formatMoney = (amount: number, currency?: string | null): string => {
  const code = String(currency || "inr").toLowerCase()
  const n = Number(amount) || 0
  if (code === "inr") {
    return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
  }
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${code.toUpperCase()}`
}

const formatQty = (q: number): string => {
  const n = Number(q) || 0
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

const formatLine = (line: OrderMessageLine, index: number, facts: OrderMessageFacts): string => {
  const unit = unitFor(line.unit)
  const qty = `${formatQty(line.quantity)}${unit ? ` ${unit}` : ""}`
  const price = Number(line.price) || 0
  const priced = !facts.is_sample && price > 0
    ? ` @ ${formatMoney(price, facts.currency_code)}${unit ? `/${unit}` : ""}`
    : ""
  return `${index + 1}. ${line.title} — ${qty}${priced}`
}

/** Sum of quantities when every line shares one unit (else null). */
const sharedTotalQuantity = (lines: OrderMessageLine[]): string | null => {
  const units = new Set(lines.map((l) => unitFor(l.unit)))
  if (units.size !== 1) return null
  const unit = [...units][0]
  const sum = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  return `${formatQty(sum)}${unit ? ` ${unit}` : ""}`
}

/**
 * The full message, one item per line. This is what goes out as free text
 * inside the 24-hour window.
 */
export function composeOrderMessage(facts: OrderMessageFacts): string {
  const lines = facts.lines.map((l, i) => formatLine(l, i, facts))
  const qtyTotal = sharedTotalQuantity(facts.lines)
  const money = !facts.is_sample && facts.total_price > 0
    ? formatMoney(facts.total_price, facts.currency_code)
    : null
  const notes = (facts.notes ?? "").trim()

  if (facts.language === "english") {
    const totalBits = [qtyTotal, money].filter(Boolean).join(", ")
    return [
      `Hello ${facts.greet_name}, here is a new ${facts.is_sample ? "SAMPLE " : ""}order from JYT (#${facts.order_ref}):`,
      "",
      ...lines,
      ...(totalBits ? ["", `Total: ${totalBits}`] : []),
      ...(facts.is_sample ? ["This is a sample — no charge."] : []),
      ...(notes ? ["", `Note: ${notes}`] : []),
      "",
      "Please check it item by item and confirm the quantities. When you begin, tap Start on the order in your JYT app.",
    ].join("\n")
  }

  // Hinglish (default). Devanagari partners get the same Roman-script text: the
  // item names are our catalogue titles, and a half-transliterated list is
  // harder to check than a consistent one.
  const totalBits = [qtyTotal, money].filter(Boolean).join(", ")
  return [
    `Namaste ${facts.greet_name} ji, aapke liye JYT ka naya ${facts.is_sample ? "SAMPLE " : ""}order hai (#${facts.order_ref}):`,
    "",
    ...lines,
    ...(totalBits ? ["", `Kul: ${totalBits}`] : []),
    ...(facts.is_sample ? ["Yeh sample hai — iska koi charge nahi hai."] : []),
    ...(notes ? ["", `Note: ${notes}`] : []),
    "",
    "Kripya item-wise dekh kar quantity confirm kar dijiye. Kaam shuru karte hi JYT app mein order par Start daba dijiye.",
  ].join("\n")
}

/**
 * The same message for the template carrier (`jyt_partner_message_v1`), used
 * outside the 24-hour window. Meta forbids newlines in a body parameter, so the
 * items are joined with " · " instead of being silently run together, and the
 * whole thing is held to the parameter limit.
 */
export function flattenForTemplate(text: string): { text: string; truncated: boolean } {
  const joined = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" · ")
  const s = sanitizeTemplateParam(joined, TEMPLATE_PARAM_MAX_LENGTH)
  return { text: s.text, truncated: s.truncated }
}
