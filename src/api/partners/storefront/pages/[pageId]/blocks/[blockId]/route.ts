import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { validatePartnerBlockOwnership } from "../../../../helpers"
import { updateBlockWorkflow } from "../../../../../../../workflows/website/page-blocks/update-block"
import { deleteBlockWorkflow } from "../../../../../../../workflows/website/page-blocks/delete-block"

/**
 * GET /partners/storefront/pages/:pageId/blocks/:blockId
 * Get a single block.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { block } = await validatePartnerBlockOwnership(
    req.auth_context,
    req.params.pageId,
    req.params.blockId,
    req.scope
  )

  res.json({ block })
}

/**
 * PUT /partners/storefront/pages/:pageId/blocks/:blockId
 * Update a block.
 */
export const PUT = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerBlockOwnership(
    req.auth_context,
    req.params.pageId,
    req.params.blockId,
    req.scope
  )

  const { result } = await updateBlockWorkflow(req.scope).run({
    input: {
      ...(req.validatedBody as any),
      id: req.params.blockId,
      page_id: req.params.pageId,
    },
  })

  res.json({ block: result })
}

/**
 * DELETE /partners/storefront/pages/:pageId/blocks/:blockId
 * Delete a block.
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerBlockOwnership(
    req.auth_context,
    req.params.pageId,
    req.params.blockId,
    req.scope
  )

  const { result } = await deleteBlockWorkflow(req.scope).run({
    input: { block_id: req.params.blockId },
  })

  res.json(result)
}
