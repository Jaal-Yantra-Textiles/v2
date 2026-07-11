import {
  Button,
  Drawer,
  Heading,
  Label,
  Select,
  Skeleton,
  StatusBadge,
  Switch,
  Text,
  Toaster,
  Tooltip,
  clx,
  toast,
} from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { etsyApi } from "../../../../lib/api"

const STATUS_KEY = ["etsy", "status"]
const OPTIONS_KEY = ["etsy", "options"]
const TAXONOMY_KEY = ["etsy", "taxonomy"]
const PARENT = "/settings/etsy"

// Radix Select can't use an empty-string item value, so "Not set" uses this
// sentinel. It must never be persisted — map it back to null on save.
const NONE = "__none__"

const cleanSettings = (form: any) => {
  const out: any = { ...form }
  for (const key of [
    "default_shipping_profile_id",
    "default_return_policy_id",
    "default_readiness_state_id",
  ]) {
    if (!out[key] || out[key] === NONE) out[key] = null
  }
  if (!out.default_taxonomy_id || Number.isNaN(Number(out.default_taxonomy_id))) {
    out.default_taxonomy_id = null
  }
  return out
}

type Status = {
  connected: boolean
  account: any | null
  settings: any
  readiness: {
    connected: boolean
    shipping_profile: boolean
    return_policy: boolean
    readiness_state: boolean
    taxonomy: boolean
    ready_to_publish: boolean
  }
}

/**
 * Routed Sync-settings drawer. Lives at /settings/etsy/settings so it's its own
 * route (linkable, back-button friendly) rather than an inline <Drawer> in the
 * list page. Closing the drawer navigates back to the Etsy settings list.
 */
const EtsySyncSettingsDrawer = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const [form, setForm] = useState<any>({})

  const close = () => {
    setOpen(false)
    navigate(PARENT)
  }

  const statusQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => etsyApi.status() as Promise<Status>,
  })
  const status = statusQuery.data
  const connected = !!status?.connected

  useEffect(() => {
    if (status?.settings) setForm(status.settings)
  }, [status?.settings])

  const optionsQuery = useQuery({
    queryKey: OPTIONS_KEY,
    enabled: connected,
    queryFn: async () => {
      const [sp, rp, rs] = await Promise.all([
        etsyApi.shippingProfiles().catch(() => ({ shipping_profiles: [] })),
        etsyApi.returnPolicies().catch(() => ({ return_policies: [] })),
        etsyApi.readinessStates().catch(() => ({ readiness_states: [] })),
      ])
      return {
        shippingProfiles: (sp as any).shipping_profiles || [],
        returnPolicies: (rp as any).return_policies || [],
        readinessStates: (rs as any).readiness_states || [],
      }
    },
  })
  const shippingProfiles = optionsQuery.data?.shippingProfiles ?? []
  const returnPolicies = optionsQuery.data?.returnPolicies ?? []
  const readinessStates = optionsQuery.data?.readinessStates ?? []

  const taxonomyQuery = useQuery({
    queryKey: TAXONOMY_KEY,
    queryFn: async () =>
      ((await etsyApi.taxonomy().catch(() => ({ taxonomy: [] }))) as any)
        .taxonomy || [],
  })
  const taxonomy = taxonomyQuery.data ?? []

  const saveMutation = useMutation({
    mutationFn: (payload: any) => etsyApi.saveSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATUS_KEY })
      toast.success("Sync settings saved")
      close()
    },
    onError: (err: any) =>
      toast.error("Failed to save settings", { description: err.message }),
  })

  return (
    <Drawer open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Sync settings</Drawer.Title>
          <Drawer.Description>
            Publish readiness and the defaults applied to every product.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-6 overflow-y-auto">
          {statusQuery.isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              {/* Readiness checklist */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <Heading level="h2">Publish readiness</Heading>
                  <Text className="text-ui-fg-subtle" size="small">
                    Etsy requires these to publish listings as active. Missing
                    fields sync products as drafts.
                  </Text>
                </div>
                <div className="flex flex-col gap-2">
                  <ChecklistItem ok={status?.readiness.connected} label="Etsy connected" />
                  <ChecklistItem ok={status?.readiness.taxonomy} label="Default category" />
                  <ChecklistItem ok={status?.readiness.shipping_profile} label="Shipping profile" />
                  <ChecklistItem ok={status?.readiness.return_policy} label="Return policy" />
                  <ChecklistItem ok={status?.readiness.readiness_state} label="Processing profile" />
                </div>
              </div>

              {/* Defaults */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <Heading level="h2">Sync defaults</Heading>
                  <Text className="text-ui-fg-subtle" size="small">
                    Applied to every product unless overridden in product metadata.
                  </Text>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <Field label="Default category (taxonomy)">
                    <SelectField
                      value={String(form.default_taxonomy_id ?? "")}
                      onValueChange={(v) =>
                        setForm({ ...form, default_taxonomy_id: v ? Number(v) : null })
                      }
                      disabled={!connected}
                      options={taxonomy.map((t: any) => ({ value: String(t.id), label: t.name }))}
                    />
                  </Field>
                  <Field label="Shipping profile">
                    <SelectField
                      value={form.default_shipping_profile_id ?? ""}
                      onValueChange={(v) => setForm({ ...form, default_shipping_profile_id: v })}
                      disabled={!connected}
                      options={shippingProfiles.map((p: any) => ({
                        value: p.shipping_profile_id,
                        label: p.title,
                      }))}
                    />
                  </Field>
                  <Field label="Return policy">
                    <SelectField
                      value={form.default_return_policy_id ?? ""}
                      onValueChange={(v) => setForm({ ...form, default_return_policy_id: v })}
                      disabled={!connected}
                      options={returnPolicies.map((p: any) => ({
                        value: p.return_policy_id,
                        // Etsy return policies carry no name — the client derives one;
                        // fall back to the id here so it never renders blank.
                        label: p.name || p.return_policy_id,
                      }))}
                    />
                  </Field>
                  <Field label="Processing profile">
                    <SelectField
                      value={form.default_readiness_state_id ?? ""}
                      onValueChange={(v) => setForm({ ...form, default_readiness_state_id: v })}
                      disabled={!connected}
                      options={readinessStates.map((r: any) => ({ value: r.id, label: r.label }))}
                    />
                  </Field>
                  <Field label="Who made">
                    <SelectField
                      value={form.default_who_made ?? "i_did"}
                      onValueChange={(v) => setForm({ ...form, default_who_made: v })}
                      options={[
                        { value: "i_did", label: "I did" },
                        { value: "someone_else", label: "Someone else" },
                        { value: "collective", label: "Collective" },
                      ]}
                    />
                  </Field>
                  <Field label="When made">
                    <SelectField
                      value={form.default_when_made ?? "made_to_order"}
                      onValueChange={(v) => setForm({ ...form, default_when_made: v })}
                      options={[
                        { value: "made_to_order", label: "Made to order" },
                        { value: "2020_2026", label: "2020–2026" },
                        { value: "2010_2019", label: "2010–2019" },
                        { value: "2000_2006", label: "2000–2006" },
                        { value: "1990s", label: "1990s" },
                        { value: "1980s", label: "1980s" },
                        { value: "1970s", label: "1970s" },
                      ]}
                    />
                  </Field>
                  <Field label="Listing type">
                    <SelectField
                      value={form.default_type ?? "physical"}
                      onValueChange={(v) => setForm({ ...form, default_type: v })}
                      options={[
                        { value: "physical", label: "Physical" },
                        { value: "download", label: "Digital" },
                        { value: "both", label: "Both" },
                      ]}
                    />
                  </Field>
                  <Field label="Is supply">
                    <Switch
                      checked={!!form.default_is_supply}
                      onCheckedChange={(v: boolean) => setForm({ ...form, default_is_supply: v })}
                    />
                  </Field>
                  <Field label="Follow product status">
                    <Tooltip content="If on, published Medusa products are published on Etsy; draft products sync as drafts.">
                      <Switch
                        checked={form.follow_product_status !== false}
                        onCheckedChange={(v: boolean) =>
                          setForm({ ...form, follow_product_status: v })
                        }
                      />
                    </Tooltip>
                  </Field>
                </div>
              </div>
            </>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate(cleanSettings(form))}
            isLoading={saveMutation.isPending}
            disabled={!connected}
          >
            Save settings
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
      <Toaster />
    </Drawer>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <Label>{label}</Label>
    {children}
  </div>
)

const SelectField = ({
  value,
  onValueChange,
  options,
  disabled,
}: {
  value: string
  onValueChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) => (
  <Select
    value={value ? value : NONE}
    onValueChange={(v) => onValueChange(v === NONE ? "" : v)}
    disabled={disabled}
    size="small"
  >
    <Select.Trigger>
      <Select.Value placeholder="Not set" />
    </Select.Trigger>
    <Select.Content>
      <Select.Item value={NONE}>Not set</Select.Item>
      {options.map((o) => (
        <Select.Item key={o.value} value={o.value}>
          {o.label}
        </Select.Item>
      ))}
    </Select.Content>
  </Select>
)

const ChecklistItem = ({ ok, label }: { ok?: boolean; label: string }) => (
  <div
    className={clx(
      "flex items-center gap-2 rounded-lg border px-3 py-2",
      ok
        ? "border-ui-tag-green-border bg-ui-tag-green-bg"
        : "border-ui-tag-red-border bg-ui-tag-red-bg"
    )}
  >
    <StatusBadge color={ok ? "green" : "red"}>{ok ? "Ready" : "Missing"}</StatusBadge>
    <Text>{label}</Text>
  </div>
)

export const handle = {
  breadcrumb: () => "Sync settings",
}

export default EtsySyncSettingsDrawer
