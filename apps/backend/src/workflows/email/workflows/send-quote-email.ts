import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { QUOTE_TEMPLATE_KEY } from "../../../scripts/seed-quote-email-template"
import type { QuoteEmailData } from "../../../modules/partner-quote/lib/quote-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { sendNotificationEmailStep } from "../steps/send-notification-email"

/**
 * Deliver the buyer's quote link (#1420).
 *
 * ## Why this is not optional plumbing
 *
 * 🔴 This email is the ONLY durable copy of the buyer link. The mint returns
 * the raw token exactly once and stores only its sha256, so a send that fails
 * leaves a quote that exists, prices a live price list, and is unreachable by
 * the person it was priced for. That is why `fetchEmailTemplateStep` throwing
 * on a missing template is the right behaviour here rather than an
 * inconvenience: an email sent from a provider default would carry no link at
 * all, and would look like a success.
 *
 * ## Channel
 *
 * `email` → Resend, the brand channel, not `email_partner` → Maileroo. The
 * designer invite is partner-facing and mails from the partner subdomain; this
 * is BUYER-facing and the template's own `from` is `sales@jaalyantra.com`. A
 * quote arriving from `partner@partner.jaalyantra.com` reads as internal mail
 * to a procurement inbox.
 *
 * The template's `from` wins over the channel default — every provider reads
 * `_template_from` — so the sender is whatever the seeded row says.
 */
export const sendQuoteEmailWorkflow = createWorkflow(
  { name: "send-quote-email", store: true },
  (input: { email: string; data: QuoteEmailData }) => {
    const templateData = fetchEmailTemplateStep({
      templateKey: QUOTE_TEMPLATE_KEY,
      data: input.data as unknown as Record<string, any>,
    })

    const payload = transform({ input, templateData }, (d) => ({
      to: d.input.email,
      template: QUOTE_TEMPLATE_KEY,
      channel: "email",
      data: d.input.data as unknown as Record<string, any>,
      templateData: d.templateData,
    }))

    // Returned, not fired and forgotten: the caller has to be able to tell a
    // real send from a SUPPRESSED one. `classifyRecipient` makes every provider
    // return a synthetic id for a known crawler address without mailing
    // anything (#1333) — a silent no-op that is correct for cart recovery and
    // catastrophic here, where nothing else carries the token.
    const sent = sendNotificationEmailStep(payload as any)

    return new WorkflowResponse(sent)
  }
)

export default sendQuoteEmailWorkflow
