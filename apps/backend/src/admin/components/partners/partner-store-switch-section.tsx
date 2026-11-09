import { Badge, Button, Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import {
  usePartnerStoreState,
  useSetPartnerStoreEnabled,
  type PartnerStoreState,
} from "../../hooks/api/storefront"

/**
 * Switch a partner's store on or off (#2527).
 *
 * Off = the store's default sales channel is disabled, so its products stop
 * being purchasable. Nothing is deleted and it switches back on. Deleting the
 * store is `DELETE /admin/partners/:id/storefront`, kept out of this panel on
 * purpose: on/off is everyday, deletion is not.
 */
export const PartnerStoreSwitchSection = ({ partnerId }: { partnerId: string }) => {
  const { data: stores, isPending, isError } = usePartnerStoreState(partnerId)
  const { mutateAsync: setEnabled, isPending: isSaving } =
    useSetPartnerStoreEnabled(partnerId)
  const prompt = usePrompt()

  const handleToggle = async (store: PartnerStoreState) => {
    const turningOff = store.is_disabled === false
    if (turningOff) {
      const confirmed = await prompt({
        title: "Turn the store off?",
        description: `${store.store_name ?? "This store"} stops selling: its products can no longer be bought. Nothing is deleted, and you can turn it back on.`,
        confirmText: "Turn off",
        cancelText: "Cancel",
      })
      if (!confirmed) return
    }

    try {
      await setEnabled({ storeId: store.store_id, enabled: !turningOff })
      toast.success(turningOff ? "Store turned off" : "Store turned on")
    } catch (e: any) {
      toast.error("Could not change the store", {
        description: e?.message,
      })
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Store</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Whether this partner's store is selling
        </Text>
      </div>

      {isPending ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
        </div>
      ) : isError ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Could not load the store
          </Text>
        </div>
      ) : !stores?.length ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            This partner has no store
          </Text>
        </div>
      ) : (
        stores.map((store) => (
          <div
            key={store.store_id}
            className="flex items-center justify-between gap-x-3 px-6 py-4"
          >
            <div className="flex min-w-0 items-center gap-x-2">
              <Text size="small" leading="compact" weight="plus" className="truncate">
                {store.store_name ?? store.store_id}
              </Text>
              {store.is_disabled === null ? (
                <Badge color="grey" size="2xsmall">No sales channel</Badge>
              ) : store.is_disabled ? (
                <Badge color="red" size="2xsmall">Off</Badge>
              ) : (
                <Badge color="green" size="2xsmall">On</Badge>
              )}
            </div>
            {store.is_disabled !== null && (
              <Button
                size="small"
                variant="secondary"
                onClick={() => handleToggle(store)}
                disabled={isSaving}
                isLoading={isSaving}
              >
                {store.is_disabled ? "Turn on" : "Turn off"}
              </Button>
            )}
          </div>
        ))
      )}
    </Container>
  )
}
