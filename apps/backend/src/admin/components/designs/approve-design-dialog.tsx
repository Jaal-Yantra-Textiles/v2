import { Button, Drawer, Heading, RadioGroup, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"

import { AdminDesign, useApproveDesign } from "../../hooks/api/designs"

/**
 * 🔑 #2030 item 3 — approving ASKS which size, instead of silently minting a
 * product with none.
 *
 * The minter has one variant to give, and it can only name a size when the
 * answer is unambiguous. A design stating S and M is not ambiguous to the
 * OPERATOR — they know which one this listing is for — it is only ambiguous to
 * the code. So the code asks.
 *
 * What this replaces: a plain "Approve?" confirm. A design with two sizes
 * minted a variant called `CUSTOM-<design_id>`, with no size anywhere on it,
 * and nothing said so. Someone then added the real sizes by hand minutes later
 * and relabelled that placeholder — which is how order 89's line has read
 * "Small" ever since while every run that made it says Medium.
 *
 * The rule this encodes: approving without a size stays POSSIBLE, because some
 * designs genuinely have none. It just stops being silent.
 */
export const ApproveDesignDialog = ({
  design,
  open,
  onClose,
}: {
  design: AdminDesign
  open: boolean
  onClose: () => void
}) => {
  const approveMutation = useApproveDesign(design.id)

  /** Usable size labels, blanks dropped — `""` is not a size. */
  const sizes = useMemo(() => {
    const labels = ((design as any)?.size_sets || [])
      .map((s: any) => String(s?.size_label ?? "").trim())
      .filter((l: string) => l.length > 0)
    return Array.from(new Set<string>(labels))
  }, [design])

  const [choice, setChoice] = useState<string | null>(null)

  // A single size needs no decision — preselect it so the operator confirms
  // what they are getting rather than restating it.
  useEffect(() => {
    if (!open) return
    setChoice(sizes.length === 1 ? sizes[0] : null)
  }, [open, sizes])

  const mustChoose = sizes.length > 1
  const canApprove = !mustChoose || !!choice

  const handleApprove = async () => {
    await approveMutation.mutateAsync(
      { size_label: choice },
      {
        onSuccess: (data) => {
          toast.success(
            `Design approved${data.product_id ? " and product created" : ""}${
              choice ? ` — listed as ${choice}` : " — with no size"
            }`
          )
          onClose()
        },
        onError: (error) => {
          toast.error(error.message || "Failed to approve design")
        },
      }
    )
  }

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <Drawer.Content className="flex flex-col">
        <Drawer.Header>
          <Drawer.Title asChild>
            <Heading level="h2">
              Approve “{design.name || "this design"}”
            </Heading>
          </Drawer.Title>
        </Drawer.Header>

        <Drawer.Body className="flex-1 overflow-y-auto">
          <Text size="small" className="text-ui-fg-subtle mb-4">
            This sets the design to Approved and creates the product listing.
          </Text>

          {/* No sizes at all — allowed, but said out loud. */}
          {sizes.length === 0 && (
            <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
              <Text size="small" weight="plus">
                This design states no sizes.
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                The product will list one variant with no size
                (<code>CUSTOM-{design.id}</code>). Orders for it cannot say which
                size was made — which is the defect that made order 89 read the
                wrong size. Add size sets to the design first if this garment has
                one.
              </Text>
            </div>
          )}

          {/* Exactly one — a confirmation, not a question. */}
          {sizes.length === 1 && (
            <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
              <Text size="small" weight="plus">
                Listing as size {sizes[0]}.
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                sku <code>CUSTOM-{design.id}-{sizes[0]}</code>
              </Text>
            </div>
          )}

          {/* Several — the operator decides, because the code cannot. */}
          {mustChoose && (
            <div className="flex flex-col gap-y-3">
              <div>
                <Text size="small" weight="plus">
                  This design states {sizes.length} sizes. Which is this product
                  for?
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  One listing carries one size. To sell every size, approve the
                  one you are listing now and add the others as variants.
                </Text>
              </div>

              <RadioGroup
                value={choice ?? ""}
                onValueChange={(v) => setChoice(v)}
              >
                {sizes.map((s: string) => (
                  <RadioGroup.ChoiceBox
                    key={s}
                    value={s}
                    label={s}
                    description={`sku CUSTOM-${design.id}-${s}`}
                  />
                ))}
              </RadioGroup>
            </div>
          )}
        </Drawer.Body>

        <Drawer.Footer>
          <Button variant="secondary" size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="small"
            onClick={handleApprove}
            isLoading={approveMutation.isPending}
            disabled={!canApprove}
          >
            {sizes.length === 0 ? "Approve without a size" : "Approve & create"}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
