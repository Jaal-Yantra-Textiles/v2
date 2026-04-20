import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Button, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui"
import { ShoppingCart } from "@medusajs/icons"
import {
  useGoogleMerchantAccounts,
  useSyncProductToGoogleMerchant,
  useProductGoogleMerchantStatus,
} from "../hooks/api/google-merchant"
import { useNavigate } from "react-router-dom"

type AdminProduct = { id: string; title?: string }

const ProductGoogleMerchantWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const navigate = useNavigate()
  const { accounts, isLoading: accountsLoading } = useGoogleMerchantAccounts({ limit: 50 })
  const { links, isLoading: statusLoading } = useProductGoogleMerchantStatus(data?.id)
  const syncMutation = useSyncProductToGoogleMerchant()

  const connectedAccounts = accounts.filter((a) => a.connected)
  const linkedAccountIds = new Set(links.map((l) => l.account_id))

  const handleSync = async (accountId: string) => {
    try {
      const result = await syncMutation.mutateAsync({
        account_id: accountId,
        product_id: data.id,
      })
      if (result.success) {
        toast.success("Synced to Google Merchant")
      }
    } catch (err: any) {
      toast.error(err?.message || "Sync failed")
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
            <Text size="small" className="text-ui-fg-subtle">
              No Google Merchant accounts configured yet.
            </Text>
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
              const isLinked = linkedAccountIds.has(account.id)
              const isPending = syncMutation.isPending && syncMutation.variables?.account_id === account.id
              return (
                <div key={account.id} className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Text size="small" weight="plus">{account.name}</Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {account.account_email || `ID ${account.merchant_id}`}
                    </Text>
                  </div>
                  <div className="flex items-center gap-x-2">
                    {isLinked && <StatusBadge color="green">Synced</StatusBadge>}
                    <Button size="small" variant="secondary" onClick={() => handleSync(account.id)} isLoading={isPending}>
                      {isLinked ? "Re-sync" : "Sync"}
                    </Button>
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
