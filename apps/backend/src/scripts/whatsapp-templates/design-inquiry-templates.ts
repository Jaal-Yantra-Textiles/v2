import type { TemplateSpec } from "./partner-run-templates"

/**
 * WhatsApp templates for design inquiries — "what can you make?" (#1531 slice 3).
 *
 * ## Why an inquiry needs a template at all
 *
 * Meta's 24-hour customer-care window only constrains BUSINESS-initiated
 * messages, and an inquiry is business-initiated by definition: we are asking
 * a partner about a design they have never seen, usually weeks after the last
 * time either of us said anything. So a free-form message will simply not
 * deliver. A template will.
 *
 * 🔑 Any inbound message from the partner reopens the window for 24 hours,
 * free and with no template — so the follow-up conversation after they tap is
 * unconstrained. It is only the first knock that has to be a template.
 *
 * ## Why the button is a dynamic URL and not a quick reply
 *
 * A quick reply comes back as its own display text and nothing else, so the
 * inbound handler has to guess which inquiry it was about from conversation
 * metadata — which is how `pending_run_id` came to exist, and it holds ONE id.
 * An inquiry goes to several partners, and a partner may hold several
 * inquiries at once, so that mechanism cannot address it.
 *
 * A dynamic URL button carries a per-send `wa_token` whose claims name the
 * partner AND the inquiry. Tapping it lands them authenticated on that exact
 * wizard — no password, no guessing, and it works when they get round to it
 * three days later. See `whatsapp-deeplink.ts` and `/partners/wa-auth`.
 *
 * ## 🔴 These are not live until Meta approves them
 *
 * Adding a spec here submits it; it does not approve it. Until approval every
 * send fails, which is why the invite step treats a failed send as non-fatal
 * and records that it did not go. Run the sync (`manage-whatsapp-templates.ts`
 * or the `sync-whatsapp-templates` maintenance job) and check the status in
 * Meta before assuming a partner was ever asked.
 *
 * Editing rules inherited from `partner-run-templates.ts`, and they bite:
 *   - Variable and button COUNT must be identical across languages.
 *   - Meta rejects a body that ends on a variable (subcode 2388299) or has
 *     too few words per variable (2388293).
 *   - No emoji, variables, newlines or formatting inside button text.
 */

const INQUIRY_ACTION_BASE = (
  process.env.PARTNER_PORTAL_URL || "https://partner.jaalyantra.com"
).replace(/\/$/, "")

/**
 * {{1}} is filled per-send with the `wa_token`.
 *
 * ⚠️ It targets the LIST route, not `/inquiries/:id`. The base is baked into
 * the approved template and is therefore static per Meta — it cannot carry the
 * inquiry id. The id rides in the token instead: partner-ui's ProtectedRoute
 * exchanges `wa_token` on whatever protected page it lands on, and navigates
 * to the redirect the backend returns (`/inquiries/<id>`). Same mechanism the
 * production-run reminders use.
 */
const INQUIRY_ACTION_URL = `${INQUIRY_ACTION_BASE}/inquiries?wa_token={{1}}`

const INQUIRY_ACTION_EXAMPLE = [
  `${INQUIRY_ACTION_BASE}/inquiries?wa_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcnRuXzAxIiwicnVuX2lkIjoiZGlucV8wMUFCQyIsInR5cGUiOiJpbnF1aXJ5In0.s1gnatureExample`,
]

/**
 * The invitation.
 *
 * Deliberately says how many questions there are and that a photo is welcome.
 * A partner deciding whether to open this is deciding whether it is worth ten
 * minutes at a loom — "4 questions" answers that, "we'd love your input" does
 * not.
 */
const TEMPLATE_INQUIRY_INVITE: TemplateSpec = {
  name: "jyt_design_inquiry_invite_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      body:
        "Hi {{1}}, we are sourcing a new design and would like to know what " +
        "you can make.\n\n" +
        "*Design:* {{2}}\n" +
        "*Questions:* {{3}}\n\n" +
        "Tap below to answer. A photo of something similar on your loom right " +
        "now helps more than anything else you could send us.",
      examples: ["Rajesh", "Kani Twill Stole", "4"],
      buttons: [
        {
          type: "URL",
          text: "Answer now",
          url: INQUIRY_ACTION_URL,
          example: INQUIRY_ACTION_EXAMPLE,
        },
      ],
    },
    {
      language: "hi",
      body:
        "नमस्ते {{1}}, हम एक नया डिज़ाइन बनवा रहे हैं और जानना चाहते हैं कि " +
        "आप क्या बना सकते हैं।\n\n" +
        "*डिज़ाइन:* {{2}}\n" +
        "*प्रश्न:* {{3}}\n\n" +
        "उत्तर देने के लिए नीचे टैप करें। आपके करघे पर अभी जो कुछ भी ऐसा बना " +
        "है, उसकी एक फोटो सबसे ज़्यादा मदद करेगी।",
      examples: ["राजेश", "कानी ट्विल स्टोल", "4"],
      buttons: [
        {
          type: "URL",
          text: "अभी उत्तर दें",
          url: INQUIRY_ACTION_URL,
          example: INQUIRY_ACTION_EXAMPLE,
        },
      ],
    },
  ],
}

export const DESIGN_INQUIRY_TEMPLATES: TemplateSpec[] = [
  TEMPLATE_INQUIRY_INVITE,
]

export const DESIGN_INQUIRY_TEMPLATE_NAMES = {
  INQUIRY_INVITE: TEMPLATE_INQUIRY_INVITE.name,
} as const
