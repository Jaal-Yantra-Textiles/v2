import { Badge, Button, Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { ArrowUpRightOnBox, ArrowPath } from "@medusajs/icons"
import { useState } from "react"
import {
  useStorefrontStatus,
  useProvisionStorefront,
  useRedeployStorefront,
} from "../../hooks/api/storefront"

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

function statusColor(status: string | undefined): "green" | "orange" | "grey" | "red" {
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

export const PartnerStorefrontSection = ({ partnerId }: { partnerId: string }) => {
  const { data: status, isPending, isError } = useStorefrontStatus(partnerId)
  const { mutateAsync: provision, isPending: isProvisioning } = useProvisionStorefront(partnerId)
  const { mutateAsync: redeploy, isPending: isRedeploying } = useRedeployStorefront(partnerId)
  const prompt = usePrompt()
  const [showDetails, setShowDetails] = useState(false)

  const handleProvision = async () => {
    const confirmed = await prompt({
      title: "Provision Storefront",
      description:
        "This will create a new Vercel project, deploy the storefront template, and assign a subdomain. The partner must have a store with a publishable API key.",
      confirmText: "Provision",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    try {
      const result = await provision()
      toast.success("Storefront provisioned", {
        description: `Deploying to ${result.storefront_url}`,
      })
    } catch (e: any) {
      toast.error("Provisioning failed", {
        description: e?.message || "Could not provision storefront",
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

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Storefront</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">Loading...</Text>
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

  // Not provisioned yet
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
            Provision a customer-facing storefront for this partner. This will create a
            Vercel deployment with the partner's publishable API key and assign a subdomain.
          </Text>
          <Button
            size="small"
            onClick={handleProvision}
            disabled={isProvisioning}
          >
            {isProvisioning ? "Provisioning..." : "Provision Storefront"}
          </Button>
        </div>
      </Container>
    )
  }

  // Provisioned
  const deployStatus = status.latest_deployment?.status
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Storefront</Heading>
          <Badge color="green" size="2xsmall">Live</Badge>
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
                Visit
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
          <Text size="small" className="text-ui-fg-subtle">Domain</Text>
          <Text size="small">
            {status.domain || "—"}
          </Text>

          <Text size="small" className="text-ui-fg-subtle">Vercel Project</Text>
          <Text size="small">{status.project?.name || "—"}</Text>

          <Text size="small" className="text-ui-fg-subtle">Provisioned</Text>
          <Text size="small">{formatDate(status.provisioned_at)}</Text>

          {status.latest_deployment && (
            <>
              <Text size="small" className="text-ui-fg-subtle">Latest Deploy</Text>
              <div className="flex items-center gap-x-2">
                <Badge color={statusColor(deployStatus)} size="2xsmall">
                  {deployStatus || "unknown"}
                </Badge>
                <Text size="small" className="text-ui-fg-subtle">
                  {formatDate(status.latest_deployment.created_at)}
                </Text>
              </div>
            </>
          )}
        </div>

        {showDetails && (
          <div className="grid grid-cols-2 gap-y-2 pt-2 border-t border-ui-border-base">
            <Text size="small" className="text-ui-fg-subtle">Project ID</Text>
            <Text size="small" className="font-mono text-xs">{status.project?.id || "—"}</Text>

            {status.latest_deployment && (
              <>
                <Text size="small" className="text-ui-fg-subtle">Deploy URL</Text>
                <Text size="small" className="font-mono text-xs truncate">
                  {status.latest_deployment.url}
                </Text>
              </>
            )}

            {status.error && (
              <>
                <Text size="small" className="text-ui-fg-subtle">Error</Text>
                <Text size="small" className="text-ui-fg-error">{status.error}</Text>
              </>
            )}
          </div>
        )}

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-ui-fg-interactive text-xs hover:underline"
        >
          {showDetails ? "Hide details" : "Show details"}
        </button>
      </div>
    </Container>
  )
}
