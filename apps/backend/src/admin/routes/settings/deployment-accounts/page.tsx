import { defineRouteConfig } from "@medusajs/admin-sdk"
import { RocketLaunch } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  DropdownMenu,
  FocusModal,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  StatusBadge,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { EllipsisHorizontal, PencilSquare, Trash } from "@medusajs/icons"
import { useMemo, useState } from "react"
import {
  AdminDeploymentAccount,
  DeploymentAccountStatus,
  DeploymentProvider,
  useCreateDeploymentAccount,
  useDeleteDeploymentAccount,
  useDeploymentAccounts,
  useUpdateDeploymentAccount,
} from "../../../hooks/api/deployment-accounts"

const PROVIDERS: { value: DeploymentProvider; label: string }[] = [
  { value: "cloudflare", label: "Cloudflare Pages" },
  { value: "netlify", label: "Netlify" },
  { value: "render", label: "Render" },
  { value: "vercel", label: "Vercel" },
]

const STATUSES: { value: DeploymentAccountStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "full", label: "Full (cutoff)" },
  { value: "inactive", label: "Inactive" },
]

function providerLabel(p: string): string {
  return PROVIDERS.find((x) => x.value === p)?.label ?? p
}

function statusColor(s: string): "green" | "orange" | "grey" | "red" {
  switch (s) {
    case "active":
      return "green"
    case "full":
      return "orange"
    case "inactive":
      return "grey"
    default:
      return "grey"
  }
}

// Provider-specific config fields (mirrors HostingCredentials.extra + ids).
type FieldDef = { key: string; label: string; required?: boolean; help?: string }

function providerConfigFields(provider: DeploymentProvider): FieldDef[] {
  switch (provider) {
    case "cloudflare":
      return [
        { key: "account_id", label: "Cloudflare Account ID", required: true },
        { key: "zone_id", label: "DNS Zone ID", help: "Optional — for the platform DNS zone." },
      ]
    case "netlify":
      return [
        { key: "account_id", label: "Netlify Team/Account ID", required: true, help: "Used for the env-vars API." },
        { key: "github_installation_id", label: "GitHub App Installation ID", required: true, help: "Install the Netlify GitHub App once, then paste its installation id." },
        { key: "github_repo_id", label: "GitHub Repo ID", help: "Optional numeric id; Netlify resolves it when omitted." },
      ]
    case "render":
      return [
        { key: "owner_id", label: "Render Owner ID", required: true, help: "From GET /v1/owners." },
        { key: "region", label: "Region", help: "Default: oregon." },
        { key: "plan", label: "Plan", help: "Default: starter." },
      ]
    case "vercel":
      return [{ key: "team_id", label: "Vercel Team ID", help: "Optional — personal accounts omit it." }]
    default:
      return []
  }
}

// ── Shared form fields (create + edit) ──────────────────────────────────────
type FormState = Record<string, string> & {
  label: string
  token: string
  cutoff_max: string
  priority: string
  status: DeploymentAccountStatus
}

function AccountFields({
  provider,
  form,
  set,
  isEdit,
}: {
  provider: DeploymentProvider
  form: FormState
  set: (key: string, value: string) => void
  isEdit?: boolean
}) {
  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex flex-col gap-y-2">
        <Label size="small" weight="plus">Label</Label>
        <Input
          placeholder="e.g. cf-pages-free-1"
          value={form.label}
          onChange={(e) => set("label", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-y-2">
        <Label size="small" weight="plus">
          API Token{isEdit ? "" : " *"}
        </Label>
        <Input
          type="password"
          placeholder={isEdit ? "Leave blank to keep the current token" : "Provider API token / key"}
          value={form.token}
          onChange={(e) => set("token", e.target.value)}
        />
        <Text size="small" className="text-ui-fg-subtle">
          Encrypted at rest. {isEdit ? "Only enter a value to rotate it." : ""}
        </Text>
      </div>

      {providerConfigFields(provider).map((f) => (
        <div key={f.key} className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">
            {f.label}{f.required ? " *" : ""}
          </Label>
          <Input value={form[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />
          {f.help && (
            <Text size="small" className="text-ui-fg-subtle">{f.help}</Text>
          )}
        </div>
      ))}

      <div className="grid grid-cols-2 gap-x-3">
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Cutoff max</Label>
          <Input
            type="number"
            placeholder="Free-tier ceiling (blank = unlimited)"
            value={form.cutoff_max}
            onChange={(e) => set("cutoff_max", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Priority</Label>
          <Input
            type="number"
            placeholder="0"
            value={form.priority}
            onChange={(e) => set("priority", e.target.value)}
          />
        </div>
      </div>

      {isEdit && (
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Status</Label>
          <Select value={form.status} onValueChange={(v) => set("status", v)}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {STATUSES.map((s) => (
                <Select.Item key={s.value} value={s.value}>{s.label}</Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Text size="small" className="text-ui-fg-subtle">
            Set “Full” to cut off new provisions; raise Cutoff max to round up on upgrade.
          </Text>
        </div>
      )}
    </div>
  )
}

function buildPayload(form: FormState, provider: DeploymentProvider, isEdit: boolean) {
  const payload: Record<string, any> = {
    label: form.label.trim(),
    priority: form.priority ? Number(form.priority) : 0,
  }
  if (!isEdit) payload.provider = provider
  if (form.token) payload.token = form.token
  payload.cutoff_max = form.cutoff_max ? Number(form.cutoff_max) : null
  if (isEdit) payload.status = form.status
  for (const f of providerConfigFields(provider)) {
    if (form[f.key]) payload[f.key] = form[f.key]
  }
  return payload
}

const emptyForm = (): FormState => ({
  label: "",
  token: "",
  cutoff_max: "",
  priority: "",
  status: "active",
})

// ── Create (FocusModal) ─────────────────────────────────────────────────────
function CreateAccountModal() {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<DeploymentProvider>("cloudflare")
  const [form, setForm] = useState<FormState>(emptyForm())
  const create = useCreateDeploymentAccount()
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const reset = () => {
    setForm(emptyForm())
    setProvider("cloudflare")
  }

  const handleSubmit = () => {
    if (!form.label.trim()) return toast.error("Label is required")
    if (!form.token) return toast.error("API token is required")
    for (const f of providerConfigFields(provider)) {
      if (f.required && !form[f.key]) return toast.error(`${f.label} is required`)
    }
    create.mutate(buildPayload(form, provider, false) as any, {
      onSuccess: () => {
        toast.success("Hosting account added")
        setOpen(false)
        reset()
      },
    })
  }

  return (
    <FocusModal open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">Add account</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <div className="flex h-full flex-col overflow-hidden">
          <FocusModal.Header>
            <div className="flex items-center justify-end gap-x-2">
              <FocusModal.Close asChild>
                <Button size="small" variant="secondary" disabled={create.isPending}>Cancel</Button>
              </FocusModal.Close>
              <Button size="small" onClick={handleSubmit} isLoading={create.isPending}>Add account</Button>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="flex-1 overflow-auto">
            <div className="mx-auto flex w-full max-w-lg flex-col gap-y-6 py-8">
              <div className="flex flex-col gap-y-1">
                <Heading level="h2">New hosting account</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  A rotatable provider account. New storefronts provision onto the least-loaded active account under its cutoff.
                </Text>
              </div>

              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as DeploymentProvider)}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {PROVIDERS.map((p) => (
                      <Select.Item key={p.value} value={p.value}>{p.label}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              <AccountFields provider={provider} form={form} set={set} />
            </div>
          </FocusModal.Body>
        </div>
      </FocusModal.Content>
    </FocusModal>
  )
}

// ── Edit (Drawer) ───────────────────────────────────────────────────────────
function EditAccountDrawer({
  account,
  open,
  onOpenChange,
}: {
  account: AdminDeploymentAccount
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const update = useUpdateDeploymentAccount(account.id)
  const [form, setForm] = useState<FormState>(() => ({
    label: account.label || "",
    token: "",
    cutoff_max: account.cutoff_max != null ? String(account.cutoff_max) : "",
    priority: account.priority != null ? String(account.priority) : "",
    status: account.status,
    ...Object.fromEntries(
      providerConfigFields(account.provider).map((f) => [f.key, account.api_config?.[f.key] ?? ""])
    ),
  }))
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = () => {
    if (!form.label.trim()) return toast.error("Label is required")
    update.mutate(buildPayload(form, account.provider, true) as any, {
      onSuccess: () => {
        toast.success("Hosting account updated")
        onOpenChange(false)
      },
    })
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{providerLabel(account.provider)} · {account.label}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-1 flex-col overflow-y-auto">
          <AccountFields provider={account.provider} form={form} set={set} isEdit />
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary" disabled={update.isPending}>Cancel</Button>
          </Drawer.Close>
          <Button size="small" onClick={handleSubmit} isLoading={update.isPending}>Save</Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

// ── Row actions ─────────────────────────────────────────────────────────────
function RowActions({ account }: { account: AdminDeploymentAccount }) {
  const [editOpen, setEditOpen] = useState(false)
  const update = useUpdateDeploymentAccount(account.id)
  const del = useDeleteDeploymentAccount(account.id)

  const toggleCutoff = () => {
    const next = account.status === "full" ? "active" : "full"
    update.mutate({ status: next }, {
      onSuccess: () => toast.success(next === "full" ? "Account cut off" : "Account reactivated"),
    })
  }

  const handleDelete = () => {
    if (!confirm(`Delete hosting account “${account.label}”? This does not delete already-provisioned storefronts.`)) return
    del.mutate(undefined, { onSuccess: () => toast.success("Hosting account deleted") })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenu.Trigger asChild>
          <IconButton size="small" variant="transparent">
            <EllipsisHorizontal />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item className="gap-x-2" onClick={() => setEditOpen(true)}>
            <PencilSquare className="text-ui-fg-subtle" />
            Edit
          </DropdownMenu.Item>
          <DropdownMenu.Item className="gap-x-2" onClick={toggleCutoff}>
            <RocketLaunch className="text-ui-fg-subtle" />
            {account.status === "full" ? "Reactivate" : "Cut off (mark full)"}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item className="gap-x-2" onClick={handleDelete}>
            <Trash className="text-ui-fg-subtle" />
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
      {editOpen && (
        <EditAccountDrawer account={account} open={editOpen} onOpenChange={setEditOpen} />
      )}
    </>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────
const DeploymentAccountsPage = () => {
  const { deployment_accounts, isLoading, isError } = useDeploymentAccounts({ limit: 200 })

  const accounts = useMemo(
    () => (deployment_accounts || []) as AdminDeploymentAccount[],
    [deployment_accounts]
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Heading level="h2">Storefront hosting</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Rotatable provider accounts. New partner storefronts provision onto the least-loaded active account under its cutoff.
          </Text>
        </div>
        <CreateAccountModal />
      </div>

      {isLoading ? (
        <div className="px-6 py-8">
          <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
        </div>
      ) : isError ? (
        <div className="px-6 py-8">
          <Text size="small" className="text-ui-fg-error">Failed to load hosting accounts.</Text>
        </div>
      ) : accounts.length === 0 ? (
        <div className="px-6 py-8">
          <Text size="small" className="text-ui-fg-subtle">
            No hosting accounts yet. Add one to start rotating storefront provisioning across free tiers.
          </Text>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Provider</Table.HeaderCell>
                <Table.HeaderCell>Label</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Load</Table.HeaderCell>
                <Table.HeaderCell>Priority</Table.HeaderCell>
                <Table.HeaderCell>Token</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {accounts.map((a) => {
                const load =
                  a.cutoff_max != null
                    ? `${a.project_count} / ${a.cutoff_max}`
                    : `${a.project_count}`
                return (
                  <Table.Row key={a.id}>
                    <Table.Cell>{providerLabel(a.provider)}</Table.Cell>
                    <Table.Cell>
                      <Text size="small" className="font-medium">{a.label}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge color={statusColor(a.status)}>{a.status}</StatusBadge>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-x-2">
                        <Text size="small">{load}</Text>
                        {a.remaining_capacity === 0 && (
                          <Badge color="orange" size="2xsmall">at cap</Badge>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>{a.priority ?? 0}</Table.Cell>
                    <Table.Cell>
                      {a.api_config?.token_present ? (
                        <Badge color="green" size="2xsmall">set</Badge>
                      ) : (
                        <Badge color="red" size="2xsmall">missing</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      <RowActions account={a} />
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        </div>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Storefront Hosting",
  icon: RocketLaunch,
})

export const handle = {
  breadcrumb: () => "Storefront Hosting",
}

export default DeploymentAccountsPage
