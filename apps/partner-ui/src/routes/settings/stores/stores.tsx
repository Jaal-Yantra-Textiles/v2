import {
  Badge,
  Button,
  Container,
  Heading,
  InlineTip,
  Input,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { ArrowUpRightOnBox, ArrowPath, XMark, PencilSquare } from "@medusajs/icons"
import { useState } from "react"
import { Link } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { GeneralSectionSkeleton, Skeleton } from "../../../components/common/skeleton"
import { SectionRow } from "../../../components/common/section"
import { ActionMenu } from "../../../components/common/action-menu"
import { usePartnerStores } from "../../../hooks/api/partner-stores"
import {
  useStorefrontStatus,
  useProvisionStorefront,
  useRedeployStorefront,
  useRemoveStorefront,
  useStorefrontDomain,
  useAddStorefrontDomain,
  useVerifyStorefrontDomain,
  useRemoveStorefrontDomain,
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
  const { data: domainStatus } = useStorefrontDomain({
    enabled: !!status?.provisioned,
  })
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
    return <GeneralSectionSkeleton rowCount={3} />
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
  const hasError = !!status.error
  const customDomainActive =
    domainStatus?.configured &&
    domainStatus?.verified &&
    !domainStatus?.misconfigured
  const visitUrl = customDomainActive
    ? `https://${domainStatus!.domain}`
    : status.storefront_url

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Storefront</Heading>
          {hasError ? (
            <Badge color="orange" size="2xsmall">
              Error
            </Badge>
          ) : (
            <Badge color="green" size="2xsmall">
              Live
            </Badge>
          )}
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

          {domainStatus?.configured && domainStatus.domain && (
            <>
              <Text size="small" className="text-ui-fg-subtle">
                Custom Domain
              </Text>
              <div className="flex items-center gap-x-2">
                <Text size="small">{domainStatus.domain}</Text>
                {domainStatus.verified && !domainStatus.misconfigured ? (
                  <Badge color="green" size="2xsmall">
                    Active
                  </Badge>
                ) : domainStatus.verified ? (
                  <Badge color="orange" size="2xsmall">
                    DNS Pending
                  </Badge>
                ) : (
                  <Badge color="red" size="2xsmall">
                    Unverified
                  </Badge>
                )}
              </div>
            </>
          )}

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

const CustomDomainSection = () => {
  const { data: domainStatus, isPending } = useStorefrontDomain()
  const { mutateAsync: addDomain, isPending: isAdding } =
    useAddStorefrontDomain()
  const { mutateAsync: verifyDomain, isPending: isVerifying } =
    useVerifyStorefrontDomain()
  const { mutateAsync: removeDomain, isPending: isRemoving } =
    useRemoveStorefrontDomain()
  const prompt = usePrompt()

  const [domainInput, setDomainInput] = useState("")
  const [addResult, setAddResult] = useState<{
    domain: string
    verified: boolean
    verification?: Array<{
      type: string
      domain: string
      value: string
    }> | null
    misconfigured: boolean
    configured_by: string | null
    dns_records?: Array<{ type: string; host: string; value: string }>
  } | null>(null)

  const handleAdd = async () => {
    const value = domainInput.trim()
    if (!value) return

    try {
      const result = await addDomain({ domain: value })
      setAddResult(result)
      setDomainInput("")
      toast.success("Domain added", {
        description: result.verified
          ? "Domain verified. Configure your DNS to point it to your storefront."
          : "Domain added. Follow the verification steps below.",
      })
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
      } else {
        toast.warning("Domain not yet verified", {
          description: "Make sure the TXT record is set and try again.",
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
        "This will remove the custom domain from your storefront. Your storefront will still be accessible via the default subdomain.",
      confirmText: "Remove",
      cancelText: "Cancel",
    })
    if (!confirmed) return

    try {
      await removeDomain()
      setAddResult(null)
      toast.success("Custom domain removed")
    } catch (e: any) {
      toast.error("Could not remove domain", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  if (isPending) {
    return <GeneralSectionSkeleton rowCount={2} />
  }

  const hasDomain = domainStatus?.configured && domainStatus.domain
  const currentDomain = domainStatus?.domain || addResult?.domain
  const isVerified =
    domainStatus?.verified ?? addResult?.verified ?? false
  const isMisconfigured =
    domainStatus?.misconfigured ?? addResult?.misconfigured ?? true
  const verification = addResult?.verification
  const dnsRecords =
    domainStatus?.dns_records || addResult?.dns_records || []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Custom Domain</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Connect your own domain to your storefront
          </Text>
        </div>
      </div>

      {!hasDomain && !addResult ? (
        <div className="px-6 py-4 space-y-3">
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
        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-x-2">
              <Text size="small" weight="plus">
                {currentDomain}
              </Text>
              {isVerified && !isMisconfigured ? (
                <Badge color="green" size="2xsmall">
                  Active
                </Badge>
              ) : isVerified && isMisconfigured ? (
                <Badge color="orange" size="2xsmall">
                  DNS Pending
                </Badge>
              ) : (
                <Badge color="red" size="2xsmall">
                  Unverified
                </Badge>
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

          {!isVerified && verification && verification.length > 0 && (
            <div className="space-y-3">
              <InlineTip variant="warning" label="Domain Verification Required">
                Add the following TXT record at your DNS provider to verify
                ownership of this domain.
              </InlineTip>

              <div className="rounded-lg border border-ui-border-base overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-ui-bg-subtle border-b border-ui-border-base">
                      <th className="px-3 py-2 text-left text-ui-fg-subtle font-normal">
                        Type
                      </th>
                      <th className="px-3 py-2 text-left text-ui-fg-subtle font-normal">
                        Host
                      </th>
                      <th className="px-3 py-2 text-left text-ui-fg-subtle font-normal">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {verification.map((v, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-mono text-xs">
                          {v.type}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {v.domain}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs break-all">
                          {v.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button
                size="small"
                variant="secondary"
                onClick={handleVerify}
                disabled={isVerifying}
              >
                {isVerifying ? "Verifying..." : "Verify Domain"}
              </Button>
            </div>
          )}

          {isVerified && isMisconfigured && (
            <div className="space-y-3">
              <InlineTip variant="info" label="DNS Configuration Required">
                Point your domain to Vercel by adding the DNS record{dnsRecords.length > 1 ? "s" : ""} below at
                your domain provider. DNS changes can take up to 48 hours to
                propagate.
              </InlineTip>

              <div className="rounded-lg border border-ui-border-base overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-ui-bg-subtle border-b border-ui-border-base">
                      <th className="px-3 py-2 text-left text-ui-fg-subtle font-normal">
                        Type
                      </th>
                      <th className="px-3 py-2 text-left text-ui-fg-subtle font-normal">
                        Host
                      </th>
                      <th className="px-3 py-2 text-left text-ui-fg-subtle font-normal">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dnsRecords.map((rec, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-mono text-xs">
                          {rec.type}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {rec.host}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs break-all">
                          {rec.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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

          {isVerified && !isMisconfigured && (
            <InlineTip variant="success" label="Domain Active">
              Your custom domain is configured and serving your storefront.
            </InlineTip>
          )}
        </div>
      )}
    </Container>
  )
}

const StorefrontDomainWrapper = () => {
  const { data: status, isPending } = useStorefrontStatus()
  if (isPending || !status?.provisioned) return null
  return <CustomDomainSection />
}

export const SettingsStores = () => {
  const { stores, isPending, isError, error } = usePartnerStores()
  if (isError) {
    throw error
  }

  const store = stores?.[0]
  const currencies = store?.supported_currencies || []
  const region = store?.region?.[0]
  const salesChannel = store?.sales_channel?.[0]
  const location = store?.location?.[0]

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet>
      {/* Store General Section */}
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>Store</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage your store's details
            </Text>
          </div>
          {store && (
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      icon: <PencilSquare />,
                      label: "Edit Store Details",
                      to: "/settings/store/edit",
                    },
                  ],
                },
              ]}
            />
          )}
        </div>

        {isPending ? (
          <div className="px-6 py-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-2 items-center">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
            ))}
          </div>
        ) : !store ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No store found. Complete onboarding to create your store.
            </Text>
          </div>
        ) : (
          <>
            <div className="text-ui-fg-subtle grid grid-cols-2 px-6 py-4">
              <Text size="small" leading="compact" weight="plus">
                Name
              </Text>
              <Text size="small" leading="compact">
                {store.name || "-"}
              </Text>
            </div>

            <div className="text-ui-fg-subtle grid grid-cols-2 px-6 py-4">
              <Text size="small" leading="compact" weight="plus">
                Default Currency
              </Text>
              {currencies.length > 0 ? (
                <div className="flex items-center gap-x-2 flex-wrap">
                  {currencies
                    .filter((c: any) => c.is_default)
                    .map((c: any) => (
                      <div key={c.currency_code} className="flex items-center gap-x-2">
                        <Badge size="2xsmall">
                          {c.currency_code?.toUpperCase()}
                        </Badge>
                      </div>
                    ))}
                </div>
              ) : (
                <Text size="small" leading="compact">-</Text>
              )}
            </div>

            <div className="text-ui-fg-subtle grid grid-cols-2 px-6 py-4">
              <Text size="small" leading="compact" weight="plus">
                Default Region
              </Text>
              <div className="flex items-center gap-x-2">
                {region ? (
                  <Badge size="2xsmall" asChild>
                    <Link to={`/settings/regions/${region.id || ""}`}>
                      {region.name}
                    </Link>
                  </Badge>
                ) : (
                  <Text size="small" leading="compact">-</Text>
                )}
              </div>
            </div>

            <div className="text-ui-fg-subtle grid grid-cols-2 px-6 py-4">
              <Text size="small" leading="compact" weight="plus">
                Default Sales Channel
              </Text>
              <div className="flex items-center gap-x-2">
                {salesChannel ? (
                  <Badge size="2xsmall" asChild>
                    <Link to={`/settings/sales-channels/${salesChannel.id || ""}`}>
                      {salesChannel.name}
                    </Link>
                  </Badge>
                ) : (
                  <Text size="small" leading="compact">-</Text>
                )}
              </div>
            </div>

            <div className="text-ui-fg-subtle grid grid-cols-2 px-6 py-4">
              <Text size="small" leading="compact" weight="plus">
                Default Location
              </Text>
              <div className="flex items-center gap-x-2">
                {location ? (
                  <Badge size="2xsmall" asChild>
                    <Link to={`/settings/locations/${location.id || ""}`}>
                      {location.name}
                    </Link>
                  </Badge>
                ) : (
                  <Text size="small" leading="compact">-</Text>
                )}
              </div>
            </div>
          </>
        )}
      </Container>

      {/* Currencies Section */}
      {store && currencies.length > 0 && (
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading level="h2">Currencies</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Currencies supported by your store
              </Text>
            </div>
          </div>
          {currencies.map((c: any) => (
            <div key={c.currency_code} className="text-ui-fg-subtle grid grid-cols-2 px-6 py-4">
              <div className="flex items-center gap-x-2">
                <Badge size="2xsmall">
                  {c.currency_code?.toUpperCase()}
                </Badge>
                {c.is_default && (
                  <Badge size="2xsmall" color="blue">Default</Badge>
                )}
              </div>
              <Text size="small" leading="compact">
                {c.currency?.name || c.currency_code?.toUpperCase()}
              </Text>
            </div>
          ))}
        </Container>
      )}

      {store && <StorefrontSection />}
      {store && <StorefrontDomainWrapper />}
    </SingleColumnPage>
  )
}
