/**
 * Turning a design's specification into the questions a partner is asked.
 *
 * The spec is already the questionnaire. `design_specifications` rows are
 * categorised (Materials / Measurements / Construction / Finishing / Packaging /
 * Quality / Other), versioned, and carry `materials_required` and
 * `measurements` — so the wizard's steps and questions fall out of what a
 * designer already wrote, rather than from a structure invented here.
 *
 * 🔴 Deterministic, and pure. A model may later REPHRASE these prompts, but it
 * must never be what decides they exist: `response.object` is a claim rather
 * than a guarantee (#1487), and an inquiry that reaches a partner with no
 * questions is worse than a bluntly worded one. Keeping generation pure also
 * means the interesting cases — a spec with no materials, a design with no
 * spec at all — are unit-testable without a container.
 */

export type InquirySpecRow = {
  id?: string | null
  category?: string | null
  title?: string | null
  details?: string | null
  /** `{ [name]: value }`, e.g. { "GSM": 80, "Width": "70 cm" }. */
  measurements?: Record<string, unknown> | null
  /** Strings, or objects carrying a name/title. */
  materials_required?: unknown[] | null
  version?: string | null
}

export type InquiryPaletteValue = {
  id?: string | null
  value: string
  hex?: string | null
}

export type GeneratedQuestion = {
  step: string
  order: number
  kind: "yes_no" | "colour_select" | "number" | "text" | "photo"
  prompt: string
  options?: unknown[] | null
  spec_field_ref?: string | null
}

export type GenerateInquiryQuestionsInput = {
  specifications?: InquirySpecRow[] | null
  /** Palette values for the "do you have these colours?" step. */
  colours?: InquiryPaletteValue[] | null
  /** Restrict to these spec categories. Absent/empty means every category. */
  categories?: string[] | null
}

/**
 * Canonical step order — the sequence a maker would actually think in, from
 * what it is made of to how it is checked. Deliberately NOT the order the spec
 * rows happen to come back in: two inquiries on the same design must produce
 * the same wizard, or answers stop being comparable across partners.
 */
const CATEGORY_ORDER = [
  "Materials",
  "Measurements",
  "Construction",
  "Finishing",
  "Packaging",
  "Quality",
  "Other",
]

export const COLOUR_STEP = "Colours"
export const EVIDENCE_STEP = "Show us"

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

/** A material may be a bare string or an object; take whichever names it. */
const materialName = (material: unknown): string => {
  if (typeof material === "string") return material.trim()
  if (material && typeof material === "object") {
    const row = material as Record<string, unknown>
    return (
      text(row.name) ||
      text(row.title) ||
      text(row.material) ||
      text(row.label)
    )
  }
  return ""
}

const stepOf = (row: InquirySpecRow): string => text(row.category) || "Other"

/**
 * Questions for one spec row.
 *
 * A row with materials or measurements yields one question EACH — those are the
 * things a partner can answer differently ("I have the pashmina but not the
 * zari"), and collapsing them into one yes/no throws away the only answer worth
 * having. A row with neither falls back to a single question about the row
 * itself, which is still better than silence.
 *
 * A row that names nothing at all yields NOTHING. An empty prompt is not a
 * question, and asking one makes the partner distrust the rest of the wizard.
 */
const questionsForRow = (row: InquirySpecRow): Array<Omit<GeneratedQuestion, "order">> => {
  const step = stepOf(row)
  const ref = text(row.id)
  const out: Array<Omit<GeneratedQuestion, "order">> = []

  const materials = Array.isArray(row.materials_required)
    ? row.materials_required
    : []
  materials.forEach((material, index) => {
    const name = materialName(material)
    if (!name) return
    out.push({
      step,
      kind: "yes_no",
      prompt: `Can you supply ${name}?`,
      spec_field_ref: ref ? `${ref}:material:${index}` : null,
    })
  })

  const measurements =
    row.measurements && typeof row.measurements === "object"
      ? (row.measurements as Record<string, unknown>)
      : {}
  for (const key of Object.keys(measurements)) {
    const name = key.trim()
    if (!name) continue
    const target = measurements[key]
    const asked =
      target === null || target === undefined || text(String(target)) === ""
        ? ""
        : ` (we need ${String(target)})`
    out.push({
      step,
      kind: "number",
      prompt: `What ${name} can you achieve?${asked}`,
      spec_field_ref: ref ? `${ref}:measurement:${name}` : null,
    })
  }

  if (out.length) return out

  const title = text(row.title) || text(row.details)
  if (!title) return []

  return [
    {
      step,
      kind: "yes_no",
      prompt: `Can you do this: ${title}?`,
      spec_field_ref: ref || null,
    },
  ]
}

export const generateInquiryQuestions = (
  input: GenerateInquiryQuestionsInput
): GeneratedQuestion[] => {
  const wanted = (input.categories || [])
    .map((c) => text(c))
    .filter(Boolean)

  const rows = (input.specifications || []).filter((row) => {
    if (!row) return false
    if (!wanted.length) return true
    return wanted.includes(stepOf(row))
  })

  const byStep = new Map<string, Array<Omit<GeneratedQuestion, "order">>>()
  for (const row of rows) {
    for (const question of questionsForRow(row)) {
      const existing = byStep.get(question.step) || []
      existing.push(question)
      byStep.set(question.step, existing)
    }
  }

  // Known categories first in the canonical order, then anything unexpected,
  // alphabetically — an unrecognised category must still be asked, just last.
  const knownSteps = CATEGORY_ORDER.filter((c) => byStep.has(c))
  const extraSteps = Array.from(byStep.keys())
    .filter((c) => !CATEGORY_ORDER.includes(c))
    .sort()

  const ordered: Array<Omit<GeneratedQuestion, "order">> = []
  for (const step of [...knownSteps, ...extraSteps]) {
    ordered.push(...(byStep.get(step) || []))
  }

  const colours = (input.colours || []).filter((c) => text(c?.value))
  if (colours.length) {
    ordered.push({
      step: COLOUR_STEP,
      kind: "colour_select",
      prompt: "Which of these colours can you do?",
      options: colours.map((c) => ({
        id: c.id ?? null,
        value: text(c.value),
        hex: text(c.hex) || null,
      })),
      spec_field_ref: null,
    })
  }

  /**
   * Always last, always present. The photograph is the entire reason for
   * asking: a partner's yes is a claim, and the picture of what is on their
   * loom this week is the evidence. It is also what a partner can answer when
   * they can answer nothing else, which is why it survives a design that has no
   * specification rows at all.
   */
  ordered.push({
    step: EVIDENCE_STEP,
    kind: "photo",
    prompt:
      "Show us something similar you have made recently — a photo of what is on your loom now is perfect.",
    spec_field_ref: null,
  })

  return ordered.map((question, index) => ({
    ...question,
    order: index,
    options: question.options ?? null,
    spec_field_ref: question.spec_field_ref ?? null,
  }))
}

/**
 * The spec version the questions describe. Recorded on the inquiry so an answer
 * stays readable after the spec moves — without it, "yes we can do that" does
 * not say which "that".
 */
export const resolveSpecVersion = (
  specifications?: InquirySpecRow[] | null
): string | null => {
  const versions = (specifications || [])
    .map((row) => text(row?.version))
    .filter(Boolean)

  if (!versions.length) return null

  const unique = Array.from(new Set(versions))
  // More than one version in play is a real state (rows are approved
  // separately), and naming them all is more honest than picking one.
  return unique.length === 1 ? unique[0] : unique.sort().join(", ")
}
