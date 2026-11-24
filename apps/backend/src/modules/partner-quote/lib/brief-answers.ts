/**
 * #2608 S1 — the buyer's answers on a quote brief, checked against each
 * question's kind before anything is stored. An answer that doesn't fit is
 * refused with the question named, never coerced into something she didn't say.
 */

export type BriefQuestionLike = {
  key: string
  label: string
  kind: string
  options?: string[] | null
  required?: boolean
}

/** Asked when a brief is created without its own list. */
export const DEFAULT_BRIEF_QUESTIONS: Array<BriefQuestionLike & { help?: string }> = [
  { key: "quantity", label: "How many pieces?", kind: "number", required: true, help: "Your best guess is fine; it decides the estimate." },
  { key: "size", label: "Size and shape", kind: "text", help: "e.g. round crossbody, 22 cm across, 6 cm deep" },
  { key: "print_spots", label: "Where should the print or painting go?", kind: "multi_choice", options: ["Front", "Back", "Flap", "Strap", "Inside lining"] },
  { key: "colours", label: "Colours", kind: "text", help: "Fabric colour and print/paint colours" },
  { key: "leather", label: "Leather or non-leather?", kind: "choice", options: ["Leather", "Non-leather", "Not sure yet"] },
  { key: "artwork", label: "Link to your artwork or references", kind: "link", help: "A Drive, Dropbox or Pinterest link" },
  { key: "deadline", label: "When do you need them?", kind: "date" },
  { key: "notes", label: "Anything else we should know?", kind: "long_text" },
]

export class BriefAnswerError extends Error {}

export const validateBriefAnswer = (q: BriefQuestionLike, raw: unknown): unknown => {
  const refuse = (why: string): never => {
    throw new BriefAnswerError(`"${q.label}": ${why}`)
  }
  if (raw === null || raw === undefined || raw === "") return null

  switch (q.kind) {
    case "text":
    case "long_text": {
      if (typeof raw !== "string") refuse("expected text")
      const s = (raw as string).trim()
      if (s.length > (q.kind === "text" ? 500 : 5000)) refuse("too long")
      return s || null
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim())
      if (!Number.isFinite(n) || n < 0) refuse("expected a number")
      return n
    }
    case "boolean":
      if (typeof raw !== "boolean") refuse("expected yes or no")
      return raw
    case "date": {
      const s = String(raw)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) refuse("expected a date (YYYY-MM-DD)")
      return s
    }
    case "link": {
      const s = String(raw).trim()
      let url: URL | null = null
      try {
        url = new URL(s)
      } catch {
        refuse("expected a link starting with https://")
      }
      if (url!.protocol !== "https:" && url!.protocol !== "http:") refuse("expected a web link")
      return s
    }
    case "choice": {
      const s = String(raw)
      if (!(q.options ?? []).includes(s)) refuse(`pick one of: ${(q.options ?? []).join(", ")}`)
      return s
    }
    case "multi_choice": {
      if (!Array.isArray(raw)) refuse("expected a list")
      const picked = [...new Set((raw as unknown[]).map(String))]
      const bad = picked.filter((v) => !(q.options ?? []).includes(v))
      if (bad.length) refuse(`not an option: ${bad.join(", ")}`)
      return picked.length ? picked : null
    }
    default:
      return refuse("unknown question type")
  }
}

/** Required questions still unanswered, by label. */
export const missingRequired = (
  questions: Array<BriefQuestionLike & { answer?: unknown }>
): string[] =>
  questions
    .filter((q) => q.required)
    .filter((q) => q.answer === null || q.answer === undefined || (Array.isArray(q.answer) && !q.answer.length))
    .map((q) => q.label)
