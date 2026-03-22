import Mailjet from "node-mailjet"

const MAILJET_BATCH_SIZE = 50

export type BulkEmailEntry = {
  to: string
  subject: string
  htmlContent: string
}

export type BulkSendSuccess = {
  email: string
  messageId: string
  messageUuid: string
  status: string
}

export type BulkSendResult = {
  successful: BulkSendSuccess[]
  failed: { email: string; error: string }[]
}

/**
 * Send emails in bulk via Mailjet's v3.1 API.
 * Chunks into groups of 50 (Mailjet's per-call limit) and sends each chunk
 * as a single API call with multiple Messages.
 *
 * Returns full Mailjet response metadata (MessageID, MessageUUID, Status)
 * for each successful send so callers can store it in notification records.
 */
export async function sendMailjetBulk(
  entries: BulkEmailEntry[]
): Promise<BulkSendResult> {
  const client = Mailjet.apiConnect(
    process.env.MAILJET_API_KEY!,
    process.env.MAILJET_SECRET_KEY!
  )
  const fromEmail = process.env.MAILJET_FROM_EMAIL!
  const fromName = process.env.MAILJET_FROM_NAME || "Jaal Yantra Textiles"

  const successful: BulkSendSuccess[] = []
  const failed: { email: string; error: string }[] = []

  for (let i = 0; i < entries.length; i += MAILJET_BATCH_SIZE) {
    const batch = entries.slice(i, i + MAILJET_BATCH_SIZE)

    const messages = batch.map((entry) => ({
      From: { Email: fromEmail, Name: fromName },
      To: [{ Email: entry.to }],
      Subject: entry.subject,
      HTMLPart: entry.htmlContent,
    }))

    try {
      const result = await client
        .post("send", { version: "v3.1" })
        .request({ Messages: messages })

      const body = result.body as any
      const responseMessages = body?.Messages || []

      for (let j = 0; j < responseMessages.length; j++) {
        const msg = responseMessages[j]
        if (msg.Status === "error") {
          failed.push({
            email: batch[j].to,
            error: msg.Errors?.[0]?.ErrorMessage || "Unknown Mailjet error",
          })
        } else {
          const recipient = msg.To?.[0] || {}
          successful.push({
            email: batch[j].to,
            messageId: String(recipient.MessageID || ""),
            messageUuid: String(recipient.MessageUUID || ""),
            status: msg.Status || "success",
          })
        }
      }
    } catch (error) {
      // Entire batch failed
      for (const entry of batch) {
        failed.push({
          email: entry.to,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Small delay between batch API calls to avoid rate limiting
    if (i + MAILJET_BATCH_SIZE < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }

  return { successful, failed }
}
