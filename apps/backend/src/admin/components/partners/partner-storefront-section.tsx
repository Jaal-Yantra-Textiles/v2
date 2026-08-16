import { Badge, Button, Container, Drawer, Heading, InlineTip, Input, Text, toast, usePrompt } from "@medusajs/ui"
import { ArrowUpRightOnBox, Globe, XMark } from "@medusajs/icons"
import { useState } from "react"
import {
  useStorefrontStatus,
  useProvisionStorefront,
  useStorefrontDomain,
  useAddStorefrontDomain,
  useVerifyStorefrontDomain,
  useRemoveStorefrontDomain,
  type DomainStatus,
} from "../../hooks/api/storefront"
import { ActionMenu } from "../common/action-menu"

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

type DnsRow = { type: string; host: string; value: string }

const DnsTable = ({ rows }: { rows: DnsRow[] }) => (
  <div className="rounded-lg border border-ui-border-base overflow-hidden">
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-ui-bg-subtle border-b border-ui-border-base">
          <th className="px-3 py-2 text-left text-ui-fg-subtle font-normal">Type</th>
          <th className="px-3 py-2 text-left text-ui-fg-subtle font-normal">Host</th>
          <th className="px-3 py-2 text-left text-ui-fg-subtle font-normal">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((rec, i) => (
          <tr key={i}>
            <td className="px-3 py-2 font-mono text-xs">{rec.type}</td>
            <td className="px-3 py-2 font-mono text-xs">{rec.host}</td>
            <td className="px-3 py-2 font-mono text-xs break-all">{rec.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

/**
 * Drawer for managing the partner's storefront custom domain. Mirrors the
 * partner-portal's `CustomDomainSection` flow (add → verify → DNS instructions
 * → remove) but driven from the admin side through the admin proxy routes.
 *
 * The backend supports a single custom domain per partner, so the drawer
 * switches between an "add" form (no domain yet) and a "manage" view
 * (existing domain + DNS instructions + verify/remove).
 */
const DomainDrawer = ({
  partnerId,
  open,
  onOpenChange,
  domainStatus,
}: {
  partnerId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  domainStatus: DomainStatus | undefined
}) => {
  const { mutateAsync: addDomain, isPending: isAdding } =
    useAddStorefrontDomain(partnerId)
  const { mutateAsync: verifyDomain, isPending: isVerifying } =
    useVerifyStorefrontDomain(partnerId)
  const { mutateAsync: removeDomain, isPending: isRemoving } =
    useRemoveStorefrontDomain(partnerId)
  const prompt = usePrompt()

  const [domainInput, setDomainInput] = useState("")
  const [addResult, setAddResult] = useState<{
    domain: string
    verified: boolean
    verification?: Array<{ type: string; domain: string; value: string }> | null
    misconfigured: boolean
    configured_by: string | null
    dns_records?: Array<{ type: string; host: string; value: string }>
    error?: string | null
  } | null>(null)

  const handleAdd = async () => {
    const value = domainInput.trim()
    if (!value) return

    try {
      const result = await addDomain({ domain: value })
      setAddResult(result)
      setDomainInput("")
      if (result.error) {
        toast.error("Domain saved, but attach failed", {
          description: result.error,
        })
      } else {
        toast.success("Domain added", {
          description: result.verified
            ? "Domain verified. Configure DNS to point it at the storefront."
            : "Domain added. Follow the verification steps below.",
        })
      }
    } catch (e: any) {
      toast.error("Could not add domain", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  const handleVerify = async () => {
    try {
      const result = await verifyDomain()
      setAddResult(result)
      if (result.verified) {
        toast.success("Domain verified")
      } else if (result.error) {
        toast.error("Couldn't attach domain", { description: result.error })
      } else {
        const hasTxt = (result.verification?.length ?? 0) > 0
        const hasDns = (result.dns_records?.length ?? 0) > 0
        toast.warning("Domain not yet verified", {
          description: hasTxt
            ? "Add the TXT record(s) shown below to verify ownership, then check again."
            : hasDns
            ? "Add the DNS record(s) shown below at the domain provider, then check again in a few minutes."
            : "Still attaching the domain — give it a minute, then check again.",
        })
      }
    } catch (e: any) {
      toast.error("Verification failed", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  const handleRemove = async () => {
    const confirmed = await prompt({
      title: "Remove Custom Domain",
      description:
        "This will remove the custom domain from the partner's storefront. The storefront will still be accessible via the default subdomain.",
      confirmText: "Remove",
      cancelText: "Cancel",
    })
    if (!confirmed) return

    try {
      const result = await removeDomain()
      setAddResult(null)
      if (result?.warnings?.length) {
        toast.warning("Custom domain removed", {
          description:
            "Some records may still be clearing at the host: " +
            result.warnings.join("; "),
        })
      } else {
        toast.success("Custom domain removed")
      }
    } catch (e: any) {
      toast.error("Could not remove domain", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  const hasDomain = domainStatus?.configured && !!domainStatus.domain
  const currentDomain = domainStatus?.domain || addResult?.domain
  const isVerified = domainStatus?.verified ?? addResult?.verified ?? false
  const isMisconfigured =
    domainStatus?.misconfigured ?? addResult?.misconfigured ?? true
  const isActive = isVerified && !isMisconfigured
  const verification = addResult?.verification || domainStatus?.verification || []
  const dnsRecords = domainStatus?.dns_records || addResult?.dns_records || []

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Storefront domain</Drawer.Title>
          <Drawer.Description>
            {hasDomain
              ? "Manage the custom domain attached to this partner's storefront."
              : "Connect a custom domain to this partner's storefront."}
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          {!hasDomain && !addResult ? (
            <div className="space-y-3">
              <Text size="small" className="text-ui-fg-subtle">
                Enter the domain the partner wants to use (e.g.
                shop.example.com). DNS configuration instructions will be shown
                after the domain is attached.
              </Text>
              <div className="flex items-center gap-x-2">
                <Input
                  placeholder="shop.example.com"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAdd()
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  size="small"
                  onClick={handleAdd}
                  disabled={isAdding || !domainInput.trim()}
                >
                  {isAdding ? "Adding..." : "Add Domain"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-x-2">
                  <Text size="small" weight="plus">
                    {currentDomain}
                  </Text>
                  {isVerified && !isMisconfigured ? (
                    <Badge color="green" size="2xsmall">Active</Badge>
                  ) : isVerified && isMisconfigured ? (
                    <Badge color="orange" size="2xsmall">DNS Pending</Badge>
                  ) : (
                    <Badge color="red" size="2xsmall">Unverified</Badge>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleRemove}
                  disabled={isRemoving}
                >
                  <XMark className="mr-1" />
                  {isRemoving ? "Removing..." : "Remove"}
                </Button>
              </div>

              {isActive ? (
                <InlineTip variant="success" label="Domain Active">
                  The custom domain is configured and serving the storefront.
                </InlineTip>
              ) : (
                <div className="space-y-3">
                  {verification.length > 0 && (
                    <>
                      <InlineTip variant="warning" label="Verify Domain Ownership">
                        Add the following TXT record at the partner's DNS
                        provider to verify ownership of this domain.
                      </InlineTip>
                      <DnsTable
                        rows={verification.map((v) => ({
                          type: v.type,
                          host: v.domain,
                          value: v.value,
                        }))}
                      />
                    </>
                  )}

                  {dnsRecords.length > 0 && (
                    <>
                      <InlineTip variant="info" label="Point the Domain">
                        Add the DNS record{dnsRecords.length > 1 ? "s" : ""} below
                        at the domain provider so it resolves to the storefront.
                        DNS changes can take up to 48 hours to propagate.
                      </InlineTip>
                      <DnsTable rows={dnsRecords} />
                    </>
                  )}

                  {verification.length === 0 && dnsRecords.length === 0 && (
                    <InlineTip variant="info" label="Setting Up Domain">
                      Still attaching the domain to the storefront. This can take
                      a few minutes — click Check Status to refresh.
                    </InlineTip>
                  )}

                  <Button
                    size="small"
                    variant="secondary"
                    onClick={handleVerify}
                    disabled={isVerifying}
                  >
                    {isVerifying ? "Checking..." : "Check Status"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button
            size="small"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

export const PartnerStorefrontSection = ({ partnerId }: { partnerId: string }) => {
  const { data: status, isPending, isError } = useStorefrontStatus(partnerId)
  const { mutateAsync: provision, isPending: isProvisioning } = useProvisionStorefront(partnerId)
  const { data: domainStatus } = useStorefrontDomain(partnerId, {
    enabled: !!status?.provisioned,
  })
  const prompt = usePrompt()
  const [showDetails, setShowDetails] = useState(false)
  const [domainDrawerOpen, setDomainDrawerOpen] = useState(false)

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
  const hasCustomDomain =
    domainStatus?.configured && !!domainStatus.domain
  const domainActive =
    hasCustomDomain &&
    domainStatus!.verified &&
    !domainStatus!.misconfigured
  const visitUrl = domainActive
    ? `https://${domainStatus!.domain}`
    : status.storefront_url

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Storefront</Heading>
          <Badge color="green" size="2xsmall">Live</Badge>
        </div>
        <div className="flex items-center gap-x-2">
          {visitUrl && (
            <a
              href={visitUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="secondary" size="small">
                <ArrowUpRightOnBox className="mr-1" />
                Visit
              </Button>
            </a>
          )}
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    icon: <Globe />,
                    label: hasCustomDomain
                      ? "Manage domain"
                      : "Add domain",
                    onClick: () => setDomainDrawerOpen(true),
                  },
                ],
              },
            ]}
          />
        </div>
      </div>

      <div className="px-6 py-4 space-y-3">
        <div className="grid grid-cols-2 gap-y-2">
          <Text size="small" className="text-ui-fg-subtle">Domain</Text>
          <Text size="small">
            {status.domain || "—"}
          </Text>

          {hasCustomDomain && (
            <>
              <Text size="small" className="text-ui-fg-subtle">Custom Domain</Text>
              <div className="flex items-center gap-x-2">
                <Text size="small">{domainStatus!.domain}</Text>
                {domainStatus!.verified && !domainStatus!.misconfigured ? (
                  <Badge color="green" size="2xsmall">Active</Badge>
                ) : domainStatus!.verified ? (
                  <Badge color="orange" size="2xsmall">DNS Pending</Badge>
                ) : (
                  <Badge color="red" size="2xsmall">Unverified</Badge>
                )}
              </div>
            </>
          )}

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

      <DomainDrawer
        partnerId={partnerId}
        open={domainDrawerOpen}
        onOpenChange={setDomainDrawerOpen}
        domainStatus={domainStatus}
      />
    </Container>
  )
}
