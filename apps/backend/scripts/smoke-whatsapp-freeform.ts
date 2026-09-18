/**
 * Smoke-test the free-form WhatsApp partner chat prompt against a live model.
 *
 * Exercises the same prompt builders the webhook uses
 * (`whatsapp-freeform-prompt.ts`) with a canned partner context, then asks a
 * real model (Groq free `qwen/qwen3.8-27b` by default) to write the reply for
 * each scenario — including Hinglish / Hindi / bare-acknowledgement turns. No
 * Medusa container needed; this validates prompt design + provider wiring.
 *
 * Run:
 *   GROQ_API_KEY=... tsx scripts/smoke-whatsapp-freeform.ts
 *
 * Override the model / provider with MODEL= / BASE_URL= / API_KEY=.
 */
import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"
import {
  buildFreeformSystemPrompt,
  buildUserPrompt,
  formatPartnerContext,
  formatConversationHistory,
  type PartnerChatContext,
  type HistoryEntry,
} from "../src/workflows/whatsapp/whatsapp-freeform-prompt"

const BASE_URL = process.env.BASE_URL || "https://api.groq.com/openai/v1"
const API_KEY = process.env.API_KEY || process.env.GROQ_API_KEY || ""
const MODEL = process.env.MODEL || "qwen/qwen3.8-27b"

const context: PartnerChatContext = {
  designs: [
    {
      id: "design_1",
      name: "Indigo Block Kurta",
      status: "In_Development",
      product_type: "kurta",
      target_completion_date: "2026-09-30",
    },
    {
      id: "design_2",
      name: "Pashmina Stole (Kani)",
      status: "Approved",
      product_type: "stole",
    },
  ],
  openRuns: [
    {
      id: "prod_run_1",
      status: "in_progress",
      accepted: true,
      designName: "Indigo Block Kurta",
    },
    {
      id: "prod_run_2",
      status: "sent_to_partner",
      accepted: false,
      designName: "Pashmina Stole (Kani)",
    },
  ],
  pendingPayments: [],
}

const history: HistoryEntry[] = [
  { role: "bot", content: "Hi Priya, this is SS from JYT — how is the Indigo Block Kurta coming along?" },
]

// language=undefined → "reply in the partner's language"; language="hi" →
// "reply in Hindi (Devanagari)".
const rounds: Array<{ label: string; language?: string; scenarios: string[] }> = [
  {
    label: "English / Hinglish (language not set)",
    scenarios: [
      "mein kaam kar raha hoon",
      "ok",
      "theek hai, kal tak ho jayega",
      "sirf 2 piece bache hain, bas ho gaya", // guardrail: must NOT say "scrap"
      "photo bhej raha hoon", // tap: ask which design/run
      "haan", // tap: bare ack with a stuck (sent_to_partner) run on file
    ],
  },
  {
    label: "Hindi (partner chose हिंदी)",
    language: "hi",
    scenarios: ["मैं काम कर रहा हूँ", "ठीक है", "कल तक हो जाएगा", "फोटो भेज रहा हूँ"],
  },
]

async function run(round: (typeof rounds)[number]) {
  const system = buildFreeformSystemPrompt({
    agentName: "SS",
    partnerName: "Priya",
    language: round.language,
    contextText: formatPartnerContext(context),
  })

  console.log(`\n════ ${round.label} ════`)
  for (const incoming of round.scenarios) {
    const user = buildUserPrompt({
      historyText: formatConversationHistory(history),
      partnerName: "Priya",
      incomingText: incoming,
    })
    // Groq is OpenAI-compatible and rejects the `developer` role the SDK emits
    // for non-GPT ids — fold the system prompt into the user message.
    const content = `${system}\n\n${user}`

    process.stdout.write(`\n[partner] ${incoming}\n`)
    try {
      const res = await generateText({
        model: client.chat(MODEL),
        messages: [{ role: "user", content }],
        maxOutputTokens: 600,
      })
      process.stdout.write(`[SS]      ${(res.text || "").trim()}\n`)
    } catch (e: any) {
      process.stdout.write(`[error]   ${e?.message ?? e}\n`)
    }
  }
}

const client = createOpenAI({ baseURL: BASE_URL, apiKey: API_KEY })

async function main() {
  if (!API_KEY) {
    console.error("No API key. Set GROQ_API_KEY (or API_KEY) and re-run.")
    process.exit(1)
  }

  console.log(`provider: ${BASE_URL}\nmodel: ${MODEL}\n`)
  console.log("── context injected ─────────────────────────────")
  console.log(formatPartnerContext(context))

  for (const round of rounds) {
    await run(round)
  }
}

main()