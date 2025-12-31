import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { AdminNotificationsQueryParams } from "./validators"


export const GET = async (
  req: MedusaRequest<AdminNotificationsQueryParams>,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(
    ContainerRegistrationKeys.QUERY
  ) as Omit<RemoteQueryFunction, symbol>

  const {
    limit = 20,
    offset = 0,
    q,
    channel,
    status,
    fields,
    id,
  } = (req.validatedQuery || {}) as Partial<AdminNotificationsQueryParams>

  const selectedFields =
    typeof fields === "string" && fields.trim().length
      ? fields
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean)
      : [
          "id",
          "to",
          "channel",
          "template",
          "external_id",
          "provider_id",
          "created_at",
          "status",
          "data",
        ]

  const filters: Record<string, any> = {}

  if (q) {
    filters.q = q
  }

  if (channel) {
    filters.channel = channel
  }

  if (status) {
    filters.status = status
  }

  if (id) {
    filters.id = id
  }

  const { data, metadata } = await query.graph({
    entity: "notifications",
    fields: selectedFields,
    filters,
    pagination: {
      skip: offset,
      take: limit,
      order: {
        created_at: "DESC",
      },
    },
  })

  return res.status(200).json({
    notifications: data || [],
    count: metadata?.count ?? (data || []).length,
    offset,
    limit,
  })
}
