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
  /** #2500 — pieces per size, e.g. "38×1, 40×1"; omitted when not sized. */
  sizes?: string | null
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
    (l, i) =>
      `${i + 1}. ${l.design_name} — ${formatQty(l.quantity)} pcs${l.sizes ? ` (${l.sizes})` : ""}`
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

export type WorkOrderReminderKind = "assignment_pending" | "not_started" | "idle"

export type WorkOrderReminderFacts = {
  greet_name: string
  order_ref: string
  kind: WorkOrderReminderKind
  lines: (WorkOrderMessageLine & { days: number })[]
  language: string
}

const ASK_BY_KIND: Record<WorkOrderReminderKind, { english: [string, string]; hinglish: [string, string] }> = {
  assignment_pending: {
    english: ["are waiting for you to accept", "Please open the order in your JYT app and accept them."],
    hinglish: ["abhi accept hone baaki hain", "Kripya JYT app mein order khol kar inhe accept kar dijiye."],
  },
  not_started: {
    english: ["were accepted but have not started", "When you begin, tap Start on each design in your JYT app."],
    hinglish: ["accept ho gaye hain par shuru nahi hue", "Kaam shuru karte hi JYT app mein har design par Start daba dijiye."],
  },
  idle: {
    english: ["have had no update for a while", "Please share an update or photos in your JYT app."],
    hinglish: ["par kuch dino se koi update nahi aaya", "Kripya JYT app mein update ya photos bhej dijiye."],
  },
}

/**
 * #2500 — ONE daily reminder for a bundle: the designs of one work order that
 * are due the same reminder, with how long each has waited.
 */
export function composeWorkOrderReminder(facts: WorkOrderReminderFacts): string {
  const lines = facts.lines.map(
    (l, i) =>
      `${i + 1}. ${l.design_name} — ${formatQty(l.quantity)} pcs (${l.days} ${facts.language === "english" ? (l.days === 1 ? "day" : "days") : "din"})`
  )
  const n = facts.lines.length
  if (facts.language === "english") {
    const [state, ask] = ASK_BY_KIND[facts.kind].english
    return [
      `Hello ${facts.greet_name}, a reminder from JYT: ${n} design${n === 1 ? "" : "s"} on order #${facts.order_ref} ${state}:`,
      "",
      ...lines,
      "",
      ask,
    ].join("\n")
  }
  const [state, ask] = ASK_BY_KIND[facts.kind].hinglish
  return [
    `Namaste ${facts.greet_name} ji, JYT se yaad dilana tha: order #${facts.order_ref} ke ${n} design ${state}:`,
    "",
    ...lines,
    "",
    ask,
  ].join("\n")
}
