import MailjetNotificationProviderService from "./service"
import type { BulkEmailEntry, BulkSendResult } from "./service"

// Re-export types for convenience
export type { BulkEmailEntry, BulkSendResult, BulkSendSuccess } from "./service"

/**
 * Create a Mailjet provider instance for bulk sending.
 *
 * Since the Mailjet provider is registered as a notification ModuleProvider
 * (not a standalone module), it can't be resolved from the DI container
 * directly. This helper creates an instance using the same env vars
 * that medusa-config passes to the provider.
 */
export function createMailjetBulkSender(logger?: any): MailjetNotificationProviderService {
  const noop = { info: () => {}, warn: () => {}, error: () => {} }
  return new MailjetNotificationProviderService(
    { logger: logger || noop } as any,
    {
      api_key: process.env.MAILJET_API_KEY!,
      secret_key: process.env.MAILJET_SECRET_KEY!,
      from_email: process.env.MAILJET_FROM_EMAIL!,
      from_name: process.env.MAILJET_FROM_NAME || "Jaal Yantra Textiles",
    }
  )
}

/**
 * Convenience wrapper — creates a one-shot instance and calls sendBulk.
 */
export async function sendMailjetBulk(
  entries: BulkEmailEntry[],
  logger?: any
): Promise<BulkSendResult> {
  const sender = createMailjetBulkSender(logger)
  return sender.sendBulk(entries)
}
