/**
 * WhatsApp "query planner" — one model call that reads a partner's free-form
 * message and returns its INTENT and LANGUAGE, replacing the regex command
 * parser and the Devanagari regex.
 *
 * The model returns typed fields the handler consumes directly:
 *   - `language`: hinglish | english | devanagari (drives the reply language)
 *   - `action`:   accept / start / finish / complete / decline / status /
 *                 runs / help / acknowledgment, or null for plain conversation
 *   - `run_id`:   the prod_run_... the message refers to (matched against the
 *                 partner's open runs when they name a design instead)
 *   - `quantity` / `rejected_quantity` / `notes`: numbers + detail for
 *                 finish / complete
 *
 * `extractPartnerIntent` NEVER throws — it returns `null` when no model is
 * reachable, so the handler falls back to its old deterministic parser.
 */
import { generateObject } from "ai"
import { z } from "zod"
import { buildGenerateArgs } from "../../mastra/services/ai-platforms"
import { resolveWhatsAppModel } from "./whatsapp-model"

export type PartnerLanguage = "hinglish" | "english" | "devanagari"

export type PartnerAction =
  | "accept"
  | "start"
  | "finish"
  | "complete"
  | "decline"
  | "status"
  | "runs"
  | "help"
  | "acknowledgment"

export type PartnerIntent = {
  language: PartnerLanguage
  action: PartnerAction | null
  run_id: string | null
  quantity: number | null
  rejected_quantity: number | null
  notes: string | null
}

const IntentSchema = z.object({
  language: z
    .enum(["hinglish", "english", "devanagari"])
    .describe("The language the partner is writing in."),
  action: z
    .enum(["accept", "start", "finish", "complete", "decline", "status", "runs", "help", "acknowledgment"])
    .nullable()
    .describe(
      "The command/action the message expresses, or null when it is just conversation (an update like 'getting ready', a question like 'what is the status', or a note like 'photo bhej raha hoon')."
    ),
  run_id: z
    .string()
    .nullable()
    .describe(
      "The production run id (prod_run_...) the message refers to. If the partner names a design instead, match it against `open_runs` and return that run_id. Null when no specific run is meant."
    ),
  quantity: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("A quantity the partner mentioned — units produced for complete, or a scrap count for finish."),
  rejected_quantity: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("A rejected / defect count the partner mentioned."),
  notes: z
    .string()
    .nullable()
    .describe("Any free-form detail the partner gave about the run (e.g. 'stitching defects')."),
})

export type IntentInput = {
  text: string
  partnerName: string
  openRuns: Array<{ run_id: string; design_name: string | null; status: string }>
  recentMessages: string[]
}

const SYSTEM_PROMPT = `You are the intent parser for a WhatsApp production-coordination assistant talking to a manufacturing partner.

Read the partner's message and return a small structured interpretation. Only return what is stated — never invent a run_id, quantity or language.

Field guidance:
- language: "hinglish" is Hindi written in Roman letters (e.g. "theek hai", "mein kaam kar raha hoon"); "english" is plain English; "devanagari" is Hindi in Devanagari script. Look at the message and recent_messages.
- action: one of accept / start / finish / complete / decline / status / runs / help / acknowledgment. "status" = asking to see a run's details; "runs" = list my runs; "help" = show commands; "acknowledgment" = a bare ok/haan/theek/thanks needing no action; "accept" = agreeing to do a run; "start"/"finish"/"complete"/"decline" = the run lifecycle. Return null when the message is conversation (a progress update, a question about status, "will finish tomorrow", "photo bhej raha hoon", etc.) that doesn't map to a command.
- run_id: the prod_run_... id from the message, or matched from open_runs when the partner names a design. Null when no specific run is meant.
- quantity / rejected_quantity / notes: extract numbers and detail only when the partner gives them.`

export async function extractPartnerIntent(
  scope: any,
  input: IntentInput
): Promise<PartnerIntent | null> {
  const resolved = await resolveWhatsAppModel(scope)

  const prompt = [
    `open_runs: ${JSON.stringify(input.openRuns)}`,
    `recent_messages: ${JSON.stringify(input.recentMessages)}`,
    `partner_name: ${input.partnerName}`,
    ``,
    `message: ${input.text}`,
  ].join("\n")

  try {
    const { object } = await generateObject({
      model: resolved.model,
      ...buildGenerateArgs({ providerType: resolved.providerType }, SYSTEM_PROMPT, prompt),
      schema: IntentSchema,
      temperature: 0.1,
    })
    return object as PartnerIntent
  } catch (e: any) {
    console.warn(`[whatsapp-intent] extraction failed: ${e?.message ?? e}`)
    return null
  }
}