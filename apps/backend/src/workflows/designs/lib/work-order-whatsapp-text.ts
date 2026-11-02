/**
 * #2500 — the words a partner reads when a bundle of designs is sent to them:
 * ONE message listing every design, instead of one template per design.
 *
 * Deterministic, not model-written, for the same reason as the inventory-order
 * message: it carries quantities the partner works to.
 */

export type WorkOrderMessageLine = {
  design_name: string
  quantity: number
}

export type WorkOrderMessageFacts = {
  greet_name: string
  /** The order number the partner sees in the app, e.g. "152". */
  order_ref: string
  lines: WorkOrderMessageLine[]
  /** `proseLanguageFor()` output: "hinglish" | "devanagari" | "english". */
  language: string
}

const formatQty = (q: number): string => {
  const n = Number(q) || 0
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

export function composeWorkOrderMessage(facts: WorkOrderMessageFacts): string {
  const lines = facts.lines.map(
    (l, i) => `${i + 1}. ${l.design_name} — ${formatQty(l.quantity)} pcs`
  )
  const pieces = facts.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  const designs = facts.lines.length

  if (facts.language === "english") {
    return [
      `Hello ${facts.greet_name}, here is a new design order from JYT (#${facts.order_ref}): ${designs} design${designs === 1 ? "" : "s"}, ${formatQty(pieces)} pcs.`,
      "",
      ...lines,
      "",
      "Please open the order in your JYT app and accept each design.",
    ].join("\n")
  }

  // Hinglish (default). Devanagari partners get the same Roman-script text, as
  // the design names are our catalogue titles.
  return [
    `Namaste ${facts.greet_name} ji, aapke liye JYT ka naya design order hai (#${facts.order_ref}): ${designs} design, ${formatQty(pieces)} pcs.`,
    "",
    ...lines,
    "",
    "Kripya JYT app mein order khol kar har design accept kar dijiye.",
  ].join("\n")
}
