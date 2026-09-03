import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { QUOTE_INTRODUCTION_TEMPLATE_KEY } from "../../../scripts/seed-quote-email-template"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { sendNotificationEmailStep } from "../steps/send-notification-email"

/**
 * What the introduction template's `variables` block declares — see
 * `QUOTE_INTRODUCTION_TEMPLATE_DEFINITION` in the seed. Nothing more and
 * nothing less: a variable this type forgets is a silent blank in a buyer's
 * inbox, and one it invents is a lie the template will never render.
 */
export type QuoteIntroductionEmailData = {
  partner_name: string
  recipient_name: string
  recipient_company: string | null
  line_count: number
  total_quantity: number
  destination: string
  current_year: number
}

/**
 * Deliver the partner introduction that precedes a quote (#1486 slice 1).
 *
 * ## Why this exists when a visual flow could have sent it
 *
 * 🔴 The introduction used to be delegated to a prod-configured visual flow
 * listening on `partner_quote.minted` — and nothing in code ever sent it. The
 * template existed, the event was emitted, the subscriber allowlisted it, and
 * whether a buyer was introduced at all depended on infrastructure that may
 * not exist in any given environment. The send now lives in code, on the
 * quote-delivery path; a configured flow becomes an addition, not a
 * precondition.
 *
 * ## Same mechanism as the quote email, deliberately
 *
 * `fetchEmailTemplateStep` + `sendNotificationEmailStep`, composed exactly as
 * `send-quote-email.ts` composes them — a second template-fetch or send path
 * is how two emails that must agree quietly diverge. `fetchEmailTemplateStep`
 * throws when the template is missing, which is as correct here as it is for
 * the quote: an introduction sent from a provider default would introduce
 * nobody. The CALLER owns the consequence — a failed introduction is logged
 * and must never stop the quote itself.
 *
 * ## Channel
 *
 * `email` → Resend, the brand channel, matching the quote email it precedes.
 * This is BUYER-facing and the template's own `from` is
 * `sales@jaalyantra.com`; an introduction arriving from a partner subdomain
 * would read as internal mail to a procurement inbox.
 */
export const sendQuoteIntroductionEmailWorkflow = createWorkflow(
  { name: "send-quote-introduction-email", store: true },
  (input: { email: string; data: QuoteIntroductionEmailData }) => {
    const templateData = fetchEmailTemplateStep({
      templateKey: QUOTE_INTRODUCTION_TEMPLATE_KEY,
      data: input.data as unknown as Record<string, any>,
    })

    const payload = transform({ input, templateData }, (d) => ({
      to: d.input.email,
      template: QUOTE_INTRODUCTION_TEMPLATE_KEY,
      channel: "email",
      data: d.input.data as unknown as Record<string, any>,
      templateData: d.templateData,
    }))

    // Returned, not fired and forgotten: the caller has to be able to tell a
    // real send from a SUPPRESSED one — a known crawler address makes every
    // provider return a synthetic id without mailing anything (#1333), and
    // "suppressed" must never read as "sent".
    const sent = sendNotificationEmailStep(payload as any)

    return new WorkflowResponse(sent)
  }
)

export default sendQuoteIntroductionEmailWorkflow
