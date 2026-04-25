import { AbstractNotificationProviderService } from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Audit-only Notification Module Provider for the `whatsapp` channel.
 *
 * The actual WhatsApp send happens upstream (in
 * `src/modules/social-provider/whatsapp-service.ts`) — this provider is
 * here only so callers can persist a notification row via
 * `notificationModuleService.createNotifications({ channel: "whatsapp", … })`
 * **after** a successful upstream send.
 *
 * Convention is identical to `maileroo` and `mailjet` providers in this
 * codebase (see `src/modules/maileroo/service.ts:99` and
 * `src/modules/mailjet/service.ts:89`): callers set
 * `data._already_sent: true` and `data._external_id: <wamid>` in the
 * createNotifications payload. This provider then short-circuits, doing
 * no network call, just returning the external id so the framework
 * stamps it onto the notification row's `external_id` column.
 *
 * Without `_already_sent: true`, this provider refuses to send (returns
 * a synthesized id and logs a warning). It must never be the only path
 * to delivering a WhatsApp message — that's not what it's for.
 */
class WhatsappAuditNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "whatsapp-audit"
  protected readonly logger: Logger

  constructor({ logger }: InjectedDependencies, _options: Record<string, unknown> = {}) {
    super()
    this.logger = logger
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const data = (notification.data ?? {}) as Record<string, unknown>

    if (data?._already_sent) {
      const externalId =
        typeof data._external_id === "string" && data._external_id.length > 0
          ? data._external_id
          : `wa-audit-${Date.now()}`
      this.logger.info(
        `WhatsappAudit: recorded notification for ${notification.to} (wamid: ${externalId})`
      )
      return { id: String(externalId) }
    }

    // Should never happen in our flow — every WhatsApp send goes through
    // the WhatsAppService and writes the audit AFTER Meta has accepted.
    this.logger.warn(
      `WhatsappAudit: send() called without _already_sent=true for ${notification.to} — ` +
        "this provider does not actually send WhatsApp messages. Use WhatsAppService instead."
    )
    return { id: `wa-audit-noop-${Date.now()}` }
  }
}

export default WhatsappAuditNotificationProviderService
