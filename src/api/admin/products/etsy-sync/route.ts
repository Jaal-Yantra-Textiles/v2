import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { syncProductsToEtsyWorkflow } from "../../../../workflows/etsy_sync"

export type AdminSyncProductsToEtsyReq = {
  product_ids: string[]
  etsy_account_id: string
}

export const POST = async (
  req: MedusaRequest<AdminSyncProductsToEtsyReq>,
  res: MedusaResponse
) => {
  const { product_ids, etsy_account_id } = req.body || ({} as any)

  if (!product_ids?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No products were provided for Etsy sync"
    )
  }

  if (!etsy_account_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "etsy_account_id is required for Etsy sync"
    )
  }

  const { result, transaction } = await syncProductsToEtsyWorkflow(
    req.scope
  ).run({
    input: {
      product_ids,
      etsy_account_id,
    },
  })

  res.status(202).json({
    transaction_id: transaction.transactionId,
    summary: result,
  })
}
