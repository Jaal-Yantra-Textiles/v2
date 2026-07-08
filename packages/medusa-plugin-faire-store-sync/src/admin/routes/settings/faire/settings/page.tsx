import {
  Button,
  Drawer,
  Heading,
  Label,
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
import { faireApi } from "../../../../lib/api"

const STATUS_KEY = ["faire", "status"]
const PARENT = "/settings/faire"

// Radix Select can't use an empty-string item value, so "Not set" uses this
// sentinel. It must never be persisted — map it back to null on save.
const NONE = "__none__"

const cleanSettings = (form: any) => {
  const out: any = { ...form }
  for (const key of [
    "default_brand_id",
    "default_shipping_policy_id",
    "default_category",
  ]) {
    if (!out[key] || out[key] === NONE) out[key] = null
  }
  if (
    out.default_wholesale_markup_percent === "" ||
    out.default_wholesale_markup_percent === NONE
  ) {
    out.default_wholesale_markup_percent = null
  }
  if (out.default_lead_time_days === "" || out.default_lead_time_days === NONE) {
    out.default_lead_time_days = null
  }
  return out
}

type Status = {
  connected: boolean
  account: any | null
  settings: any
  readiness: {
    connected: boolean
    brand: boolean
    wholesale_pricing: boolean
    shipping_policy: boolean
    ready_to_publish: boolean
  }
}

/**
 * Routed Sync-settings drawer. Lives at /settings/faire/settings so it's its
 * own route (linkable, back-button friendly) rather than an inline <Drawer>.
 */
const FaireSyncSettingsDrawer = () => {
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
    queryFn: () => faireApi.status() as Promise<Status>,
  })
  const status = statusQuery.data
  const connected = !!status?.connected

  useEffect(() => {
    if (status?.settings) setForm(status.settings)
  }, [status?.settings])

  const saveMutation = useMutation({
    mutationFn: (payload: any) => faireApi.saveSettings(payload),
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
            Publish readiness and the defaults applied to every product pushed
            to Faire.
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
                    Faire needs a brand and a wholesale-pricing strategy to
                    publish products. Missing fields sync products as drafts.
                  </Text>
                </div>
                <div className="flex flex-col gap-2">
                  <ChecklistItem ok={status?.readiness.connected} label="Faire connected" />
                  <ChecklistItem ok={status?.readiness.brand} label="Brand configured" />
                  <ChecklistItem ok={status?.readiness.wholesale_pricing} label="Wholesale pricing" />
                  <ChecklistItem ok={status?.readiness.shipping_policy} label="Shipping policy" />
                </div>
              </div>

              {/* Defaults */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <Heading level="h2">Sync defaults</Heading>
                  <Text className="text-ui-fg-subtle" size="small">
                    Applied to every product unless overridden in product
                    metadata.
                  </Text>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <Field label="Brand ID">
                    <input
                      className="border-ui-border-base rounded-lg border px-3 py-2 text-sm"
                      value={String(form.default_brand_id ?? "")}
                      onChange={(e) =>
                        setForm({ ...form, default_brand_id: e.target.value || null })
                      }
                      disabled={!connected}
                      placeholder="b_..."
                    />
                  </Field>
                  <Field label="Wholesale markup % (off retail)">
                    <Tooltip content="Wholesale price = retail × (100 − markup%) / 100. E.g. 50 → half of retail.">
                      <input
                        type="number"
                        className="border-ui-border-base rounded-lg border px-3 py-2 text-sm"
                        value={String(form.default_wholesale_markup_percent ?? "")}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            default_wholesale_markup_percent: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        disabled={!connected}
                        placeholder="e.g. 50"
                      />
                    </Tooltip>
                  </Field>
                  <Field label="Default min order quantity">
                    <input
                      type="number"
                      className="border-ui-border-base rounded-lg border px-3 py-2 text-sm"
                      value={String(form.default_min_order_quantity ?? 1)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          default_min_order_quantity: e.target.value
                            ? Number(e.target.value)
                            : 1,
                        })
                      }
                      disabled={!connected}
                    />
                  </Field>
                  <Field label="Default lead time (days)">
                    <input
                      type="number"
                      className="border-ui-border-base rounded-lg border px-3 py-2 text-sm"
                      value={String(form.default_lead_time_days ?? "")}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          default_lead_time_days: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                      disabled={!connected}
                      placeholder="e.g. 14"
                    />
                  </Field>
                  <Field label="Default category">
                    <input
                      className="border-ui-border-base rounded-lg border px-3 py-2 text-sm"
                      value={String(form.default_category ?? "")}
                      onChange={(e) =>
                        setForm({ ...form, default_category: e.target.value || null })
                      }
                      disabled={!connected}
                      placeholder="e.g. Home Decor"
                    />
                  </Field>
                  <Field label="Follow product status">
                    <Tooltip content="If on, published Medusa products are published on Faire; draft products sync as drafts.">
                      <Switch
                        checked={form.follow_product_status !== false}
                        onCheckedChange={(v: boolean) =>
                          setForm({ ...form, follow_product_status: v })
                        }
                      />
                    </Tooltip>
                  </Field>
                  <Field label="Auto publish">
                    <Tooltip content="Publish products to Faire automatically on sync (otherwise create as draft).">
                      <Switch
                        checked={!!form.auto_publish}
                        onCheckedChange={(v: boolean) =>
                          setForm({ ...form, auto_publish: v })
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

export default FaireSyncSettingsDrawer
