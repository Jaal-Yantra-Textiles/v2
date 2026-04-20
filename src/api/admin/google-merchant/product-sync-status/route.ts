import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const product_id = req.query.product_id as string
  if (!product_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "product_id query parameter is required")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>

  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "google_merchant_account.id",
      "google_merchant_account.name",
      "google_merchant_account.merchant_id",
      "google_merchant_account.is_active",
      "google_merchant_account.account_email",
    ],
    filters: { id: product_id },
  })

  const product = data?.[0] as any
  const accounts = (product?.google_merchant_account || []) as any[]

  res.status(200).json({
    product_id,
    links: accounts.map((a: any) => ({
      account_id: a.id,
      account_name: a.name,
      merchant_id: a.merchant_id,
      account_email: a.account_email,
      connected: a.is_active,
    })),
  })
}
