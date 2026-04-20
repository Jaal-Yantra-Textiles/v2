import { Button, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui"
import { useNavigate, useParams } from "react-router-dom"
import {
  useGoogleMerchantAccount,
  useDeleteGoogleMerchantAccount,
  useInitiateGoogleMerchantOAuth,
} from "../../../../hooks/api/google-merchant"

const DetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { account, isLoading } = useGoogleMerchantAccount(id)
  const deleteMutation = useDeleteGoogleMerchantAccount()
  const initiateOAuth = useInitiateGoogleMerchantOAuth()

  if (isLoading) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-subtle">Loading…</Text>
      </Container>
    )
  }
  if (!account) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-error">Account not found</Text>
      </Container>
    )
  }

  const handleConnect = async () => {
    try {
      await initiateOAuth.mutateAsync(account.id)
    } catch (err: any) {
      toast.error(err?.message || "Failed to start OAuth")
    }
  }

  const handleDelete = async () => {
    if (!confirm("Delete this Google Merchant account? Linked products will lose sync status.")) return
    try {
      await deleteMutation.mutateAsync(account.id)
      toast.success("Account deleted")
      navigate("/settings/google-merchant")
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex justify-between px-6 py-4">
        <div>
          <Heading>{account.name}</Heading>
          <Text size="small" className="text-ui-fg-subtle">Merchant ID: {account.merchant_id}</Text>
        </div>
        <div className="flex items-center gap-x-2">
          <StatusBadge color={account.connected ? "green" : "orange"}>
            {account.connected ? "Connected" : "Not connected"}
          </StatusBadge>
          {!account.connected ? (
            <Button size="small" variant="primary" onClick={handleConnect} isLoading={initiateOAuth.isPending}>
              Connect to Google
            </Button>
          ) : (
            <Button size="small" variant="secondary" onClick={handleConnect} isLoading={initiateOAuth.isPending}>
              Reconnect
            </Button>
          )}
          <Button size="small" variant="danger" onClick={handleDelete}>Delete</Button>
        </div>
      </div>

      <div className="px-6 py-4 grid grid-cols-2 gap-y-3">
        <Detail label="Account Email" value={account.account_email || "—"} />
        <Detail label="OAuth Client ID" value={account.client_id} />
        <Detail label="Redirect URI" value={account.redirect_uri} />
        <Detail label="Scope" value={account.scope || "—"} />
        <Detail label="Storefront URL" value={(account.api_config as any)?.landing_url_base || "—"} />
        <Detail label="Content Language" value={(account.api_config as any)?.content_language || "—"} />
        <Detail label="Feed Label" value={(account.api_config as any)?.feed_label || "—"} />
        <Detail label="Currency" value={(account.api_config as any)?.currency_code || "—"} />
        <Detail
          label="Token Expiry"
          value={account.token_expires_at ? new Date(account.token_expires_at).toLocaleString() : "—"}
        />
      </div>
    </Container>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <Text size="xsmall" className="text-ui-fg-subtle">{label}</Text>
      <Text size="small">{value}</Text>
    </div>
  )
}

export default DetailPage
