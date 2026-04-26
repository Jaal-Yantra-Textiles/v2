import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { validatePartnerPageOwnership } from "../../../helpers"
import { createBlockWorkflow } from "../../../../../../workflows/website/page-blocks/create-block"
import { createBatchBlocksWorkflow } from "../../../../../../workflows/website/page-blocks/create-batch-blocks"
import { listBlocksWorkflow } from "../../../../../../workflows/website/page-blocks/list-blocks"

/**
 * GET /partners/storefront/pages/:pageId/blocks
 * List blocks for a page.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerPageOwnership(
    req.auth_context,
    req.params.pageId,
    req.scope
  )

  const { result } = await listBlocksWorkflow(req.scope).run({
    input: { page_id: req.params.pageId },
  })

  res.json({
    blocks: result.blocks,
    count: result.count,
    offset: result.offset,
    limit: result.limit,
  })
}

/**
 * POST /partners/storefront/pages/:pageId/blocks
 * Create block(s) for a page. Supports single or batch.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerPageOwnership(
    req.auth_context,
    req.params.pageId,
    req.scope
  )

  const body = req.validatedBody as any
  const pageId = req.params.pageId

  if ("blocks" in body) {
    const { result } = await createBatchBlocksWorkflow(req.scope).run({
      input: {
        blocks: body.blocks.map((block: any) => ({
          ...block,
          page_id: pageId,
        })),
      },
    })

    if (result.errors.length > 0) {
      if (!result.created || result.created.length === 0) {
        return res.status(400).json({
          message: "Failed to create blocks",
          errors: result.errors,
        })
      }
      return res.status(207).json({
        message: "Some blocks created, some failed",
        blocks: result.created,
        errors: result.errors,
      })
    }

    return res.status(201).json({
      message: "All blocks created successfully",
      blocks: result.created,
    })
  }

  // Single block
  const { result } = await createBlockWorkflow(req.scope).run({
    input: {
      ...body,
      page_id: pageId,
    },
  })

  res.status(201).json({ block: result })
}
