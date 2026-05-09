import { useTranslation } from "react-i18next"
import { Badge, Button, Text, toast } from "@medusajs/ui"
import { RouteDrawer } from "../../modal/route-drawer/route-drawer"
import { useRouteModal } from "../../modal/use-route-modal"
import {
  type AccessibleResource,
  type GoogleService,
  useGoogleAccessibleResources,
  useUpsertGoogleBinding,
} from "../../../hooks/api/google-business"

const SERVICE_LABELS: Record<GoogleService, string> = {
  merchant: "Merchant Center",
  ads: "Google Ads",
  "search-console": "Search Console",
  "business-profile": "Business Profile",
}

export const GoogleBindForm = ({
  platformId,
  service,
}: {
  platformId: string
  service: GoogleService
}) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const { resources, isLoading, isError, error } = useGoogleAccessibleResources(
    platformId,
    service,
    true
  )
  const upsert = useUpsertGoogleBinding(platformId)

  const handlePick = async (r: AccessibleResource) => {
    try {
      await upsert.mutateAsync({
        service,
        resource_id: r.resource_id,
        resource_label: r.resource_label,
        metadata: r.metadata,
      })
      toast.success(`Bound ${r.resource_label || r.resource_id}`)
      handleSuccess()
    } catch (e: any) {
      toast.error(e.message || "Bind failed")
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-3 overflow-y-auto px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Pick a {SERVICE_LABELS[service]} resource Google has authorized for
          this connection.
        </Text>

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
            No resources returned. Check that the connected account has access
            to this service.
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
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.cancel")}
            </Button>
          </RouteDrawer.Close>
        </div>
      </RouteDrawer.Footer>
    </div>
  )
}
