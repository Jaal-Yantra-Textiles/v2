import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../../../helpers"
import { LinkDefinition } from "@medusajs/framework/types"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: storeId, channelId } = req.params
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    storeId,
    req.scope
  )

  if (store.default_sales_channel_id !== channelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Sales channel ${channelId} not found for this store`
    )
  }

  const { add, remove } = req.body as {
    add?: string[]
    remove?: string[]
  }

  const remoteLink = req.scope.resolve("remoteLink")

  // Operand order is part of the link's identity: the product <-> sales_channel
  // link is defined product-first, and remoteLink looks it up by (from, to).
  // Passing sales_channel first threw "Module to type sales_channel and product
  // ... was not found", a 500 on every add and every remove, so this endpoint
  // has never attached or detached a single product. Matches core-flows'
  // associateProductsWithSalesChannelsStep.
  const linkFor = (productId: string): LinkDefinition => ({
    [Modules.PRODUCT]: { product_id: productId },
    [Modules.SALES_CHANNEL]: { sales_channel_id: channelId },
  })

  if (add?.length) {
    await remoteLink.create(add.map(linkFor))
  }

  if (remove?.length) {
    await remoteLink.dismiss(remove.map(linkFor))
  }

  res.json({ sales_channel: { id: channelId } })
}
