import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { INotificationModuleService, Logger } from "@medusajs/framework/types"

/**
 * Audit-write a `notification` row after a successful WhatsApp send.
 *
 * Call this immediately after the messaging_message row is persisted. The
 * notification row is a secondary, queryable audit copy — the operational
 * source of truth (with rich status timeline, conversation graph, inbound
 * messages, button-tap routing) stays in `messaging_message`.
 *
 * Routes to the `whatsapp` channel via the audit-only provider registered
 * in medusa-config — the provider is a no-op that just echoes back
 * `external_id`, so no second network call happens.
 *
 * Failures are logged and swallowed. The send already succeeded; the audit
 * row is best-effort. Reconciliation from `messaging_message` is always
 * possible if a row goes missing.
 */
export type RecordWhatsappNotificationInput = {
  /** Recipient phone in E.164 (matches messaging_message recipient). */
  to: string
  /** Meta wamid returned by the Graph API. Stored on notification.external_id. */
  wa_message_id?: string | null
  /**
   * Template name when the send used `mode: "template"`. For text/image/
   * interactive sends, leave undefined — the notification row will still
   * be created; `template` will be empty.
   */
  template?: string | null
  /** Partner uuid. Stored on notification.receiver_id. */
  partner_id?: string | null
  /**
   * What the message is about — mirrors the messaging_message
   * (context_type, context_id) pair. For run reminders/templates this is
   * `("production_run", "<run_id>")` (or the per-day suffixed id for
   * reminder events — same value the messaging_message stores).
   */
  resource_type?: string | null
  resource_id?: string | null
  /**
   * Event/workflow that initiated this send. e.g.
   * `"production_run.reminder_assignment_pending"`,
   * `"production_run.sent_to_partner"`, `"whatsapp_message_handler.consent"`.
   * Optional but very useful for analytics filters.
   */
  trigger_type?: string | null
  /**
   * Stable dedup key. The framework uses it to short-circuit duplicate
   * createNotifications calls. For reminders pass the same per-day
   * context_id we use elsewhere (`<run_id>:reminder:YYYY-MM-DD`); for
   * one-shot lifecycle templates pass `<run_id>:<event_suffix>`.
   * Optional — the framework will accept duplicates if omitted.
   */
  idempotency_key?: string | null
  /** Free-form payload mirrored to notification.data for analytics. */
  data?: Record<string, unknown>
}

export async function recordWhatsappNotification(
  scope: any,
  input: RecordWhatsappNotificationInput
): Promise<void> {
  const logger: Logger | null = (() => {
    try {
      return scope.resolve(ContainerRegistrationKeys.LOGGER) as Logger
    } catch {
      return null
    }
  })()

  if (!input.to) {
    return
  }

  let notificationService: INotificationModuleService
  try {
    notificationService = scope.resolve(Modules.NOTIFICATION) as INotificationModuleService
  } catch (e: any) {
    logger?.warn(
      `[whatsapp-audit] notification module not resolvable — skipping audit: ${e?.message}`
    )
    return
  }

  // The data payload that lands on notification.data. The
  // `_already_sent` + `_external_id` convention matches the maileroo /
  // mailjet providers — the audit provider's send() short-circuits on
  // _already_sent and returns _external_id so the framework stamps it
  // onto notification.external_id.
  const data: Record<string, unknown> = {
    ...(input.data ?? {}),
    _already_sent: true,
    _external_id: input.wa_message_id ?? null,
    template: input.template ?? null,
  }

  try {
    await notificationService.createNotifications({
      to: input.to,
      channel: "whatsapp",
      template: input.template ?? "",
      data,
      trigger_type: input.trigger_type ?? undefined,
      resource_type: input.resource_type ?? undefined,
      resource_id: input.resource_id ?? undefined,
      receiver_id: input.partner_id ?? undefined,
      idempotency_key: input.idempotency_key ?? undefined,
    } as any)
  } catch (e: any) {
    // Never block the send. The WhatsApp message has already been delivered
    // (or queued at Meta); the audit row is best-effort.
    logger?.warn(
      `[whatsapp-audit] notification create failed (run=${input.resource_id ?? "?"} wamid=${input.wa_message_id ?? "?"}): ${e?.message}`
    )
  }
}
