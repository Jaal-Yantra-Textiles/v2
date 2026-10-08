import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  listPlatformMailboxes,
  setPlatformMailboxes,
} from "../../../../workflows/inbound-emails/lib/mailbox-admin"
import { SetInboundMailboxesBody } from "../validators"

/**
 * #2377 — the email account's folders, and which the Inbox reads.
 * GET lists them (live from the account); POST saves the chosen set.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platformId = (req.query as Record<string, string | undefined>)?.platform_id
  res.status(200).json(await listPlatformMailboxes(req.scope, platformId))
}

export const POST = async (req: MedusaRequest<SetInboundMailboxesBody>, res: MedusaResponse) => {
  const { platform_id, mailboxes } = req.validatedBody
  res.status(200).json(await setPlatformMailboxes(req.scope, platform_id, mailboxes))
}
