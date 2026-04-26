/**
 * GET /admin/abandoned-carts/:id
 *
 * Returns the full cart payload plus a precomputed recovery URL so the
 * admin UI can show line items, addresses, customer info, and a
 * one-click "copy recovery link" action.
 *
 * The recovery URL convention matches the one used by design-orders
 * (`apps/backend/src/api/admin/designs/orders/[lineItemId]/route.ts`):
 *   ${STORE_URL}/checkout/cart/${cart_id}
 */

import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

const DETAIL_FIELDS = [
  "id",
  "email",
  "customer_id",
  "region_id",
  "sales_channel_id",
  "currency_code",
  "completed_at",
  "created_at",
  "updated_at",
  "metadata",
  "items.*",
  "items.adjustments.*",
  "items.tax_lines.*",
  "shipping_address.*",
  "billing_address.*",
  "shipping_methods.*",
  "promotions.*",
  "customer.id",
  "customer.email",
  "customer.first_name",
  "customer.last_name",
  "customer.phone",
  "region.id",
  "region.name",
  "region.currency_code",
  "sales_channel.id",
  "sales_channel.name",
] as const

const buildRecoveryUrl = (cartId: string) => {
  const storeUrl = process.env.STORE_URL || "https://cicilabel.com"
  return `${storeUrl}/checkout/cart/${cartId}`
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data } = await query.graph({
    entity: "cart",
    fields: DETAIL_FIELDS as unknown as string[],
    filters: { id },
  })

  const cart = (data as any[])[0]

  if (!cart) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${id} not found`)
  }

  const items = Array.isArray(cart.items) ? cart.items : []
  const itemsCount = items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0)
  const subtotal = items.reduce(
    (sum: number, i: any) => sum + (Number(i.unit_price) || 0) * (i.quantity || 0),
    0,
  )

  res.status(200).json({
    abandoned_cart: {
      ...cart,
      items_count: itemsCount,
      items_subtotal: subtotal,
      idle_minutes: Math.max(
        0,
        Math.round((Date.now() - new Date(cart.updated_at).getTime()) / 60000),
      ),
      recovery_url: buildRecoveryUrl(cart.id),
      is_completed: Boolean(cart.completed_at),
    },
  })
}
