import { useMemo, useState } from "react"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  StatusBadge,
  Text,
  toast,
} from "@medusajs/ui"
import { ArrowPath, Plus, Trash } from "@medusajs/icons"
import {
  type AccessibleResource,
  type GoogleBinding,
  type GoogleService,
  useDeleteGoogleBinding,
  useGoogleAccessibleResources,
  useGoogleBindings,
  useInitiateGoogleConnect,
  useRefreshGoogleToken,
  useUpsertGoogleBinding,
} from "../../hooks/api/google-business"
import { type AdminSocialPlatform, useUpdateSocialPlatform } from "../../hooks/api/social-platforms"

const SERVICES: { id: GoogleService; label: string; description: string }[] = [
  { id: "merchant", label: "Merchant Center", description: "Sync products to Google Shopping" },
  { id: "ads", label: "Google Ads", description: "Conversion uploads, accessible customers" },
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

export function GoogleBusinessPanel({ platform }: { platform: AdminSocialPlatform }) {
  const apiConfig = (platform.api_config || {}) as Record<string, any>
  const isConnected = !!(
    apiConfig.access_token_encrypted ||
    apiConfig.access_token ||
    apiConfig.refresh_token_encrypted
  )
  const grantedScopes: string[] = apiConfig.granted_scopes || []
  const accountEmail: string | null = apiConfig.account_email || null
  const expiresIn: number | null = apiConfig.expires_in ?? null
  const retrievedAt: string | null = apiConfig.retrieved_at ?? null
  const expiresAt = useMemo(() => {
    if (!retrievedAt || !expiresIn) return null
    return new Date(new Date(retrievedAt).getTime() + expiresIn * 1000)
  }, [retrievedAt, expiresIn])

  const enabledFromConfig: GoogleService[] = Array.isArray(apiConfig.enabled_services)
    ? apiConfig.enabled_services
    : []
  const [selectedServices, setSelectedServices] = useState<GoogleService[]>(
    enabledFromConfig.length > 0 ? enabledFromConfig : ["merchant"]
  )

  const initiate = useInitiateGoogleConnect(platform.id)
  const refresh = useRefreshGoogleToken(platform.id)

  const handleToggle = (service: GoogleService) => {
    setSelectedServices((prev) =>
      prev.includes(service) ? prev.filter((s) => s !== service) : [...prev, service]
    )
  }

  const handleConnect = async () => {
    if (selectedServices.length === 0) {
      toast.error("Pick at least one Google service to enable")
      return
    }
    if (!apiConfig.client_id || !apiConfig.client_secret_encrypted) {
      toast.error("Save client_id and client_secret on the row before connecting")
      return
    }
    try {
      await initiate.mutateAsync({ services: selectedServices })
    } catch (e: any) {
      toast.error(e.message || "Failed to start Google OAuth")
    }
  }

  const handleRefresh = async (force = false) => {
    try {
      const result = await refresh.mutateAsync(force)
      toast.success(
        result.refreshed
          ? "Token refreshed"
          : "Token still valid — no refresh needed"
      )
    } catch (e: any) {
      toast.error(e.message || "Refresh failed")
    }
  }

  return (
    <Container className="p-0 divide-y">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Google Business Manager</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            One Google connection drives Merchant, Ads, Search Console, and Business Profile.
          </Text>
        </div>
        <StatusBadge color={isConnected ? "green" : "orange"}>
          {isConnected ? "Connected" : "Not connected"}
        </StatusBadge>
      </div>

      <ConnectionSection
        accountEmail={accountEmail}
        grantedScopes={grantedScopes}
        expiresAt={expiresAt}
        isConnected={isConnected}
        isRefreshing={refresh.isPending}
        onRefresh={handleRefresh}
      />

      <GoogleCredentialsSection
        platformId={platform.id}
        clientId={apiConfig.client_id || ""}
        hasClientSecret={!!apiConfig.client_secret_encrypted}
        hasDeveloperToken={!!apiConfig.developer_token_encrypted}
      />

      <ServiceTogglesSection
        selected={selectedServices}
        onToggle={handleToggle}
        onConnect={handleConnect}
        isConnecting={initiate.isPending}
        isReconnect={isConnected}
        hasCreds={!!apiConfig.client_id && !!apiConfig.client_secret_encrypted}
        adsSelected={selectedServices.includes("ads")}
        hasDeveloperToken={!!apiConfig.developer_token_encrypted}
      />

      {isConnected && <BindingsSection platformId={platform.id} />}
    </Container>
  )
}

function ConnectionSection({
  accountEmail,
  grantedScopes,
  expiresAt,
  isConnected,
  isRefreshing,
  onRefresh,
}: {
  accountEmail: string | null
  grantedScopes: string[]
  expiresAt: Date | null
  isConnected: boolean
  isRefreshing: boolean
  onRefresh: (force: boolean) => void
}) {
  if (!isConnected) {
    return (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Save OAuth credentials (<code>client_id</code>, <code>client_secret</code>) on the
          row, pick which services to authorize, then click Connect.
        </Text>
      </div>
    )
  }

  return (
    <div className="px-6 py-4 flex flex-col gap-y-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Account email" value={accountEmail || "—"} />
        <Field
          label="Token expires"
          value={expiresAt ? expiresAt.toLocaleString() : "—"}
        />
      </div>

      <div>
        <Label size="xsmall" className="text-ui-fg-subtle">
          Granted scopes
        </Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {grantedScopes.length === 0 ? (
            <Text size="small" className="text-ui-fg-subtle">—</Text>
          ) : (
            grantedScopes.map((s) => (
              <Badge key={s} size="2xsmall" color="grey">
                {s.replace("https://www.googleapis.com/auth/", "")}
              </Badge>
            ))
          )}
        </div>
      </div>

      <div className="flex gap-x-2">
        <Button
          size="small"
          variant="secondary"
          onClick={() => onRefresh(false)}
          isLoading={isRefreshing}
        >
          <ArrowPath /> Refresh
        </Button>
        <Button
          size="small"
          variant="transparent"
          onClick={() => onRefresh(true)}
          isLoading={isRefreshing}
        >
          Force refresh
        </Button>
      </div>
    </div>
  )
}

function ServiceTogglesSection({
  selected,
  onToggle,
  onConnect,
  isConnecting,
  isReconnect,
  hasCreds,
  adsSelected,
  hasDeveloperToken,
}: {
  selected: GoogleService[]
  onToggle: (s: GoogleService) => void
  onConnect: () => void
  isConnecting: boolean
  isReconnect: boolean
  hasCreds: boolean
  adsSelected: boolean
  hasDeveloperToken: boolean
}) {
  const adsBlocked = adsSelected && !hasDeveloperToken
  return (
    <div className="px-6 py-4 flex flex-col gap-y-3">
      <div>
        <Heading level="h3">Services</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Tick the surfaces this connection should authorize. The consent screen will ask for
          the union of these scopes.
        </Text>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {SERVICES.map((svc) => {
          const checked = selected.includes(svc.id)
          const needsDevToken = svc.id === "ads" && !hasDeveloperToken
          return (
            <label
              key={svc.id}
              className="flex items-start gap-x-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-ui-bg-subtle-hover"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => onToggle(svc.id)}
                className="mt-0.5"
              />
              <div className="flex flex-col">
                <Text size="small" weight="plus">
                  {svc.label}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {svc.description}
                </Text>
                {needsDevToken && (
                  <Text size="xsmall" className="text-ui-fg-error">
                    Requires a developer token (set above) to call the Ads API.
                  </Text>
                )}
              </div>
            </label>
          )
        })}
      </div>

      <div className="flex justify-end">
        <Button
          size="small"
          variant="primary"
          onClick={onConnect}
          isLoading={isConnecting}
          disabled={!hasCreds || selected.length === 0 || adsBlocked}
        >
          {isReconnect ? "Reconnect" : "Connect with Google"}
        </Button>
      </div>
    </div>
  )
}

function GoogleCredentialsSection({
  platformId,
  clientId,
  hasClientSecret,
  hasDeveloperToken,
}: {
  platformId: string
  clientId: string
  hasClientSecret: boolean
  hasDeveloperToken: boolean
}) {
  const update = useUpdateSocialPlatform(platformId)
  const [clientIdInput, setClientIdInput] = useState(clientId)
  const [clientSecretInput, setClientSecretInput] = useState("")
  const [developerTokenInput, setDeveloperTokenInput] = useState("")

  const dirty =
    clientIdInput.trim() !== clientId ||
    clientSecretInput.length > 0 ||
    developerTokenInput.length > 0

  const handleSave = async () => {
    if (!dirty) return
    const apiConfigPatch: Record<string, any> = {}
    if (clientIdInput.trim() !== clientId) {
      apiConfigPatch.client_id = clientIdInput.trim() || null
    }
    if (clientSecretInput.length > 0) {
      apiConfigPatch.client_secret = clientSecretInput
      // Force re-encryption: clear the existing encrypted blob so the
      // socials credential-encryption subscriber re-runs on the new value.
      apiConfigPatch.client_secret_encrypted = null
    }
    if (developerTokenInput.length > 0) {
      apiConfigPatch.developer_token = developerTokenInput
      apiConfigPatch.developer_token_encrypted = null
    }
    try {
      await update.mutateAsync({ api_config: apiConfigPatch })
      toast.success("Google credentials saved")
      setClientSecretInput("")
      setDeveloperTokenInput("")
    } catch (e: any) {
      toast.error(e.message || "Failed to save credentials")
    }
  }

  return (
    <div className="px-6 py-4 flex flex-col gap-y-3">
      <div>
        <Heading level="h3">OAuth credentials</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Per-row Google Cloud OAuth client. The redirect URI is shared via the{" "}
          <code>GOOGLE_REDIRECT_URI</code> env var.
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-y-3">
        <div className="flex flex-col gap-y-1">
          <Label size="xsmall" className="text-ui-fg-subtle">
            Client ID
          </Label>
          <Input
            value={clientIdInput}
            onChange={(e) => setClientIdInput(e.target.value)}
            placeholder="1234567890-abc.apps.googleusercontent.com"
          />
        </div>

        <div className="flex flex-col gap-y-1">
          <div className="flex items-center justify-between">
            <Label size="xsmall" className="text-ui-fg-subtle">
              Client secret
            </Label>
            {hasClientSecret && (
              <Badge size="2xsmall" color="green">
                Saved
              </Badge>
            )}
          </div>
          <Input
            type="password"
            value={clientSecretInput}
            onChange={(e) => setClientSecretInput(e.target.value)}
            placeholder={hasClientSecret ? "•••••••••• (leave blank to keep)" : "GOCSPX-…"}
            autoComplete="new-password"
          />
        </div>

        <div className="flex flex-col gap-y-1">
          <div className="flex items-center justify-between">
            <Label size="xsmall" className="text-ui-fg-subtle">
              Developer token (Google Ads)
            </Label>
            {hasDeveloperToken && (
              <Badge size="2xsmall" color="green">
                Saved
              </Badge>
            )}
          </div>
          <Input
            type="password"
            value={developerTokenInput}
            onChange={(e) => setDeveloperTokenInput(e.target.value)}
            placeholder={
              hasDeveloperToken ? "•••••••••• (leave blank to keep)" : "Required for Ads API"
            }
            autoComplete="new-password"
          />
          <Text size="xsmall" className="text-ui-fg-subtle">
            Find this in your Google Ads Manager account under API Center.
          </Text>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="small"
          variant="secondary"
          onClick={handleSave}
          isLoading={update.isPending}
          disabled={!dirty}
        >
          Save credentials
        </Button>
      </div>
    </div>
  )
}

function BindingsSection({ platformId }: { platformId: string }) {
  const { bindings, isLoading } = useGoogleBindings(platformId)
  const deleteBinding = useDeleteGoogleBinding(platformId)
  const [pickerService, setPickerService] = useState<GoogleService | null>(null)

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
    <div className="px-6 py-4 flex flex-col gap-y-3">
      <div>
        <Heading level="h3">Bindings</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Pin specific Merchant accounts / Ads CIDs / Search Console properties /
          Business Profile accounts to this connection.
        </Text>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {SERVICES.map((svc) => (
          <ServiceBindingsCard
            key={svc.id}
            service={svc.id}
            label={svc.label}
            bindings={grouped[svc.id]}
            isLoading={isLoading}
            onAdd={() => setPickerService(svc.id)}
            onDelete={handleDelete}
            isDeleting={deleteBinding.isPending}
          />
        ))}
      </div>

      <ResourcePickerDrawer
        platformId={platformId}
        service={pickerService}
        onClose={() => setPickerService(null)}
      />
    </div>
  )
}

function ServiceBindingsCard({
  service,
  label,
  bindings,
  isLoading,
  onAdd,
  onDelete,
  isDeleting,
}: {
  service: GoogleService
  label: string
  bindings: GoogleBinding[]
  isLoading: boolean
  onAdd: () => void
  onDelete: (b: GoogleBinding) => void
  isDeleting: boolean
}) {
  return (
    <div className="rounded-md border flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <Text size="small" weight="plus">
          {label}
        </Text>
        <Button size="small" variant="transparent" onClick={onAdd}>
          <Plus /> Add
        </Button>
      </div>
      <div className="flex flex-col divide-y">
        {isLoading ? (
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
            <div key={b.id} className="flex items-center justify-between px-3 py-2">
              <div className="flex flex-col min-w-0">
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
              <div className="flex items-center gap-x-2 shrink-0">
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

function ResourcePickerDrawer({
  platformId,
  service,
  onClose,
}: {
  platformId: string
  service: GoogleService | null
  onClose: () => void
}) {
  const open = !!service
  const { resources, isLoading, isError, error } = useGoogleAccessibleResources(
    platformId,
    service,
    open
  )
  const upsert = useUpsertGoogleBinding(platformId)

  const handlePick = async (r: AccessibleResource) => {
    if (!service) return
    try {
      await upsert.mutateAsync({
        service,
        resource_id: r.resource_id,
        resource_label: r.resource_label,
        metadata: r.metadata,
      })
      toast.success(`Bound ${r.resource_label || r.resource_id}`)
      onClose()
    } catch (e: any) {
      toast.error(e.message || "Bind failed")
    }
  }

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {service ? `Bind ${SERVICES.find((s) => s.id === service)?.label}` : ""}
          </Drawer.Title>
          <Drawer.Description>
            Pick a resource Google has authorized for this connection.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto">
          {isLoading ? (
            <Text size="small" className="text-ui-fg-subtle">
              Loading from Google…
            </Text>
          ) : isError ? (
            <Text size="small" className="text-ui-fg-error">
              {(error as Error)?.message || "Failed to load resources"}
            </Text>
          ) : resources.length === 0 ? (
            <Text size="small" className="text-ui-fg-subtle">
              No resources returned. Check the connected account has access to this service.
            </Text>
          ) : (
            <div className="flex flex-col divide-y rounded-md border">
              {resources.map((r) => (
                <button
                  key={r.resource_id}
                  type="button"
                  className="flex items-center justify-between px-3 py-2 text-left hover:bg-ui-bg-subtle-hover"
                  onClick={() => handlePick(r)}
                  disabled={upsert.isPending}
                >
                  <div className="flex flex-col min-w-0">
                    <Text size="small" weight="plus" className="truncate">
                      {r.resource_label}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle truncate">
                      {r.resource_id}
                    </Text>
                  </div>
                  <Badge size="2xsmall" color="grey">
                    Bind
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary">Close</Button>
          </Drawer.Close>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <Label size="xsmall" className="text-ui-fg-subtle">
        {label}
      </Label>
      <Text size="small">{value}</Text>
    </div>
  )
}
