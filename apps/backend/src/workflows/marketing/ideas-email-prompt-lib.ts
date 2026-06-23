/**
 * ideas-email-prompt-lib.ts — pure prompt assembly for the daily AI tactical-ideas
 * email (#659 slice 2, spec 02 §4.4). Implements the source-spec §5.4 skeleton, with
 * the hallucination-guard contract baked in: the LLM may reference numbers ONLY via
 * `{TOKEN}` placeholders, never literals. PURE: ground truth + voice in → prompt out.
 */

import type { GroundTruth } from "./ideas-email-guard-lib"

/**
 * v1 voice rules embedded as a constant (report §7: voice rules live in CLAUDE.md;
 * later sourced from a `marketing_manual_override` settings row). Keep this pure —
 * the workflow can pass an override string instead.
 */
export const MARKETING_VOICE_RULES = [
  "Be concrete and operator-facing: each idea is a move someone can do today.",
  "No fluff, no hype, no congratulating. Lead with the action, not the metric.",
  "Prefer 3–5 ideas; one or two sentences each.",
  "Tie every idea back to the ONE GOAL.",
].join("\n- ")

/**
 * Build the prompt. Lists each ground-truth value as `LABEL: {TOKEN}` (so the model
 * sees the placeholder it must reuse) plus the human display value for context, then
 * hard-instructs placeholder-only number usage and interpolates the date + goal.
 */
export function buildIdeasPrompt(
  gt: GroundTruth,
  businessDescription: string,
  voiceRules: string = MARKETING_VOICE_RULES
): string {
  const numbersBlock =
    (gt.values || [])
      .map((v) => {
        const unit = v.unit ? ` (${v.unit})` : ""
        return `- ${v.token}: {${v.token}} = ${v.display}${unit}`
      })
      .join("\n") || "- (no metrics available)"

  return [
    `You are the AI VP of Marketing for this business. Date: ${gt.date_ist}.`,
    ``,
    `BUSINESS:`,
    businessDescription,
    ``,
    `THE ONE GOAL (optimise every suggestion toward this): ${gt.one_goal}`,
    ``,
    `TODAY'S GROUND-TRUTH NUMBERS (reference each ONLY by its {TOKEN} placeholder):`,
    numbersBlock,
    ``,
    `HARD RULES — these are non-negotiable:`,
    `- Refer to any number ONLY by its {TOKEN} placeholder.`,
    `- Never write a literal number, percentage, or currency amount.`,
    `- If you need a number that is not in the list above, do not use it.`,
    `- Output 3–5 concrete tactical moves for today, each tied to the ONE GOAL.`,
    ``,
    `VOICE:`,
    `- ${voiceRules}`,
  ].join("\n")
}

/**
 * Appended to the prompt on the single regeneration attempt after a guard failure
 * (source spec §7.2: "regenerate once, then flag"). Tightens the placeholder rule.
 */
export const STRICTER_SUFFIX = [
  ``,
  `IMPORTANT: Your previous answer included a literal number, which is forbidden.`,
  `Rewrite using ONLY the {TOKEN} placeholders listed above. Do not type any digit`,
  `that is not part of a {TOKEN} placeholder.`,
].join("\n")
