import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { INBOUND_EMAIL_MODULE } from "../../../../modules/inbound_emails"
import { emailBodyText } from "../../../../workflows/inbound-emails/lib/email-text"
import { linkedInventoryOrderIds } from "../../../../workflows/inbound-emails/lib/inbound-email-links"

/**
 * One email, with `body_text` (the body as readable text, table rows kept as
 * lines) and the inventory orders it already became (#2377 S3).
 *
 * `?body=text` leaves out `html_body` and `text_body` — what the assistant
 * reads, since a shop email's HTML is tens of kB of markup around a few lines.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  const service = req.scope.resolve(INBOUND_EMAIL_MODULE) as any

  const inbound_email = await service.retrieveInboundEmail(id).catch(() => null)

  if (!inbound_email) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inbound email ${id} not found`)
  }

  const { text, truncated } = emailBodyText(inbound_email)
  const inventory_order_ids = (await linkedInventoryOrderIds(req.scope, [id])).get(id) ?? []
  const textOnly = (req.query as Record<string, unknown>)?.body === "text"

  const { html_body, text_body, ...rest } = inbound_email
  res.status(200).json({
    inbound_email: {
      ...(textOnly ? rest : inbound_email),
      body_text: text,
      body_truncated: truncated,
      inventory_order_ids,
    },
  })
}
