import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { getPartnerWebsite } from "../helpers"
import { createPageWorkflow } from "../../../../workflows/website/website-page/create-page"
import { listPageWorkflow } from "../../../../workflows/website/website-page/list-page"

/**
 * GET /partners/storefront/pages
 * List all pages for the partner's website.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { website } = await getPartnerWebsite(req.auth_context, req.scope)

  const { q, status, page_type } = req.query
  const offset = parseInt(req.query.offset as string) || 0
  const limit = parseInt(req.query.limit as string) || 20

  const { result } = await listPageWorkflow(req.scope).run({
    input: {
      website_id: website.id,
      filters: {
        website_id: website.id,
        title: q,
        status,
        page_type,
      },
      config: {
        skip: offset,
        take: limit,
      },
    },
  })

  const [pages, count] = result

  res.json({
    pages,
    count,
    offset,
    limit,
    hasMore: offset + pages.length < count,
  })
}

/**
 * POST /partners/storefront/pages
 * Create a page for the partner's website.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { website } = await getPartnerWebsite(req.auth_context, req.scope)

  const { result } = await createPageWorkflow(req.scope).run({
    input: {
      ...req.validatedBody as any,
      website_id: website.id,
      genMetaDataLLM: (req.validatedBody as any).genMetaDataLLM || false,
    },
  })

  res.status(201).json({ page: result })
}
