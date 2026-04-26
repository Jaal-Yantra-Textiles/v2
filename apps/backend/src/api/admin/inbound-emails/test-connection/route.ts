import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ImapFlow } from "imapflow"
import type { TestConnectionBody } from "../validators"

/**
 * POST /admin/inbound-emails/test-connection
 *
 * Tests an IMAP connection with the provided credentials.
 * Does not store anything — purely for validation.
 */
export const POST = async (
  req: MedusaRequest<TestConnectionBody>,
  res: MedusaResponse
) => {
  const { host, port, user, password, tls, mailbox } = req.validatedBody

  const client = new ImapFlow({
    host,
    port: port || 993,
    secure: tls !== false,
    auth: { user, pass: password },
    logger: false,
  })

  try {
    await client.connect()

    // Try to open the mailbox to verify access
    const mailboxInfo = await client.getMailboxLock(mailbox || "INBOX")
    const messageCount = Number((client.mailbox as any)?.exists ?? 0)
    mailboxInfo.release()

    await client.logout()

    return res.json({
      success: true,
      message: `Connected successfully. ${messageCount} messages in ${mailbox || "INBOX"}.`,
      mailbox: mailbox || "INBOX",
      message_count: messageCount,
    })
  } catch (err: any) {
    // Ensure client is cleaned up
    try {
      await client.logout()
    } catch {}

    return res.status(400).json({
      success: false,
      error: err.message || "Connection failed",
    })
  }
}
