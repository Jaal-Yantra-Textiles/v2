import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { listGoogleAdsConversionActionsWorkflow } from "../../../../../../../workflows/google-ads/list-conversion-actions"

/**
 * GET /admin/social-platforms/:id/google/ads/conversion-actions?customer_id=...
 *
 * Live GAQL pull of `conversion_action` rows for one CID. Used by the
 * upload-defaults picker — operators can't be expected to memorize Google
 * resource names like `customers/1234567890/conversionActions/9876543`.
 *
 * `customer_id` is required: conversion actions are scoped per CID, and
 * iterating across all bound CIDs would be expensive and rarely what the
 * caller wants.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req.query?.customer_id as string)?.trim()
  if (!customerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "customer_id query param is required"
    )
  }

  const { result } = await listGoogleAdsConversionActionsWorkflow(
    req.scope
  ).run({
    input: {
      platform_id: req.params.id,
      customer_id: customerId,
    },
  })

  res.status(200).json(result)
}
