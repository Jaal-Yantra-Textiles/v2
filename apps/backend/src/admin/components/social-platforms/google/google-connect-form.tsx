import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button, Checkbox, Heading, Text, toast } from "@medusajs/ui"
import { KeyboundForm } from "../../utilitites/key-bound-form"
import { RouteDrawer } from "../../modal/route-drawer/route-drawer"
import { useRouteModal } from "../../modal/use-route-modal"
import {
  type GoogleService,
  useInitiateGoogleConnect,
} from "../../../hooks/api/google-business"
import { type AdminSocialPlatform } from "../../../hooks/api/social-platforms"

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

export const GoogleConnectForm = ({
  platform,
}: {
  platform: AdminSocialPlatform
}) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const apiConfig = (platform.api_config || {}) as Record<string, any>
  const initiate = useInitiateGoogleConnect(platform.id)

  const enabledFromConfig: GoogleService[] = Array.isArray(
    apiConfig.enabled_services
  )
    ? apiConfig.enabled_services
    : []
  const [selected, setSelected] = useState<GoogleService[]>(
    enabledFromConfig.length > 0 ? enabledFromConfig : ["merchant"]
  )

  const hasClientId = !!apiConfig.client_id
  const hasClientSecret = !!apiConfig.client_secret_encrypted
  const hasDeveloperToken = !!apiConfig.developer_token_encrypted
  const hasCreds = hasClientId && hasClientSecret
  const adsSelected = selected.includes("ads")
  const adsBlocked = adsSelected && !hasDeveloperToken

  const toggle = (id: GoogleService) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selected.length === 0) {
      toast.error("Pick at least one Google service to enable")
      return
    }
    if (!hasCreds) {
      toast.error("Save client_id and client_secret on the row before connecting")
      return
    }
    if (adsBlocked) {
      toast.error("Add a developer token before authorizing Google Ads")
      return
    }
    try {
      await initiate.mutateAsync({ services: selected })
      // useInitiateGoogleConnect redirects via window.location.href, so
      // handleSuccess() is mostly defensive — the page is already navigating.
      handleSuccess()
    } catch (e: any) {
      toast.error(e.message || "Failed to start Google OAuth")
    }
  }

  return (
    <KeyboundForm
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto px-6 py-4">
        <div>
          <Text size="small" className="text-ui-fg-subtle">
            Tick the surfaces this connection should authorize. The consent
            screen will ask for the union of these scopes.
          </Text>
        </div>

        {!hasCreds && (
          <Text size="small" className="text-ui-fg-error">
            Save Client ID and Client Secret on the row before connecting.
          </Text>
        )}

        <div className="grid grid-cols-1 gap-2">
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
                  onCheckedChange={() => toggle(svc.id)}
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
                      Requires a developer token to call the Ads API.
                    </Text>
                  )}
                </div>
              </label>
            )
          })}
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
            isLoading={initiate.isPending}
            disabled={!hasCreds || selected.length === 0 || adsBlocked}
          >
            Connect with Google
          </Button>
        </div>
      </RouteDrawer.Footer>
    </KeyboundForm>
  )
}
