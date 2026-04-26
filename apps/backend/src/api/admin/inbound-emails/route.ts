import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INBOUND_EMAIL_MODULE } from "../../../modules/inbound_emails"
import { ListInboundEmailsQuery } from "./validators"

export const GET = async (
  req: MedusaRequest<ListInboundEmailsQuery>,
  res: MedusaResponse
) => {
  const query = req.validatedQuery as ListInboundEmailsQuery
  const service = req.scope.resolve(INBOUND_EMAIL_MODULE) as any

  const filters: Record<string, any> = {}
  if (query.status) filters.status = query.status
  if (query.from_address) filters.from_address = query.from_address
  if (query.folder) filters.folder = query.folder

  // Handle search
  if (query.q) {
    filters.$or = [
      { subject: { $like: `%${query.q}%` } },
      { from_address: { $like: `%${query.q}%` } },
    ]
  }

  const [inbound_emails, count] = await service.listAndCountInboundEmails(
    filters,
    {
      skip: query.offset,
      take: query.limit,
      order: { received_at: "DESC" },
      select: [
        "id",
        "imap_uid",
        "message_id",
        "from_address",
        "to_addresses",
        "subject",
        "folder",
        "received_at",
        "status",
        "action_type",
        "error_message",
        "created_at",
        "updated_at",
      ],
    }
  )

  res.status(200).json({
    inbound_emails,
    count,
    offset: query.offset,
    limit: query.limit,
  })
}
