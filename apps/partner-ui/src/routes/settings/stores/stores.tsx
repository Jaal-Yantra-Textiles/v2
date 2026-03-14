import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { ArrowUpRightOnBox, ArrowPath } from "@medusajs/icons"
import { useState } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import { SectionRow } from "../../../components/common/section"
import { usePartnerStores } from "../../../hooks/api/partner-stores"
import {
  useStorefrontStatus,
  useProvisionStorefront,
  useRedeployStorefront,
  useRemoveStorefront,
} from "../../../hooks/api/storefront"

function formatDate(dateStr: string | number | null | undefined): string {
  if (!dateStr) return "—"
  const d = new Date(typeof dateStr === "number" ? dateStr : dateStr)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function statusColor(
  status: string | undefined
): "green" | "orange" | "grey" | "red" {
  switch (status) {
    case "READY":
      return "green"
    case "BUILDING":
    case "QUEUED":
    case "INITIALIZING":
      return "orange"
    case "ERROR":
    case "CANCELED":
      return "red"
    default:
      return "grey"
  }
}

const StorefrontSection = () => {
  const { data: status, isPending, isError } = useStorefrontStatus()
  const { mutateAsync: provision, isPending: isProvisioning } =
    useProvisionStorefront()
  const { mutateAsync: redeploy, isPending: isRedeploying } =
    useRedeployStorefront()
  const { mutateAsync: remove, isPending: isRemoving } =
    useRemoveStorefront()
  const prompt = usePrompt()
  const [showDetails, setShowDetails] = useState(false)

  const handleProvision = async () => {
    const confirmed = await prompt({
      title: "Enable Storefront",
      description:
        "This will deploy a customer-facing storefront for your store. Your products will be available at your unique subdomain.",
      confirmText: "Enable",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    try {
      const result = await provision()
      toast.success("Storefront enabled", {
        description: `Deploying to ${result.storefront_url}`,
      })
    } catch (e: any) {
      toast.error("Could not enable storefront", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  const handleRedeploy = async () => {
    try {
      const result = await redeploy({ update_env: true })
      toast.success("Redeployment triggered", {
        description: `Deployment ${result.deployment.id} is ${result.deployment.status}`,
      })
    } catch (e: any) {
      toast.error("Redeploy failed", {
        description: e?.message || "Could not trigger redeployment",
      })
    }
  }

  const handleRemove = async () => {
    const confirmed = await prompt({
      title: "Remove Storefront",
      description:
        "This will delete the Vercel project, remove the DNS record, and clear all storefront metadata. This action cannot be undone. You can re-enable the storefront later.",
      confirmText: "Remove",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    try {
      const result = await remove()
      toast.success("Storefront removed", {
        description: result.message,
      })
    } catch (e: any) {
      toast.error("Could not remove storefront", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Storefront</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Loading...
          </Text>
        </div>
      </Container>
    )
  }

  if (isError || !status) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Storefront</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Could not load storefront status
          </Text>
        </div>
      </Container>
    )
  }

  if (!status.provisioned) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Storefront</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              No storefront deployed yet
            </Text>
          </div>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle mb-3">
            Enable a customer-facing storefront for your store. Your products
            will be available at your unique subdomain where customers can browse
            and purchase.
          </Text>
          <Button
            size="small"
            onClick={handleProvision}
            disabled={isProvisioning}
          >
            {isProvisioning ? "Enabling..." : "Enable Storefront"}
          </Button>
        </div>
      </Container>
    )
  }

  const deployStatus = status.latest_deployment?.status
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Storefront</Heading>
          <Badge color="green" size="2xsmall">
            Live
          </Badge>
        </div>
        <div className="flex items-center gap-x-2">
          {status.storefront_url && (
            <a
              href={status.storefront_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="secondary" size="small">
                <ArrowUpRightOnBox className="mr-1" />
                Visit Store
              </Button>
            </a>
          )}
          <Button
            variant="secondary"
            size="small"
            onClick={handleRedeploy}
            disabled={isRedeploying}
          >
            <ArrowPath className="mr-1" />
            {isRedeploying ? "Deploying..." : "Redeploy"}
          </Button>
        </div>
      </div>

      <div className="px-6 py-4 space-y-3">
        <div className="grid grid-cols-2 gap-y-2">
          <Text size="small" className="text-ui-fg-subtle">
            Domain
          </Text>
          <Text size="small">{status.domain || "—"}</Text>

          <Text size="small" className="text-ui-fg-subtle">
            Status
          </Text>
          <div className="flex items-center gap-x-2">
            {status.latest_deployment ? (
              <>
                <Badge
                  color={statusColor(deployStatus)}
                  size="2xsmall"
                >
                  {deployStatus || "unknown"}
                </Badge>
                <Text size="small" className="text-ui-fg-subtle">
                  {formatDate(status.latest_deployment.created_at)}
                </Text>
              </>
            ) : (
              <Text size="small">—</Text>
            )}
          </div>

          <Text size="small" className="text-ui-fg-subtle">
            Enabled
          </Text>
          <Text size="small">{formatDate(status.provisioned_at)}</Text>
        </div>

        {showDetails && (
          <div className="grid grid-cols-2 gap-y-2 pt-2 border-t border-ui-border-base">
            <Text size="small" className="text-ui-fg-subtle">
              Project
            </Text>
            <Text size="small" className="font-mono text-xs">
              {status.project?.name || "—"}
            </Text>

            {status.latest_deployment && (
              <>
                <Text size="small" className="text-ui-fg-subtle">
                  Deploy URL
                </Text>
                <Text size="small" className="font-mono text-xs truncate">
                  {status.latest_deployment.url}
                </Text>
              </>
            )}

            {status.error && (
              <>
                <Text size="small" className="text-ui-fg-subtle">
                  Error
                </Text>
                <Text size="small" className="text-ui-fg-error">
                  {status.error}
                </Text>
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-ui-fg-interactive text-xs hover:underline"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          <Button
            variant="danger"
            size="small"
            onClick={handleRemove}
            disabled={isRemoving}
          >
            {isRemoving ? "Removing..." : "Remove Storefront"}
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const SettingsStores = () => {
  const { stores, isPending, isError, error } = usePartnerStores()
  if (isError) {
    throw error
  }

  const store = stores?.[0]

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>Store</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Manage your store's details
          </Text>
        </div>

        {isPending ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              Loading...
            </Text>
          </div>
        ) : !store ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No store
            </Text>
          </div>
        ) : (
          <>
            <SectionRow title="Name" value={store?.name || "-"} />

            <SectionRow
              title="Default currency"
              value={
                store?.region?.[0]?.currency_code ? (
                  <Badge size="2xsmall">
                    {String(store.region[0].currency_code).toUpperCase()}
                  </Badge>
                ) : (
                  "-"
                )
              }
            />

            <SectionRow
              title="Default region"
              value={
                store?.region?.[0]?.name ? (
                  <Badge size="2xsmall">{String(store.region[0].name)}</Badge>
                ) : (
                  "-"
                )
              }
            />

            <SectionRow
              title="Default sales channel"
              value={
                store?.sales_channel?.[0]?.name ? (
                  <Badge size="2xsmall">
                    {String(store.sales_channel[0].name)}
                  </Badge>
                ) : (
                  "-"
                )
              }
            />

            <SectionRow
              title="Default location"
              value={
                store?.location?.[0]?.name ? (
                  <Badge size="2xsmall">{String(store.location[0].name)}</Badge>
                ) : (
                  "-"
                )
              }
            />
          </>
        )}
      </Container>

      {store && <StorefrontSection />}
    </SingleColumnPage>
  )
}
