import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import {
  Container,
  Heading,
  Text,
  StatusBadge,
  Button,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import {
  useArtisanProposal,
  useApproveArtisanProduct,
  useRejectArtisanProduct,
} from "../hooks/api/partner-product-approval"

type ProductLike = { id: string }

const STATUS_META: Record<
  string,
  { label: string; color: "orange" | "green" | "red" | "grey" }
> = {
  proposed: { label: "Pending review", color: "orange" },
  published: { label: "Approved", color: "green" },
  rejected: { label: "Rejected", color: "red" },
}

/**
 * Admin approval panel for an artisan partner's proposed product (#859 S2 / #861).
 *
 * Renders ONLY on artisan-owned products (those carrying a partner-product
 * link) — ordinary products, which can also be in native `proposed`/`rejected`
 * status, are left untouched. Approve publishes + cross-lists to the core
 * channel; Reject sets `rejected` with an optional reason that reaches the
 * artisan by email so they can revise and re-submit. Both call the dedicated
 * #875 endpoints so the transition emits `partner_product.approved`/`.rejected`
 * (not a noisy `product.updated`).
 */
const PartnerProductApprovalWidget = ({ data }: DetailWidgetProps<ProductLike>) => {
  const productId = data.id
  const { data: proposal, isLoading } = useArtisanProposal(productId)
  const approve = useApproveArtisanProduct(productId)
  const reject = useRejectArtisanProduct(productId)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")

  // Non-artisan products (and the initial load) render nothing.
  if (isLoading || !proposal?.is_artisan) {
    return null
  }

  const status = proposal.status ?? "proposed"
  const meta = STATUS_META[status] ?? { label: status, color: "grey" as const }
  const pending = approve.isPending || reject.isPending

  const handleApprove = async () => {
    try {
      await approve.mutateAsync()
      toast.success("Product approved", {
        description: "Published and cross-listed to the core storefront.",
      })
    } catch (err) {
      toast.error("Approve failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  const handleReject = async () => {
    try {
      await reject.mutateAsync(reason)
      toast.success("Product rejected", {
        description: "The artisan is emailed the reason and can re-submit.",
      })
      setRejecting(false)
      setReason("")
    } catch (err) {
      toast.error("Reject failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Artisan proposal</Heading>
        <StatusBadge color={meta.color}>{meta.label}</StatusBadge>
      </div>

      <div className="flex flex-col gap-y-4 px-6 py-4 text-sm">
        <Text className="text-ui-fg-subtle">
          {status === "proposed" &&
            "An artisan partner proposed this product. Approving publishes it and cross-lists it to the core storefront."}
          {status === "published" &&
            "This artisan product is approved and live on the core storefront."}
          {status === "rejected" &&
            "This artisan product was rejected. The artisan can revise and re-submit; you can also approve it directly to publish."}
        </Text>

        {rejecting ? (
          <div className="flex flex-col gap-y-2">
            <Text size="small" weight="plus">
              Reason for rejection (optional — emailed to the artisan)
            </Text>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Please add clearer photos and a fabric composition."
              rows={3}
            />
            <div className="flex gap-x-2">
              <Button
                size="small"
                variant="danger"
                onClick={handleReject}
                isLoading={reject.isPending}
                disabled={pending}
              >
                Confirm rejection
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  setRejecting(false)
                  setReason("")
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          (proposal.can_approve || proposal.can_reject) && (
            <div className="flex gap-x-2">
              {proposal.can_approve && (
                <Button
                  size="small"
                  variant="primary"
                  onClick={handleApprove}
                  isLoading={approve.isPending}
                  disabled={pending}
                >
                  Approve
                </Button>
              )}
              {proposal.can_reject && (
                <Button
                  size="small"
                  variant="danger"
                  onClick={() => setRejecting(true)}
                  disabled={pending}
                >
                  Reject
                </Button>
              )}
            </div>
          )
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default PartnerProductApprovalWidget
