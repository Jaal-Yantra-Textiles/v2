import { MedusaError, Modules } from "@medusajs/framework/utils"
import { updateSalesChannelsWorkflow } from "@medusajs/medusa/core-flows"

export type SetStoreDisabledResult = {
  store_id: string
  sales_channel_id: string
  disabled: boolean
  sales_channel: unknown
}

/**
 * Disable or re-enable a store's storefront.
 *
 * A store has no "disabled" flag of its own — its storefront is its
 * `default_sales_channel_id` → publishable key → products. Disabling the store
 * means disabling that sales channel (`is_disabled`), which is Medusa's native
 * "this channel is off" switch. Deleting the store/channel is the partner-delete
 * cascade's job; this is the reversible "off, not gone".
 */
export async function setStoreDisabled(
  scope: any,
  storeId: string,
  disabled: boolean
): Promise<SetStoreDisabledResult> {
  const storeService: any = scope.resolve(Modules.STORE)
  const [store] = await storeService.listStores({ id: storeId })
  if (!store) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Store ${storeId} not found`
    )
  }

  const channelId = store.default_sales_channel_id
  if (!channelId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Store ${storeId} has no default sales channel to disable`
    )
  }

  const { result } = await updateSalesChannelsWorkflow(scope).run({
    input: {
      selector: { id: channelId },
      update: { is_disabled: disabled },
    },
  })

  return {
    store_id: storeId,
    sales_channel_id: channelId,
    disabled,
    sales_channel: result,
  }
}