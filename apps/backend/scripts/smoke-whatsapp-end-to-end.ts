/**
 * End-to-end smoke test of the WhatsApp free-form reply orchestrator
 * (`handleFreeFormPartnerReply`) against a live model, using a stub scope.
 *
 * Exercises the real pipeline: model resolution (Groq env) → context pack →
 * history → intent-evaluated language → prompt → LLM reply → send.
 *
 * Run: GROQ_API_KEY=... tsx scripts/smoke-whatsapp-end-to-end.ts
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MESSAGING_MODULE } from "../src/modules/messaging"
import { handleFreeFormPartnerReply } from "../src/workflows/whatsapp/whatsapp-freeform-chat"

const fakeQuery = {
  graph: async () => ({ data: [] }),
}
const fakeMessaging = {
  listMessagingMessages: async () => [],
  retrieveMessagingConversation: async () => ({ metadata: {} }),
  updateMessagingConversations: async () => ({}),
}
const scope = {
  resolve: (key: any) => {
    if (key === ContainerRegistrationKeys.QUERY) return fakeQuery
    if (key === ContainerRegistrationKeys.LOGGER) {
      return { info: () => {}, warn: () => {}, error: () => {} }
    }
    if (key === MESSAGING_MODULE) return fakeMessaging
    return null
  },
}

const scenarios = [
  { text: "what is the status of the indigo kurta design?", language: "english" },
  { text: "mein kaam kar raha hoon", language: "hinglish" },
  { text: "फोटो भेज रहा हूँ", language: "devanagari" },
]

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error("Set GROQ_API_KEY and re-run.")
    process.exit(1)
  }
  for (const m of scenarios) {
    const sent: string[] = []
    const whatsapp = {
      sendTextMessage: async (_to: string, text: string) => {
        sent.push(text)
        return { messages: [{ id: "wamid_test" }] }
      },
    }
    const res = await handleFreeFormPartnerReply(scope as any, {
      text: m.text,
      phone: "919999999999",
      partnerId: "partner_test",
      partnerName: "Priya",
      conversationId: null,
      whatsapp,
      language: m.language,
    })
    console.log(`\n[partner] ${m.text}`)
    console.log(`[SS]      ${sent[0] ?? "(no reply)"}`)
    console.log(`  → ${res.action}`)
  }
}

main()