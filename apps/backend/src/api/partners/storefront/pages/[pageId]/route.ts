import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { validatePartnerPageOwnership } from "../../helpers"
import { updatePageWorkflow } from "../../../../../workflows/website/website-page/update-page"
import { deletePageWorkflow } from "../../../../../workflows/website/website-page/delete-page"

/**
 * GET /partners/storefront/pages/:pageId
 * Get a single page with its blocks.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { page } = await validatePartnerPageOwnership(
    req.auth_context,
    req.params.pageId,
    req.scope
  )

  res.json({ page })
}

/**
 * PUT /partners/storefront/pages/:pageId
 * Update a page.
 */
export const PUT = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { website } = await validatePartnerPageOwnership(
    req.auth_context,
    req.params.pageId,
    req.scope
  )

  const { result } = await updatePageWorkflow(req.scope).run({
    input: {
      ...(req.validatedBody as any),
      id: req.params.pageId,
      website_id: website.id,
    },
  })

  res.json({ page: result })
}

/**
 * DELETE /partners/storefront/pages/:pageId
 * Delete a page.
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerPageOwnership(
    req.auth_context,
    req.params.pageId,
    req.scope
  )

  const { result } = await deletePageWorkflow(req.scope).run({
    input: { id: req.params.pageId },
  })

  res.json(result)
}
