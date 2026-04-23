import { EllipsisHorizontal } from "@medusajs/icons"
import {
  Button,
  Container,
  Drawer,
  DropdownMenu,
  Heading,
  IconButton,
  Input,
  Label,
  StatusBadge,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  useGoogleMerchantAccount,
  useDeleteGoogleMerchantAccount,
  useInitiateGoogleMerchantOAuth,
  useUpdateGoogleMerchantAccount,
  useBulkSyncGoogleMerchant,
  useGoogleMerchantSyncJobs,
  useGoogleMerchantDataSourceAction,
  useImportExistingGoogleProducts,
} from "../../../../hooks/api/google-merchant"

const DetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { account, isLoading } = useGoogleMerchantAccount(id)
  const deleteMutation = useDeleteGoogleMerchantAccount()
  const initiateOAuth = useInitiateGoogleMerchantOAuth()
  const importMutation = useImportExistingGoogleProducts(id || "")
  const bulkSync = useBulkSyncGoogleMerchant(id || "")
  const [editOpen, setEditOpen] = useState(false)
  const prompt = usePrompt()

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
    const confirmed = await prompt({
      title: "Delete account?",
      description:
        "Delete this Google Merchant account? Linked products will lose sync status and OAuth tokens will be revoked locally.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    })
    if (!confirmed) return
    try {
      await deleteMutation.mutateAsync(account.id)
      toast.success("Account deleted")
      navigate("/settings/google-merchant")
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete")
    }
  }

  const handleImport = async () => {
    if (!account.connected) {
      toast.error("Connect the account first.")
      return
    }
    const confirmed = await prompt({
      title: "Import existing Google listings?",
      description:
        "Pull existing Google Merchant Center listings and link them to Medusa products. Matches on product handle, variant SKU, or normalized equivalents — same-source products refresh their link.",
      confirmText: "Import",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      const r = await importMutation.mutateAsync(undefined)
      const parts = [
        `${r.linked} linked`,
        `${r.refreshed} refreshed`,
        `${r.matched} matched`,
        `${r.google_total} on Google`,
        `${r.unmatched.length} unmatched`,
      ]
      if (r.errors.length) parts.push(`${r.errors.length} errors`)
      toast.success(parts.join(" · "))
    } catch (e: any) {
      toast.error(e?.message || "Import failed")
    }
  }

  const handleSyncAll = async () => {
    if (!account.connected) {
      toast.error("Connect the account first — complete OAuth.")
      return
    }
    const confirmed = await prompt({
      title: "Sync all products?",
      description:
        "Queue every Medusa product for sync to this Google Merchant account. Runs in the background — you'll see progress in the Sync History below.",
      confirmText: "Sync all",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      const resp = await bulkSync.mutateAsync(undefined)
      toast.success(`Bulk sync started (job ${resp.job.id.slice(0, 8)}…)`)
    } catch (e: any) {
      toast.error(e?.message || "Failed to start bulk sync")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex justify-between px-6 py-4">
        <div>
          <Heading>{account.name}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Merchant ID: {account.merchant_id}
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          <StatusBadge color={account.connected ? "green" : "orange"}>
            {account.connected ? "Connected" : "Not connected"}
          </StatusBadge>
          {!account.connected && (
            <Button
              size="small"
              variant="primary"
              onClick={handleConnect}
              isLoading={initiateOAuth.isPending}
            >
              Connect to Google
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <IconButton size="small" variant="transparent" aria-label="Account actions">
                <EllipsisHorizontal />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {account.connected && (
                <>
                  <DropdownMenu.Item
                    disabled={importMutation.isPending}
                    onClick={handleImport}
                  >
                    Import from Google
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={bulkSync.isPending}
                    onClick={handleSyncAll}
                  >
                    Sync All Products
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={initiateOAuth.isPending}
                    onClick={handleConnect}
                  >
                    Reconnect
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                </>
              )}
              <DropdownMenu.Item onClick={() => setEditOpen(true)}>
                Edit
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="text-ui-fg-error"
                onClick={handleDelete}
              >
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>
      </div>

      <DataSourceBanner
        accountId={account.id}
        connected={account.connected}
        currentName={(account.api_config as any)?.data_source_name || null}
      />

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
        <Detail
          label="Data source"
          value={(account.api_config as any)?.data_source_name || "—"}
        />
      </div>

      <SyncJobsSection accountId={account.id} />

      <EditAccountDrawer
        open={editOpen}
        onOpenChange={setEditOpen}
        accountId={account.id}
        initial={{
          name: account.name,
          account_email: account.account_email || "",
          scope: account.scope || "",
          landing_url_base: (account.api_config as any)?.landing_url_base || "",
          content_language: (account.api_config as any)?.content_language || "en",
          feed_label: (account.api_config as any)?.feed_label || "US",
          currency_code: (account.api_config as any)?.currency_code || "USD",
          api_config: (account.api_config as any) || {},
        }}
      />
    </Container>
  )
}

type EditFormValues = {
  name: string
  account_email: string
  scope: string
  landing_url_base: string
  content_language: string
  feed_label: string
  currency_code: string
  api_config: Record<string, any>
}

function EditAccountDrawer({
  open,
  onOpenChange,
  accountId,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  initial: EditFormValues
}) {
  const update = useUpdateGoogleMerchantAccount(accountId)
  const [form, setForm] = useState<EditFormValues>(initial)

  const set = (k: keyof EditFormValues, v: string) => setForm((p) => ({ ...p, [k]: v }))

  const handleSave = async () => {
    try {
      await update.mutateAsync({
        name: form.name,
        account_email: form.account_email || null,
        scope: form.scope || null,
        api_config: {
          ...initial.api_config,
          landing_url_base: form.landing_url_base || undefined,
          content_language: form.content_language,
          feed_label: form.feed_label,
          currency_code: form.currency_code,
        },
      })
      toast.success("Account updated")
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e?.message || "Failed to update account")
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit Google Merchant Account</Drawer.Title>
          <Drawer.Description>
            Update account display name and product feed defaults. OAuth credentials
            are not editable here — delete and recreate the account to change them.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <EditField label="Name">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </EditField>
          <EditField label="Account Email">
            <Input value={form.account_email} onChange={(e) => set("account_email", e.target.value)} />
          </EditField>
          <EditField label="OAuth Scope">
            <Input value={form.scope} onChange={(e) => set("scope", e.target.value)} />
          </EditField>
          <EditField label="Storefront base URL" hint="Used to build product landing URLs">
            <Input value={form.landing_url_base} onChange={(e) => set("landing_url_base", e.target.value)} />
          </EditField>
          <div className="grid grid-cols-3 gap-x-4">
            <EditField label="Content language">
              <Input value={form.content_language} onChange={(e) => set("content_language", e.target.value)} />
            </EditField>
            <EditField label="Feed label">
              <Input value={form.feed_label} onChange={(e) => set("feed_label", e.target.value)} />
            </EditField>
            <EditField label="Currency">
              <Input value={form.currency_code} onChange={(e) => set("currency_code", e.target.value)} />
            </EditField>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary">Cancel</Button>
          </Drawer.Close>
          <Button variant="primary" onClick={handleSave} isLoading={update.isPending}>
            Save
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

function EditField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-y-1">
      <Label size="small" weight="plus">{label}</Label>
      {children}
      {hint && <Text size="xsmall" className="text-ui-fg-subtle">{hint}</Text>}
    </div>
  )
}

function DataSourceBanner({
  accountId,
  connected,
  currentName,
}: {
  accountId: string
  connected: boolean
  currentName: string | null
}) {
  const action = useGoogleMerchantDataSourceAction(accountId)

  if (!connected || currentName) return null

  const handleDetect = async () => {
    try {
      const resp = await action.mutateAsync({ action: "detect" })
      toast.success(
        resp.created
          ? `Created data source ${resp.created.displayName}`
          : "Data source selected"
      )
    } catch (e: any) {
      toast.error(e?.message || "Failed to detect data source")
    }
  }

  return (
    <div className="px-6 py-3 bg-ui-bg-base-hover">
      <div className="flex items-center justify-between gap-x-3">
        <div>
          <Text size="small" weight="plus">No data source configured</Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Google requires a data source for API product uploads. Detect existing or create one automatically.
          </Text>
        </div>
        <Button size="small" variant="primary" onClick={handleDetect} isLoading={action.isPending}>
          Detect or create
        </Button>
      </div>
    </div>
  )
}

function SyncJobsSection({ accountId }: { accountId: string }) {
  const { jobs, isLoading } = useGoogleMerchantSyncJobs(accountId, { refetchIntervalMs: 4000 })

  if (isLoading) {
    return (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">Loading sync history…</Text>
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="px-6 py-4">
        <Heading level="h3">Sync History</Heading>
        <Text size="small" className="text-ui-fg-subtle">No bulk sync jobs yet.</Text>
      </div>
    )
  }

  return (
    <div className="px-6 py-4 flex flex-col gap-y-3">
      <Heading level="h3">Sync History</Heading>
      <div className="flex flex-col divide-y rounded-md border">
        {jobs.slice(0, 10).map((j) => {
          const progress = j.total_products > 0
            ? Math.round(((j.synced_count + j.failed_count) / j.total_products) * 100)
            : 0
          const color = j.status === "completed" ? "green" : j.status === "failed" ? "red" : j.status === "processing" ? "blue" : "grey"
          return (
            <div key={j.id} className="flex items-center justify-between px-3 py-2">
              <div className="flex flex-col">
                <Text size="small" weight="plus">{j.started_at ? new Date(j.started_at).toLocaleString() : "Pending"}</Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {j.synced_count} synced · {j.failed_count} failed · {j.total_products} total
                  {j.status === "processing" ? ` · ${progress}%` : ""}
                </Text>
              </div>
              <StatusBadge color={color as any}>{j.status}</StatusBadge>
            </div>
          )
        })}
      </div>
    </div>
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
