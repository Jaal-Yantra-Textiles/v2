import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createPlatformMailbox } from "../../../../../workflows/inbound-emails/lib/mailbox-admin"
import { CreateInboundMailboxBody } from "../../validators"

/** #2377 — create a folder on the email account; the Inbox reads it unless `read: false`. */
export const POST = async (req: MedusaRequest<CreateInboundMailboxBody>, res: MedusaResponse) => {
  const { platform_id, name, read } = req.validatedBody
  res.status(200).json(await createPlatformMailbox(req.scope, platform_id, name, read))
}
