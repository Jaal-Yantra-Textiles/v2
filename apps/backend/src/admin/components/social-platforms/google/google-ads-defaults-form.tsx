import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Badge,
  Button,
  Label,
  Select,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { KeyboundForm } from "../../utilitites/key-bound-form"
import { RouteDrawer } from "../../modal/route-drawer/route-drawer"
import { useRouteModal } from "../../modal/use-route-modal"
import {
  useGoogleAdsConversionActions,
  useGoogleAdsCustomers,
} from "../../../hooks/api/google-business"
import {
  type AdminSocialPlatform,
  useUpdateSocialPlatform,
} from "../../../hooks/api/social-platforms"

type GoogleAdsConfig = {
  default_customer_id?: string
  default_conversion_action?: string
  validate_only?: boolean
  [k: string]: any
}

export const GoogleAdsDefaultsForm = ({
  platform,
}: {
  platform: AdminSocialPlatform
}) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const apiConfig = (platform.api_config || {}) as Record<string, any>
  const existing = (apiConfig.google_ads || {}) as GoogleAdsConfig

  const { customers, isLoading: loadingCustomers } = useGoogleAdsCustomers(
    platform.id
  )

  const [customerId, setCustomerId] = useState<string>(
    existing.default_customer_id || ""
  )
  const [conversionAction, setConversionAction] = useState<string>(
    existing.default_conversion_action || ""
  )
  const [validateOnly, setValidateOnly] = useState<boolean>(
    !!existing.validate_only
  )

  const update = useUpdateSocialPlatform(platform.id)

  // Refetch conversion actions whenever the operator picks a different CID;
  // gated by `enabled` so we don't ping Google before there's a selection.
  const {
    conversionActions,
    isLoading: loadingActions,
    isError: actionsError,
    error: actionsErrorObj,
    refetch: refetchActions,
  } = useGoogleAdsConversionActions(platform.id, customerId || null)

  // If the operator changes the CID and the saved conversion_action no longer
  // matches the new customer's actions, blank it out so they don't accidentally
  // save a mismatched mapping.
  useEffect(() => {
    if (!customerId) return
    if (!conversionAction) return
    const matches = conversionActions.find(
      (a) => a.resource_name === conversionAction
    )
    if (conversionActions.length > 0 && !matches) {
      setConversionAction("")
    }
  }, [conversionActions, customerId, conversionAction])

  const dirty =
    customerId !== (existing.default_customer_id || "") ||
    conversionAction !== (existing.default_conversion_action || "") ||
    validateOnly !== !!existing.validate_only

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.customer_id,
        label: c.descriptive_name
          ? `${c.descriptive_name} (${c.customer_id})`
          : c.customer_id,
      })),
    [customers]
  )

  const actionOptions = useMemo(
    () =>
      conversionActions
        .filter((a) => a.resource_name && a.name)
        .map((a) => ({
          value: a.resource_name,
          label: `${a.name}${a.status ? ` · ${a.status}` : ""}`,
        })),
    [conversionActions]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Whole `google_ads` sub-object is replaced on save (top-level JSON merge),
    // so spread `existing` to preserve any future fields we don't surface here.
    const nextGoogleAds: GoogleAdsConfig = {
      ...existing,
      default_customer_id: customerId || undefined,
      default_conversion_action: conversionAction || undefined,
      validate_only: validateOnly || undefined,
    }
    await update.mutateAsync(
      { api_config: { google_ads: nextGoogleAds } } as any,
      {
        onSuccess: () => {
          toast.success("Upload defaults saved")
          handleSuccess()
        },
        onError: (error) => toast.error(error.message),
      }
    )
  }

  const noCustomersSynced = !loadingCustomers && customers.length === 0

  return (
    <KeyboundForm
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-5 overflow-y-auto px-6 py-4">
        <div>
          <Text size="small" className="text-ui-fg-subtle">
            These defaults drive conversion uploads when a conversion's
            metadata or matched goal doesn't override them. The conversion
            upload subscriber skips silently if neither is set.
          </Text>
        </div>

        {noCustomersSynced && (
          <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
            <Text size="small" className="text-ui-fg-subtle">
              No Google Ads customers synced yet. Run "Sync now" on the GBM
              panel first — the picker reads from synced customer rows.
            </Text>
          </div>
        )}

        <div className="flex flex-col gap-y-2">
          <Label size="xsmall" className="text-ui-fg-subtle">
            Default Google Ads customer
          </Label>
          <Select
            value={customerId}
            onValueChange={(v) => setCustomerId(v)}
            disabled={loadingCustomers || customerOptions.length === 0}
          >
            <Select.Trigger>
              <Select.Value
                placeholder={
                  loadingCustomers
                    ? "Loading customers…"
                    : customerOptions.length === 0
                      ? "No customers — sync first"
                      : "Pick a CID"
                }
              />
            </Select.Trigger>
            <Select.Content>
              {customerOptions.map((opt) => (
                <Select.Item key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>

        <div className="flex flex-col gap-y-2">
          <div className="flex items-center justify-between">
            <Label size="xsmall" className="text-ui-fg-subtle">
              Default conversion action
            </Label>
            {customerId && (
              <Button
                size="small"
                variant="transparent"
                onClick={(e) => {
                  e.preventDefault()
                  refetchActions()
                }}
                disabled={loadingActions}
              >
                Refresh
              </Button>
            )}
          </div>
          <Select
            value={conversionAction}
            onValueChange={(v) => setConversionAction(v)}
            disabled={!customerId || loadingActions || actionOptions.length === 0}
          >
            <Select.Trigger>
              <Select.Value
                placeholder={
                  !customerId
                    ? "Pick a customer first"
                    : loadingActions
                      ? "Loading from Google…"
                      : actionOptions.length === 0
                        ? "No conversion actions on this CID"
                        : "Pick a conversion action"
                }
              />
            </Select.Trigger>
            <Select.Content>
              {actionOptions.map((opt) => (
                <Select.Item key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          {actionsError && (
            <Text size="xsmall" className="text-ui-fg-error">
              {(actionsErrorObj as Error)?.message ||
                "Failed to load conversion actions"}
            </Text>
          )}
          {conversionAction && (
            <Text
              size="xsmall"
              className="text-ui-fg-subtle truncate"
              title={conversionAction}
            >
              {conversionAction}
            </Text>
          )}
        </div>

        <div className="flex items-start justify-between rounded-md border px-3 py-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-x-2">
              <Text size="small" weight="plus">
                Validate-only mode
              </Text>
              {validateOnly && (
                <Badge size="2xsmall" color="orange">
                  Dry run
                </Badge>
              )}
            </div>
            <Text size="xsmall" className="text-ui-fg-subtle">
              When on, uploads send <code>validateOnly: true</code> to Google
              — Google parses the request and reports errors but does not
              record the conversion. Useful while wiring up a new CID.
            </Text>
          </div>
          <Switch checked={validateOnly} onCheckedChange={setValidateOnly} />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.cancel")}
            </Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            variant="primary"
            type="submit"
            isLoading={update.isPending}
            disabled={!dirty}
          >
            {t("actions.save")}
          </Button>
        </div>
      </RouteDrawer.Footer>
    </KeyboundForm>
  )
}
