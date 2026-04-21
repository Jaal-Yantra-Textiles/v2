import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Button, Container, Heading, StatusBadge, Text, toast, Tooltip } from "@medusajs/ui"
import { ShoppingCart } from "@medusajs/icons"
import {
  useGoogleMerchantAccounts,
  useSyncProductToGoogleMerchant,
  useUnsyncProductFromGoogleMerchant,
  useTakeoverProductFromGoogleMerchant,
  useProductGoogleMerchantStatus,
  type ProductAccountSyncStatus,
} from "../hooks/api/google-merchant"
import { useNavigate } from "react-router-dom"

type AdminProduct = { id: string; title?: string }

const STATUS_COLORS: Record<string, "green" | "orange" | "red" | "grey"> = {
  synced: "green",
  pending: "orange",
  failed: "red",
  not_synced: "grey",
}

const STATUS_LABELS: Record<string, string> = {
  synced: "Synced",
  pending: "Pending",
  failed: "Failed",
  not_synced: "Not synced",
}

const ProductGoogleMerchantWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const navigate = useNavigate()
  const { accounts, isLoading: accountsLoading } = useGoogleMerchantAccounts({ limit: 50 })
  const { links, isLoading: statusLoading } = useProductGoogleMerchantStatus(data?.id)
  const syncMutation = useSyncProductToGoogleMerchant()
  const unsyncMutation = useUnsyncProductFromGoogleMerchant()
  const takeoverMutation = useTakeoverProductFromGoogleMerchant()

  const byAccount = new Map<string, ProductAccountSyncStatus>(
    links.map((l) => [l.account_id, l])
  )
  const connectedAccounts = accounts.filter((a) => a.connected)

  const handleSync = async (accountId: string) => {
    try {
      const result = await syncMutation.mutateAsync({ account_id: accountId, product_id: data.id })
      if (result.success) toast.success("Synced to Google Merchant")
    } catch (err: any) {
      toast.error(err?.message || "Sync failed")
    }
  }

  const handleUnsync = async (accountId: string) => {
    if (!confirm("Remove this product from Google Merchant Center?")) return
    try {
      await unsyncMutation.mutateAsync({ account_id: accountId, product_id: data.id })
      toast.success("Removed from Google Merchant")
    } catch (err: any) {
      toast.error(err?.message || "Unsync failed")
    }
  }

  const handleTakeover = async (accountId: string) => {
    if (!confirm(
      "Take over this listing from Merchant Center UI? We'll try to delete the original and re-create it via the API. If the delete fails you'll need to remove the original manually in Merchant Center."
    )) return
    try {
      const result = await takeoverMutation.mutateAsync({ account_id: accountId, product_id: data.id })
      if (result.takeover.warning) {
        toast.warning(result.takeover.warning)
      } else {
        toast.success("Listing taken over — now managed via API")
      }
    } catch (err: any) {
      toast.error(err?.message || "Takeover failed")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <ShoppingCart />
          <Heading level="h2">Google Merchant</Heading>
        </div>
        <Button size="small" variant="transparent" onClick={() => navigate("/settings/google-merchant")}>
          Manage accounts
        </Button>
      </div>

      <div className="px-6 py-4">
        {accountsLoading || statusLoading ? (
          <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col gap-y-2">
            <Text size="small" className="text-ui-fg-subtle">No Google Merchant accounts configured yet.</Text>
            <Button size="small" variant="secondary" onClick={() => navigate("/settings/google-merchant/create")}>
              Add account
            </Button>
          </div>
        ) : connectedAccounts.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No accounts connected. Visit Google Merchant settings to authorize.
          </Text>
        ) : (
          <div className="flex flex-col gap-y-3">
            {connectedAccounts.map((account) => {
              const link = byAccount.get(account.id)
              const status = link?.sync_status || "not_synced"
              const isSyncing = syncMutation.isPending && syncMutation.variables?.account_id === account.id
              const isUnsyncing = unsyncMutation.isPending && unsyncMutation.variables?.account_id === account.id
              const isTakingOver = takeoverMutation.isPending && takeoverMutation.variables?.account_id === account.id
              const hasGoogleProduct = !!link?.google_product_id
              const externallyManaged = !!link?.externally_managed

              return (
                <div key={account.id} className="flex items-start justify-between gap-x-3">
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-x-2">
                      <Text size="small" weight="plus" className="truncate">
                        {account.name}
                      </Text>
                      <StatusBadge color={STATUS_COLORS[status] ?? "grey"}>
                        {STATUS_LABELS[status] ?? status}
                      </StatusBadge>
                      {externallyManaged && (
                        <StatusBadge color="blue">Merchant Center UI</StatusBadge>
                      )}
                    </div>
                    <Text size="xsmall" className="text-ui-fg-subtle truncate">
                      {account.account_email || `ID ${account.merchant_id}`}
                    </Text>
                    {externallyManaged && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Imported from a non-API data source. Take over to manage via Medusa, or keep editing in Merchant Center.
                      </Text>
                    )}
                    {link?.last_synced_at && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Last synced: {new Date(link.last_synced_at).toLocaleString()}
                      </Text>
                    )}
                    {link?.sync_error && status === "failed" && (
                      <Tooltip content={link.sync_error}>
                        <Text size="xsmall" className="text-ui-fg-error truncate max-w-[260px]">
                          {link.sync_error}
                        </Text>
                      </Tooltip>
                    )}
                    {link?.google_product_id && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Offer ID: {link.google_product_id}
                      </Text>
                    )}
                  </div>
                  <div className="flex items-center gap-x-2 shrink-0">
                    {externallyManaged ? (
                      <Button
                        size="small"
                        variant="primary"
                        onClick={() => handleTakeover(account.id)}
                        isLoading={isTakingOver}
                      >
                        Take over
                      </Button>
                    ) : (
                      <>
                        <Button size="small" variant="secondary" onClick={() => handleSync(account.id)} isLoading={isSyncing}>
                          {hasGoogleProduct ? "Re-sync" : "Sync"}
                        </Button>
                        {hasGoogleProduct && (
                          <Button
                            size="small"
                            variant="danger"
                            onClick={() => handleUnsync(account.id)}
                            isLoading={isUnsyncing}
                          >
                            Remove
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default ProductGoogleMerchantWidget
