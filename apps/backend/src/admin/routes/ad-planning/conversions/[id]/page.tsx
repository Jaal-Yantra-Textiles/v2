/**
 * Conversion Detail Page
 *
 * Shows the conversion record plus a Google Ads upload status panel that
 * reflects the metadata stamped by uploadGoogleAdsConversionStep — and a
 * Retry Upload action that re-runs the workflow.
 */

import { useMemo } from "react"
import {
  Badge,
  Button,
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
} from "@medusajs/ui"
import { ArrowPath } from "@medusajs/icons"
import { Link, useParams, UIMatch } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../../../lib/config"
import { useCurrencyFormatter } from "../../../../hooks/api/currency"

type Conversion = {
  id: string
  conversion_type: string
  conversion_name: string | null
  ad_campaign_id: string | null
  ad_set_id: string | null
  ad_id: string | null
  platform: "meta" | "google" | "generic" | "direct"
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  attribution_model: string
  attribution_weight: number
  conversion_value: number | null
  currency: string | null
  order_id: string | null
  analytics_event_id: string | null
  analytics_session_id: string | null
  lead_id: string | null
  person_id: string | null
  visitor_id: string
  session_id: string | null
  website_id: string | null
  converted_at: string
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

type RetryResponse = {
  conversion_id: string
  customer_id: string
  conversion_action: string
  uploaded: boolean
  reason?: string
  partial_failure?: any
}

const ConversionDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["ad-planning", "conversions", id],
    queryFn: () =>
      sdk.client.fetch<{ conversion: Conversion }>(
        `/admin/ad-planning/conversions/${id}`,
        { method: "GET" }
      ),
    enabled: !!id,
  })

  const retry = useMutation({
    mutationFn: (input?: { platform_id?: string }) =>
      sdk.client.fetch<RetryResponse>(
        `/admin/ad-planning/conversions/${id}/google-upload`,
        { method: "POST", body: input || {} }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-planning", "conversions", id] })
    },
  })

  if (isLoading) {
    return (
      <Container className="p-6">
        <Text size="small" className="text-ui-fg-subtle">
          Loading…
        </Text>
      </Container>
    )
  }

  if (isError || !data?.conversion) {
    return (
      <Container className="p-6">
        <Text size="small" className="text-ui-fg-error">
          {(error as Error)?.message || "Conversion not found"}
        </Text>
      </Container>
    )
  }

  const c = data.conversion
  const meta = (c.metadata || {}) as Record<string, any>
  const showGoogleAdsSection =
    c.platform === "google" ||
    Object.keys(meta).some((k) => k.startsWith("google_ads_"))

  const handleRetry = async () => {
    try {
      const result = await retry.mutateAsync(undefined)
      if (result.uploaded) {
        toast.success("Conversion uploaded to Google Ads")
      } else {
        toast.warning(result.reason || "Upload skipped — see status for details")
      }
    } catch (e: any) {
      toast.error(e.message || "Upload failed")
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <ConversionGeneralSection conversion={c} />
      <AttributionSection conversion={c} />
      <UtmSection conversion={c} />
      {showGoogleAdsSection && (
        <GoogleAdsUploadSection
          conversion={c}
          onRetry={handleRetry}
          isRetrying={retry.isPending}
        />
      )}
      <RawMetadataSection metadata={meta} />
    </div>
  )
}

function ConversionGeneralSection({ conversion }: { conversion: Conversion }) {
  const { formatCurrency } = useCurrencyFormatter()
  const value =
    conversion.conversion_value != null
      ? formatCurrency(conversion.conversion_value, { convert: false })
      : "—"
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Conversion</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {conversion.conversion_type.replace(/_/g, " ")} ·{" "}
            {new Date(conversion.converted_at).toLocaleString()}
          </Text>
        </div>
        <PlatformBadge platform={conversion.platform} />
      </div>
      <Field label="Value" value={value} />
      <Field label="Currency" value={conversion.currency || "—"} />
      <Field
        label="Attribution model"
        value={conversion.attribution_model.replace(/_/g, " ")}
      />
      <Field
        label="Attribution weight"
        value={String(conversion.attribution_weight ?? "—")}
      />
      <Field
        label="Order"
        value={conversion.order_id || "—"}
        link={
          conversion.order_id ? `/orders/${conversion.order_id}` : undefined
        }
      />
      <Field
        label="Person"
        value={conversion.person_id || "—"}
        link={
          conversion.person_id ? `/persons/${conversion.person_id}` : undefined
        }
      />
      <Field label="Visitor" value={conversion.visitor_id} />
      <Field label="Session" value={conversion.session_id || "—"} />
    </Container>
  )
}

function AttributionSection({ conversion }: { conversion: Conversion }) {
  const hasAttribution =
    conversion.ad_campaign_id ||
    conversion.ad_set_id ||
    conversion.ad_id
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Attribution</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Resolved campaign, ad set, and ad references for this conversion.
        </Text>
      </div>
      {!hasAttribution ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No attribution resolved. Check the UTMs below or wait for the
            bulk-resolve job to run.
          </Text>
        </div>
      ) : (
        <>
          <Field
            label="Campaign id"
            value={conversion.ad_campaign_id || "—"}
            mono
          />
          <Field label="Ad set id" value={conversion.ad_set_id || "—"} mono />
          <Field label="Ad id" value={conversion.ad_id || "—"} mono />
        </>
      )}
    </Container>
  )
}

function UtmSection({ conversion }: { conversion: Conversion }) {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">UTM</Heading>
      </div>
      <Field label="Source" value={conversion.utm_source || "—"} />
      <Field label="Medium" value={conversion.utm_medium || "—"} />
      <Field label="Campaign" value={conversion.utm_campaign || "—"} />
      <Field label="Term" value={conversion.utm_term || "—"} />
      <Field label="Content" value={conversion.utm_content || "—"} />
    </Container>
  )
}

function GoogleAdsUploadSection({
  conversion,
  onRetry,
  isRetrying,
}: {
  conversion: Conversion
  onRetry: () => void
  isRetrying: boolean
}) {
  const meta = (conversion.metadata || {}) as Record<string, any>
  const uploadedAt = meta.google_ads_uploaded_at as string | null
  const failedAt = meta.google_ads_upload_failed_at as string | null
  const skippedAt = meta.google_ads_upload_skipped_at as string | null
  const skipReason = meta.google_ads_upload_skip_reason as string | null
  const uploadError = meta.google_ads_upload_error as string | null
  const partialFailure = meta.google_ads_partial_failure
  const customerId = meta.google_ads_customer_id as string | null
  const conversionAction = meta.google_ads_conversion_action as string | null
  const matchedGoalId = meta.google_ads_matched_goal_id as string | null
  const platformId = meta.google_ads_platform_id as string | null
  const clickId = meta.gclid || meta.gbraid || meta.wbraid || null

  const status: "uploaded" | "error" | "skipped" | "pending" = uploadedAt
    ? "uploaded"
    : uploadError
      ? "error"
      : skipReason
        ? "skipped"
        : "pending"

  const statusColor =
    status === "uploaded"
      ? "green"
      : status === "error"
        ? "red"
        : status === "skipped"
          ? "orange"
          : "grey"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Google Ads upload</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Status of this conversion's upload via
            conversionUploads:uploadClickConversions.
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          <StatusBadge color={statusColor}>{status}</StatusBadge>
          <Button
            size="small"
            variant="secondary"
            onClick={onRetry}
            isLoading={isRetrying}
          >
            <ArrowPath /> Retry upload
          </Button>
        </div>
      </div>

      {status === "uploaded" && uploadedAt && (
        <Field
          label="Uploaded at"
          value={new Date(uploadedAt).toLocaleString()}
        />
      )}
      {status === "error" && (
        <>
          {failedAt && (
            <Field
              label="Failed at"
              value={new Date(failedAt).toLocaleString()}
            />
          )}
          <FieldBlock label="Error" value={uploadError || "—"} variant="error" />
        </>
      )}
      {status === "skipped" && (
        <>
          {skippedAt && (
            <Field
              label="Skipped at"
              value={new Date(skippedAt).toLocaleString()}
            />
          )}
          <FieldBlock
            label="Reason"
            value={skipReason || "—"}
            variant="warning"
          />
        </>
      )}

      <Field label="Click id" value={clickId || "—"} mono />
      <Field label="Customer id (CID)" value={customerId || "—"} mono />
      <Field
        label="Conversion action"
        value={conversionAction || "—"}
        mono
      />
      <Field
        label="Matched goal"
        value={matchedGoalId || "— (used platform default)"}
      />
      <Field label="Platform" value={platformId || "—"} />
      {partialFailure && (
        <FieldBlock
          label="Partial failure"
          value={JSON.stringify(partialFailure, null, 2)}
          variant="error"
          mono
        />
      )}
    </Container>
  )
}

function RawMetadataSection({ metadata }: { metadata: Record<string, any> }) {
  const json = useMemo(() => JSON.stringify(metadata, null, 2), [metadata])
  if (!metadata || Object.keys(metadata).length === 0) return null
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Raw metadata</Heading>
      </div>
      <pre className="bg-ui-bg-subtle text-ui-fg-base px-6 py-4 text-xs overflow-x-auto whitespace-pre-wrap break-all">
        {json}
      </pre>
    </Container>
  )
}

function PlatformBadge({
  platform,
}: {
  platform: "meta" | "google" | "generic" | "direct"
}) {
  const color =
    platform === "google"
      ? "blue"
      : platform === "meta"
        ? "purple"
        : platform === "direct"
          ? "green"
          : "grey"
  return (
    <Badge color={color} size="2xsmall">
      {platform}
    </Badge>
  )
}

function Field({
  label,
  value,
  mono,
  link,
}: {
  label: string
  value: string
  mono?: boolean
  link?: string
}) {
  return (
    <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
      <Text size="small" leading="compact" weight="plus">
        {label}
      </Text>
      {link ? (
        <Link
          to={link}
          className="text-ui-fg-interactive hover:underline truncate"
        >
          <Text
            size="small"
            leading="compact"
            className={mono ? "font-mono" : ""}
          >
            {value || "—"}
          </Text>
        </Link>
      ) : (
        <Text
          size="small"
          leading="compact"
          className={mono ? "font-mono truncate" : "truncate"}
          title={value}
        >
          {value || "—"}
        </Text>
      )}
    </div>
  )
}

function FieldBlock({
  label,
  value,
  variant,
  mono,
}: {
  label: string
  value: string
  variant?: "error" | "warning"
  mono?: boolean
}) {
  const tone =
    variant === "error"
      ? "text-ui-fg-error"
      : variant === "warning"
        ? "text-ui-fg-subtle"
        : "text-ui-fg-base"
  return (
    <div className="text-ui-fg-subtle flex flex-col gap-y-1 px-6 py-4">
      <Text size="small" leading="compact" weight="plus">
        {label}
      </Text>
      <pre
        className={`${mono ? "font-mono" : ""} ${tone} text-xs whitespace-pre-wrap break-all`}
      >
        {value}
      </pre>
    </div>
  )
}

export default ConversionDetailPage

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => match.params.id || "Detail",
}
