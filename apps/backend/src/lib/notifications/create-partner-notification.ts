import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type {
  INotificationModuleService,
  Logger,
} from "@medusajs/framework/types"

/**
 * Create a feed-channel notification scoped to a partner.
 *
 * Produces a row that the partner notification bell (GET /partners/notifications)
 * picks up via `receiver_id = partner.id`. The standard Medusa notification
 * entity already has `receiver_id` as a first-class, filterable field — see
 * MCP confirmation in PR #185 thread — so we don't need a separate model.
 *
 * Failures are logged and swallowed. Notifications are observability, not
 * causal: never block the producing workflow on a failed audit row.
 *
 * Mirrors `recordWhatsappNotification` (modules/messaging/lib) — same
 * tolerance, same shape, just defaulted to channel=feed for in-app display.
 */
export type CreatePartnerNotificationInput = {
  /** Partner uuid. Stored on notification.receiver_id and used as the bell scope. */
  partner_id: string
  /**
   * Title shown in the bell. Goes into `data.title` so the bell renderer
   * can read it without a join. Required.
   */
  title: string
  /** Body text shown under the title. Goes into `data.description`. */
  description?: string | null
  /** Optional URL the bell entry links to (e.g. /production-runs/<id>). */
  url?: string | null
  /**
   * What the notification is about. Useful for filtering in the UI.
   * Examples: "production_run", "order", "payment_submission".
   */
  resource_type?: string | null
  resource_id?: string | null
  /**
   * Event/workflow that produced this notification. Examples:
   * "production_run.assigned", "order.placed", "payment.approved".
   */
  trigger_type?: string | null
  /**
   * Stable dedup key. Pass the same value when re-running a workflow that
   * shouldn't double-notify (e.g. reminder cron jobs).
   */
  idempotency_key?: string | null
  /**
   * Free-form extra data merged onto notification.data alongside title/
   * description/url. Use for renderer-specific bits (icon, severity, etc.).
   */
  data?: Record<string, unknown>
  /**
   * Override the channel. Defaults to "feed" for the in-app bell. Override
   * to "email" / "whatsapp" / etc. only when you specifically want a
   * partner-scoped notification on another channel.
   */
  channel?: string
  /**
   * Recipient identifier for the channel. For feed, default is the
   * partner_id (acts as a routing key). For email, pass the email address.
   */
  to?: string
  /**
   * Template id when the channel needs one (email/whatsapp). Feed
   * notifications don't need a template — leave empty.
   */
  template?: string
}

/**
 * @returns true if the row was created (or de-duped), false on failure.
 */
export async function createPartnerNotification(
  scope: any,
  input: CreatePartnerNotificationInput
): Promise<boolean> {
  const logger: Logger | null = (() => {
    try {
      return scope.resolve(ContainerRegistrationKeys.LOGGER) as Logger
    } catch {
      return null
    }
  })()

  if (!input.partner_id || !input.title) {
    logger?.warn(
      `[partner-notification] missing partner_id or title — refusing to create`
    )
    return false
  }

  let notificationService: INotificationModuleService
  try {
    notificationService = scope.resolve(
      Modules.NOTIFICATION
    ) as INotificationModuleService
  } catch (e: any) {
    logger?.warn(
      `[partner-notification] notification module not resolvable: ${e?.message}`
    )
    return false
  }

  const channel = input.channel ?? "feed"
  const to = input.to ?? input.partner_id

  const data: Record<string, unknown> = {
    ...(input.data ?? {}),
    title: input.title,
    description: input.description ?? null,
    url: input.url ?? null,
  }

  try {
    await notificationService.createNotifications({
      to,
      channel,
      template: input.template ?? "",
      data,
      trigger_type: input.trigger_type ?? undefined,
      resource_type: input.resource_type ?? undefined,
      resource_id: input.resource_id ?? undefined,
      receiver_id: input.partner_id,
      idempotency_key: input.idempotency_key ?? undefined,
    } as any)
    return true
  } catch (e: any) {
    logger?.warn(
      `[partner-notification] create failed (partner=${input.partner_id} trigger=${input.trigger_type ?? "?"}): ${e?.message}`
    )
    return false
  }
}
