/**
 * What does the maker want this turn — a new piece, the current one, or back
 * to another open design? Asked of a System One model (#2556).
 *
 * The word rules in design-new-piece-intent.ts only see what they list:
 * "could we do a dupatta to go with it" has none of their cue words, and
 * "back to the kurta" was never handled at all (the model never called
 * switch_design on its own). A System One judgment reads the meaning. Measured
 * 2026-11-20 on the Featherless demo: 7/7 such messages right, ~2s.
 *
 * Configured like every other pre-classification: an `ai_classification`
 * platform row with `metadata.scopes` including DESIGN_CHAT_INTENT_SCOPE. Off
 * (no row) or failed or unsure → `null`, and the caller keeps its word rules.
 *
 * 🔴 What leaves the building: the maker's last message, the assistant's last
 * line (trimmed), and the garment NAMES of their open designs. No ids, no
 * email, no design content.
 */
import { asChoice, choice, type Question } from "../../lib/ai/typesafe"
import { classify } from "../../lib/ai/classify"
import { GARMENT_PIECES, garmentsIn } from "./storefront-design-chat"

export const DESIGN_CHAT_INTENT_SCOPE = "design_chat_intent"

/** Act only on a clear answer. A wrong "new piece" makes a design nobody asked for. */
export const ACT_AT = 0.9
/** The new piece's garment is a softer call: when unsure it is left for the maker to say. */
export const GARMENT_AT = 0.7

export type OpenDesign = { design_id: string; garment: string | null; name?: string | null }

export type TurnJudgment =
  | { action: "new_piece"; product_type: string | null }
  | { action: "switch"; design_id: string }
  | { action: "stay" }

const NO_GARMENT = "not_named"
const NO_DESIGN = "none"

const describe = (d: OpenDesign) =>
  d.garment ? `the ${d.garment}${d.name ? ` ("${d.name}")` : ""}` : d.name ? `"${d.name}"` : "an unnamed piece"

/** PURE. The questions for one turn. `others` are the open designs other than the active one. */
export const designTurnQuestions = (others: OpenDesign[]): Record<string, Question> => {
  const questions: Record<string, Question> = {
    intent: choice(
      "The maker is designing clothes in a chat; `designing_now` is the garment they are working on. What does their latest message `maker_message` ask for? `assistant_said` is the assistant's previous message, for context.",
      {
        new_piece: {
          what: "Start designing a DIFFERENT, additional garment alongside this one.",
          examples: ["now the matching trousers", "could we do a dupatta to go with it", "I want a shawl as well"],
        },
        current: {
          what: "Keep working on the garment in `designing_now`, or a general question about it.",
          examples: ["make the sleeves shorter", "show me fabrics for it", "would it look good with trousers?"],
        },
        switch_back: {
          what: "Go back to, or talk about, one of their OTHER open designs listed in `other_open_designs`.",
          examples: ["back to the kurta", "the trousers should be ankle length"],
        },
        unclear: "Cannot tell from the message.",
      }
    ),
    new_garment: choice(
      "If `maker_message` asks to design a new, additional garment, which garment is it?",
      Object.fromEntries([
        ...GARMENT_PIECES.map((g) => [g, null] as const),
        [NO_GARMENT, "The message does not name the new garment."],
      ])
    ),
  }
  if (others.length) {
    questions.switch_to = choice(
      "If `maker_message` is about one of the designs in `other_open_designs`, which one?",
      Object.fromEntries([
        ...others.map((d, i) => [`d${i}`, `Item ${i} of \`other_open_designs\`: ${describe(d)}`] as const),
        [NO_DESIGN, "None of them."],
      ])
    )
  }
  return questions
}

/** PURE. The state sent with the questions — names and the two messages only. */
export const designTurnState = (input: {
  lastUserText: string
  lastAssistantText?: string
  activeGarment: string
  others: OpenDesign[]
}) => ({
  designing_now: input.activeGarment,
  other_open_designs: input.others.map(describe),
  maker_message: input.lastUserText.slice(0, 600),
  assistant_said: (input.lastAssistantText ?? "").slice(-400),
})

/**
 * PURE. Turn the answers into an action, or null when they are not clear
 * enough to act on (the caller then keeps its word rules).
 */
export const readDesignTurn = (
  answers: Record<string, any>,
  others: OpenDesign[]
): TurnJudgment | null => {
  const intent = asChoice(answers.intent)
  if (!intent) return null
  const p = intent.probabilities?.[intent.choice] ?? 0
  if (p < ACT_AT) return null

  if (intent.choice === "current" || intent.choice === "unclear") return { action: "stay" }

  if (intent.choice === "switch_back") {
    const to = asChoice(answers.switch_to)
    if (to && to.choice !== NO_DESIGN && (to.probabilities?.[to.choice] ?? 0) >= ACT_AT) {
      const d = others[Number(to.choice.slice(1))]
      if (d) return { action: "switch", design_id: d.design_id }
    }
    // Only one other design: there is nothing to choose between.
    if (others.length === 1) return { action: "switch", design_id: others[0].design_id }
    return null
  }

  // new_piece
  const g = asChoice(answers.new_garment)
  const garment =
    g && g.choice !== NO_GARMENT && (g.probabilities?.[g.choice] ?? 0) >= GARMENT_AT ? g.choice : null
  // A "new" piece one of their open designs is already for is that design.
  if (garment) {
    const open = others.find((d) => d.garment && garmentsIn(d.garment).concat(d.garment).includes(garment))
    if (open) return { action: "switch", design_id: open.design_id }
  }
  return { action: "new_piece", product_type: garment }
}

/** Ask. Null when off, failed, or unsure — never throws. */
export const judgeDesignTurn = async (
  container: any,
  input: {
    lastUserText: string
    lastAssistantText?: string
    activeGarment: string
    others: OpenDesign[]
  }
): Promise<TurnJudgment | null> => {
  if (!input.lastUserText.trim()) return null
  const result = await classify(container, {
    scope: DESIGN_CHAT_INTENT_SCOPE,
    state: designTurnState(input),
    questions: designTurnQuestions(input.others),
    // The chat waits on this before the model starts: keep it short.
    timeoutMs: 4000,
  }).catch(() => null)
  if (!result) return null
  return readDesignTurn(result.answers, input.others)
}
