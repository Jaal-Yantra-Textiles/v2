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
import {
  ArrowPath,
  ArrowUpRightOnBox,
  Key,
  PencilSquare,
  Plus,
  Trash,
} from "@medusajs/icons"
import { Link } from "react-router-dom"
import {
  type GoogleBinding,
  type GoogleService,
  useDeleteGoogleBinding,
  useGoogleBindings,
  useRefreshGoogleToken,
} from "../../hooks/api/google-business"
import { type AdminSocialPlatform } from "../../hooks/api/social-platforms"
import { CommonSection } from "../common/section-views"

const SERVICES: { id: GoogleService; label: string; description: string }[] = [
  {
    id: "merchant",
    label: "Merchant Center",
    description: "Sync products to Google Shopping",
  },
  {
    id: "ads",
    label: "Google Ads",
    description: "Conversion uploads, accessible customers",
  },
  {
    id: "search-console",
    label: "Search Console",
    description: "Verified properties, search analytics",
  },
  {
    id: "business-profile",
    label: "Business Profile",
    description: "Locations, posts, performance",
  },
]

export function GoogleBusinessPanel({
  platform,
}: {
  platform: AdminSocialPlatform
}) {
  const apiConfig = (platform.api_config || {}) as Record<string, any>
  const isConnected = !!(
    apiConfig.access_token_encrypted ||
    apiConfig.access_token ||
    apiConfig.refresh_token_encrypted
  )

  return (
    <div className="flex flex-col gap-y-3">
      <ConnectionSection platform={platform} isConnected={isConnected} />
      <CredentialsSection apiConfig={apiConfig} />
      <BindingsSection platformId={platform.id} isConnected={isConnected} />
    </div>
  )
}

function ConnectionSection({
  platform,
  isConnected,
}: {
  platform: AdminSocialPlatform
  isConnected: boolean
}) {
  const apiConfig = (platform.api_config || {}) as Record<string, any>
  const grantedScopes: string[] = apiConfig.granted_scopes || []
  const accountEmail: string | null = apiConfig.account_email || null
  const expiresIn: number | null = apiConfig.expires_in ?? null
  const retrievedAt: string | null = apiConfig.retrieved_at ?? null
  const expiresAt = useMemo(() => {
    if (!retrievedAt || !expiresIn) return null
    return new Date(new Date(retrievedAt).getTime() + expiresIn * 1000)
  }, [retrievedAt, expiresIn])

  const refresh = useRefreshGoogleToken(platform.id)

  const handleRefresh = async (force: boolean) => {
    try {
      const result = await refresh.mutateAsync(force)
      toast.success(
        result.refreshed ? "Token refreshed" : "Token still valid — no refresh needed"
      )
    } catch (e: any) {
      toast.error(e.message || "Refresh failed")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Google Business Manager</Heading>
          <Text className="text-ui-fg-subtle mt-1" size="small">
            One Google connection drives Merchant, Ads, Search Console, and
            Business Profile.
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          <StatusBadge color={isConnected ? "green" : "orange"}>
            {isConnected ? "Connected" : "Not connected"}
          </StatusBadge>
          <Button
            asChild
            size="small"
            variant={isConnected ? "secondary" : "primary"}
          >
            <Link to="google-connect">
              <ArrowUpRightOnBox />
              {isConnected ? "Reconnect" : "Connect with Google"}
            </Link>
          </Button>
        </div>
      </div>

      {isConnected ? (
        <>
          <Field label="Account email" value={accountEmail || "—"} />
          <Field
            label="Token expires"
            value={expiresAt ? expiresAt.toLocaleString() : "—"}
          />
          <div className="text-ui-fg-subtle grid grid-cols-2 items-start px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Granted scopes
            </Text>
            <div className="flex flex-wrap gap-1">
              {grantedScopes.length === 0 ? (
                <Text size="small" leading="compact">
                  —
                </Text>
              ) : (
                grantedScopes.map((s) => (
                  <Badge key={s} size="2xsmall" color="grey">
                    {s.replace("https://www.googleapis.com/auth/", "")}
                  </Badge>
                ))
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-x-2 px-6 py-3">
            <Button
              size="small"
              variant="secondary"
              onClick={() => handleRefresh(false)}
              isLoading={refresh.isPending}
            >
              <ArrowPath /> Refresh
            </Button>
            <Button
              size="small"
              variant="transparent"
              onClick={() => handleRefresh(true)}
              isLoading={refresh.isPending}
            >
              Force refresh
            </Button>
          </div>
        </>
      ) : (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Save OAuth credentials below, then click Connect with Google to
            authorize the services you want.
          </Text>
        </div>
      )}
    </Container>
  )
}

function CredentialsSection({
  apiConfig,
}: {
  apiConfig: Record<string, any>
}) {
  const hasClientId = !!apiConfig.client_id
  const hasClientSecret = !!apiConfig.client_secret_encrypted
  const hasDeveloperToken = !!apiConfig.developer_token_encrypted

  return (
    <CommonSection
      title="OAuth credentials"
      description="Per-row Google Cloud OAuth client and Ads developer token."
      actionGroups={[
        {
          actions: [
            {
              label: "Edit credentials",
              icon: <Key />,
              to: "google-credentials",
            },
          ],
        },
      ]}
      fields={[
        hasClientId
          ? { label: "Client ID", value: apiConfig.client_id }
          : { label: "Client ID", badge: { value: "Not set", color: "orange" } },
        {
          label: "Client secret",
          badge: hasClientSecret
            ? { value: "Saved", color: "green" }
            : { value: "Not set", color: "orange" },
        },
        {
          label: "Developer token",
          badge: hasDeveloperToken
            ? { value: "Saved", color: "green" }
            : { value: "Not set", color: "orange" },
        },
      ]}
    />
  )
}

function BindingsSection({
  platformId,
  isConnected,
}: {
  platformId: string
  isConnected: boolean
}) {
  const { bindings, isLoading } = useGoogleBindings(platformId)
  const deleteBinding = useDeleteGoogleBinding(platformId)

  const grouped = useMemo(() => {
    const out: Record<GoogleService, GoogleBinding[]> = {
      merchant: [],
      ads: [],
      "search-console": [],
      "business-profile": [],
    }
    for (const b of bindings) {
      if (out[b.service]) out[b.service].push(b)
    }
    return out
  }, [bindings])

  const handleDelete = async (b: GoogleBinding) => {
    try {
      await deleteBinding.mutateAsync(b.id)
      toast.success(`Removed ${b.resource_label || b.resource_id}`)
    } catch (e: any) {
      toast.error(e.message || "Delete failed")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Bindings</Heading>
          <Text className="text-ui-fg-subtle mt-1" size="small">
            Pin specific Merchant accounts, Ads CIDs, Search Console properties,
            and Business Profile accounts to this connection.
          </Text>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 p-6 md:grid-cols-2">
        {SERVICES.map((svc) => (
          <ServiceBindingsCard
            key={svc.id}
            service={svc.id}
            label={svc.label}
            bindings={grouped[svc.id]}
            isLoading={isLoading}
            isConnected={isConnected}
            onDelete={handleDelete}
            isDeleting={deleteBinding.isPending}
          />
        ))}
      </div>
    </Container>
  )
}

function ServiceBindingsCard({
  service,
  label,
  bindings,
  isLoading,
  isConnected,
  onDelete,
  isDeleting,
}: {
  service: GoogleService
  label: string
  bindings: GoogleBinding[]
  isLoading: boolean
  isConnected: boolean
  onDelete: (b: GoogleBinding) => void
  isDeleting: boolean
}) {
  return (
    <div className="flex flex-col rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <Text size="small" weight="plus">
          {label}
        </Text>
        <Button
          asChild
          size="small"
          variant="transparent"
          disabled={!isConnected}
        >
          <Link to={isConnected ? `google-bind/${service}` : "#"}>
            <Plus /> Add
          </Link>
        </Button>
      </div>
      <div className="flex flex-col divide-y">
        {!isConnected ? (
          <div className="px-3 py-2">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Connect Google to bind {label.toLowerCase()} resources.
            </Text>
          </div>
        ) : isLoading ? (
          <div className="px-3 py-2">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Loading…
            </Text>
          </div>
        ) : bindings.length === 0 ? (
          <div className="px-3 py-2">
            <Text size="xsmall" className="text-ui-fg-subtle">
              No {service} bindings yet.
            </Text>
          </div>
        ) : (
          bindings.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <Text size="small" weight="plus" className="truncate">
                  {b.resource_label || b.resource_id}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle truncate">
                  {b.resource_id}
                </Text>
                {b.last_error && (
                  <Text size="xsmall" className="text-ui-fg-error truncate">
                    {b.last_error}
                  </Text>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-x-2">
                <StatusBadge
                  color={
                    b.status === "active"
                      ? "green"
                      : b.status === "error"
                        ? "red"
                        : b.status === "paused"
                          ? "grey"
                          : "orange"
                  }
                >
                  {b.status}
                </StatusBadge>
                <Button
                  size="small"
                  variant="transparent"
                  onClick={() => onDelete(b)}
                  disabled={isDeleting}
                >
                  <Trash />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
      <Text size="small" leading="compact" weight="plus">
        {label}
      </Text>
      <Text size="small" leading="compact">
        {value || "—"}
      </Text>
    </div>
  )
}
