/**
 * Smoke-test the WhatsApp intent "query planner" (intent + language) against a
 * live model.
 *
 * Run: GROQ_API_KEY=... tsx scripts/smoke-whatsapp-intent.ts
 * (a dummy scope is fine — model resolution falls back to the Groq env key.)
 */
import { extractPartnerIntent } from "../src/workflows/whatsapp/whatsapp-intent"

const openRuns = [
  { run_id: "prod_run_1", design_name: "Indigo Block Kurta", status: "in_progress" },
  { run_id: "prod_run_2", design_name: "Pashmina Stole (Kani)", status: "sent_to_partner" },
]

const scenarios = [
  "mein kaam kar raha hoon",
  "ok",
  "haan theek hai",
  "sirf 2 piece bache hain, bas ho gaya",
  "2 piece mein defect hai, scrap karna padega",
  "accept prod_run_1",
  "complete prod_run_1 produced:100 rejected:3",
  "कुर्ता कैसा चल रहा है",
  "what is the status of the indigo kurta?",
  "photo bhej raha hoon",
  "thanks a lot",
]

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error("Set GROQ_API_KEY and re-run.")
    process.exit(1)
  }
  for (const text of scenarios) {
    const intent = await extractPartnerIntent({} as any, {
      text,
      partnerName: "Priya",
      openRuns,
      recentMessages: [],
    })
    console.log(`\n[${text}]`)
    if (!intent) {
      console.log("  (null — model unavailable)")
      continue
    }
    console.log(
      `  lang=${intent.language}  action=${intent.action ?? "null"}  run_id=${intent.run_id ?? "-"}  qty=${intent.quantity ?? "-"}  rej=${intent.rejected_quantity ?? "-"}  notes=${intent.notes ?? "-"}`
    )
  }
}

main()