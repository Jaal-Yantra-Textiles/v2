/**
 * GET /partners/notifications
 *
 * Lists the bell feed for the authenticated partner. Notifications are
 * scoped via `receiver_id = partner.id`, which is a first-class field
 * on Medusa's standard notification entity (confirmed in MCP — see PR
 * #185 thread). No custom model required.
 *
 * Each row is annotated with `is_unread` relative to the partner's
 * `metadata.notifications_last_seen_at` timestamp so the bell can render
 * unread badges without a separate fetch per row.
 *
 * Query params:
 *   limit, offset       — pagination (default 20 / 0)
 *   q                   — free-text search (delegated to query.graph)
 *   channel             — e.g. "feed" / "email" / "whatsapp"
 *   trigger_type        — filter by producing event
 *   resource_type       — filter by what the row is about
 *   only_unread         — "true" returns only unread rows
 */

import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { resolvePartnerForNotifications } from "./helpers"

const NOTIFICATION_FIELDS = [
  "id",
  "to",
  "channel",
  "template",
  "external_id",
  "provider_id",
  "trigger_type",
  "resource_type",
  "resource_id",
  "receiver_id",
  "data",
  "created_at",
] as const

const parseBool = (v: unknown): boolean =>
  v === "true" || v === "1" || v === true

const parseInteger = (v: unknown, fallback: number): number => {
  if (v === undefined || v === null || v === "") return fallback
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const partner = await resolvePartnerForNotifications(
    req.auth_context,
    req.scope,
  )

  const limit = Math.min(parseInteger(req.query.limit, 20), 100)
  const offset = parseInteger(req.query.offset, 0)
  const onlyUnread = parseBool(req.query.only_unread)

  const filters: Record<string, any> = { receiver_id: partner.id }
  if (typeof req.query.channel === "string" && req.query.channel.trim()) {
    filters.channel = req.query.channel.trim()
  }
  if (
    typeof req.query.trigger_type === "string" &&
    req.query.trigger_type.trim()
  ) {
    filters.trigger_type = req.query.trigger_type.trim()
  }
  if (
    typeof req.query.resource_type === "string" &&
    req.query.resource_type.trim()
  ) {
    filters.resource_type = req.query.resource_type.trim()
  }
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    filters.q = req.query.q.trim()
  }
  if (onlyUnread) {
    filters.created_at = { $gt: partner.last_seen_at }
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data, metadata } = await query.graph({
    entity: "notifications",
    fields: NOTIFICATION_FIELDS as unknown as string[],
    filters,
    pagination: {
      skip: offset,
      take: limit,
      order: { created_at: "DESC" },
    },
  })

  const lastSeenMs = new Date(partner.last_seen_at).getTime()
  const annotated = ((data as any[]) || []).map((n: any) => ({
    ...n,
    is_unread: new Date(n.created_at).getTime() > lastSeenMs,
  }))

  return res.status(200).json({
    notifications: annotated,
    count: (metadata as any)?.count ?? annotated.length,
    offset,
    limit,
    last_seen_at: partner.last_seen_at,
  })
}
