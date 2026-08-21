import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  validatePartnerBlockOwnership,
  triggerStorefrontRevalidate,
} from "../../../../helpers"
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
  const { website } = await validatePartnerBlockOwnership(
    req.auth_context,
    req.params.pageId,
    req.params.blockId,
    req.scope
  )

  const { result } = await updateBlockWorkflow(req.scope).run({
    input: {
      ...(req.validatedBody as any),
      block_id: req.params.blockId,
      page_id: req.params.pageId,
    },
  })

  const revalidation = await triggerStorefrontRevalidate(website, {
    paths: ["/"],
  })

  res.json({ block: result, revalidation })
}

/**
 * DELETE /partners/storefront/pages/:pageId/blocks/:blockId
 * Delete a block.
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { website } = await validatePartnerBlockOwnership(
    req.auth_context,
    req.params.pageId,
    req.params.blockId,
    req.scope
  )

  const { result } = await deleteBlockWorkflow(req.scope).run({
    input: { block_id: req.params.blockId },
  })

  await triggerStorefrontRevalidate(website, { paths: ["/"] })

  res.json(result)
}
