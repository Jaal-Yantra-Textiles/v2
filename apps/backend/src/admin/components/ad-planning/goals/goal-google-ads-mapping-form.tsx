/**
 * Per-goal Google Ads mapping form.
 *
 * Saves to goal.metadata.google_ads.{customer_id, conversion_action} —
 * the keys uploadGoogleAdsConversionStep reads via resolveGoalMapping.
 *
 * The form needs three pickers:
 *   1. Google platform — to scope (2) and (3) for picker queries. NOT stored
 *      on the goal; the customer_id and conversion_action are unique enough
 *      since a CID is bound to exactly one platform.
 *   2. Customer (CID) — from synced GoogleAdsCustomer rows for that platform.
 *   3. Conversion action — live GAQL fetch for the selected CID.
 *
 * Either field can be left blank to fall back to the platform default.
 */

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Badge,
  Button,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../../lib/config"
import { KeyboundForm } from "../../utilitites/key-bound-form"
import { RouteDrawer } from "../../modal/route-drawer/route-drawer"
import { useRouteModal } from "../../modal/use-route-modal"
import {
  useGoogleAdsConversionActions,
  useGoogleAdsCustomers,
} from "../../../hooks/api/google-business"
import { useSocialPlatforms } from "../../../hooks/api/social-platforms"

type GoalRecord = {
  id: string
  metadata: Record<string, any> | null
}

export const GoalGoogleAdsMappingForm = ({
  goal,
}: {
  goal: GoalRecord
}) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const qc = useQueryClient()
  const meta = (goal.metadata || {}) as Record<string, any>
  const existing = (meta.google_ads || {}) as Record<string, any>

  // List google-category platforms. We filter client-side to "connected"
  // ones that also have a developer token, since a platform without one
  // can't actually upload.
  const { social_platforms, isLoading: loadingPlatforms } = useSocialPlatforms({
    category: "google",
    limit: 50,
  }) as any
  const eligiblePlatforms = useMemo(
    () =>
      (social_platforms || []).filter((p: any) => {
        const cfg = (p.api_config || {}) as Record<string, any>
        return !!cfg.developer_token_encrypted
      }),
    [social_platforms]
  )

  // Default to the single eligible platform when there's only one (most
  // ops setups). Otherwise the operator picks.
  const [platformId, setPlatformId] = useState<string>(() => {
    if (eligiblePlatforms.length === 1) return eligiblePlatforms[0].id
    return ""
  })
  useEffect(() => {
    if (!platformId && eligiblePlatforms.length === 1) {
      setPlatformId(eligiblePlatforms[0].id)
    }
  }, [eligiblePlatforms, platformId])

  const [customerId, setCustomerId] = useState<string>(
    existing.customer_id || ""
  )
  const [conversionAction, setConversionAction] = useState<string>(
    existing.conversion_action || ""
  )

  const { customers, isLoading: loadingCustomers } = useGoogleAdsCustomers(
    platformId,
    !!platformId
  )

  const {
    conversionActions,
    isLoading: loadingActions,
    isError: actionsError,
    error: actionsErrorObj,
  } = useGoogleAdsConversionActions(platformId, customerId || null)

  // Blank a stale conversion_action when the operator switches CID.
  useEffect(() => {
    if (!customerId || !conversionAction) return
    if (
      conversionActions.length > 0 &&
      !conversionActions.find((a) => a.resource_name === conversionAction)
    ) {
      setConversionAction("")
    }
  }, [conversionActions, customerId, conversionAction])

  const dirty =
    customerId !== (existing.customer_id || "") ||
    conversionAction !== (existing.conversion_action || "")

  const mutation = useMutation({
    mutationFn: async () => {
      // Top-level JSON merge replaces metadata.google_ads wholesale, so
      // spread the existing sub-object to preserve any future fields.
      const nextGoogleAds: Record<string, any> = {
        ...existing,
        customer_id: customerId || undefined,
        conversion_action: conversionAction || undefined,
      }
      // Strip both keys when fully cleared so the goal doesn't sit on a
      // dead {google_ads: {}} record.
      const isEmpty = !customerId && !conversionAction
      const nextMetadata = isEmpty
        ? { ...meta, google_ads: undefined }
        : { ...meta, google_ads: nextGoogleAds }

      return sdk.client.fetch<{ goal: any }>(
        `/admin/ad-planning/goals/${goal.id}`,
        { method: "PUT", body: { metadata: nextMetadata } }
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-planning", "goals"] })
      toast.success("Google Ads mapping saved")
      handleSuccess()
    },
    onError: (error: any) => {
      toast.error(error.message || "Save failed")
    },
  })

  const handleClear = () => {
    setCustomerId("")
    setConversionAction("")
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  const platformOptions = useMemo(
    () =>
      eligiblePlatforms.map((p: any) => ({
        value: p.id,
        label: p.name + (p.api_config?.account_email ? ` · ${p.api_config.account_email}` : ""),
      })),
    [eligiblePlatforms]
  )

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

  return (
    <KeyboundForm
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-5 overflow-y-auto px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          When a conversion matches this goal during upload, these values
          override the platform-level defaults. Leave both blank to fall
          back to the platform default.
        </Text>

        <div className="flex flex-col gap-y-2">
          <Label size="xsmall" className="text-ui-fg-subtle">
            Google platform
          </Label>
          <Select
            value={platformId}
            onValueChange={(v) => {
              setPlatformId(v)
              setCustomerId("")
              setConversionAction("")
            }}
            disabled={loadingPlatforms || platformOptions.length === 0}
          >
            <Select.Trigger>
              <Select.Value
                placeholder={
                  loadingPlatforms
                    ? "Loading platforms…"
                    : platformOptions.length === 0
                      ? "No google platforms with a developer token"
                      : "Pick a platform"
                }
              />
            </Select.Trigger>
            <Select.Content>
              {platformOptions.map((opt: any) => (
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
              Customer (CID)
            </Label>
            {customerId === "" && existing.customer_id && (
              <Badge size="2xsmall" color="grey">
                Will fall back to platform default
              </Badge>
            )}
          </div>
          <Select
            value={customerId}
            onValueChange={(v) => setCustomerId(v)}
            disabled={!platformId || loadingCustomers || customerOptions.length === 0}
          >
            <Select.Trigger>
              <Select.Value
                placeholder={
                  !platformId
                    ? "Pick a platform first"
                    : loadingCustomers
                      ? "Loading customers…"
                      : customerOptions.length === 0
                        ? "No customers synced — sync from GBM panel first"
                        : "Optional override"
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
          <Label size="xsmall" className="text-ui-fg-subtle">
            Conversion action
          </Label>
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
                        : "Optional override"
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

        {(existing.customer_id || existing.conversion_action) && (
          <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2 flex items-center justify-between">
            <div className="flex flex-col">
              <Text size="xsmall" weight="plus">
                Current mapping
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {existing.customer_id || "(no CID override)"}
                {" · "}
                {existing.conversion_action || "(no action override)"}
              </Text>
            </div>
            <Button
              size="small"
              variant="transparent"
              type="button"
              onClick={handleClear}
            >
              Clear
            </Button>
          </div>
        )}
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
            isLoading={mutation.isPending}
            disabled={!dirty}
          >
            {t("actions.save")}
          </Button>
        </div>
      </RouteDrawer.Footer>
    </KeyboundForm>
  )
}
