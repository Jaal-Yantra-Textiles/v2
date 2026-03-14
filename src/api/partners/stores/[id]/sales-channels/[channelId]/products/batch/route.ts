import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../helpers"
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

  if (add?.length) {
    const links: LinkDefinition[] = add.map((productId) => ({
      [Modules.SALES_CHANNEL]: { sales_channel_id: channelId },
      [Modules.PRODUCT]: { product_id: productId },
    }))
    await remoteLink.create(links)
  }

  if (remove?.length) {
    const links: LinkDefinition[] = remove.map((productId) => ({
      [Modules.SALES_CHANNEL]: { sales_channel_id: channelId },
      [Modules.PRODUCT]: { product_id: productId },
    }))
    await remoteLink.dismiss(links)
  }

  res.json({ sales_channel: { id: channelId } })
}
