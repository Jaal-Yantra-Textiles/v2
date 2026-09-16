import {
  Button,
  Checkbox,
  FocusModal,
  Heading,
  Input,
  Text,
  toast,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { sdk } from "../../lib/config"
import { useDesigns } from "../../hooks/api/designs"
import { DesignOrderPreviewDrawer } from "../../components/designs/design-order-preview-drawer"
import {
  designOrderCreateBody,
  designOrderRoutes,
  resolveDesignOrderTarget,
  type DesignForOrder,
} from "../../components/designs/design-order-draft"

/**
 * Start a design order from `/design-orders`.
 *
 * The flow already existed, on the DESIGNS list page — you found the designs
 * first and the order appeared somewhere else. Which meant the screen named
 * "Design Orders" was the one place you could not start one, and an operator
 * who arrived here looking for that had nowhere to go.
 *
 * Nothing new on the backend: this calls the same two routes the designs page
 * does (`/admin/designs/draft-order{,/preview}`, or the customer twins), and
 * reuses the same preview drawer, so a draft started here and one started
 * there are the same object priced the same way. The rule deciding WHICH of
 * those doors to use, and for which buyer, is shared from `design-order-draft`
 * rather than written out a second time.
 */

const PAGE_SIZE = 20

type PreviewResponse = {
  estimates: any[]
  currency_code: string
  total: number
}

export const StartDesignOrderModal = ({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) => {
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<Record<string, DesignForOrder>>({})
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  /** Frozen at preview time, so editing the basket behind the drawer cannot
   *  change what the confirm button posts. */
  const [target, setTarget] = useState<{
    customer_id: string | null
    design_ids: string[]
  } | null>(null)

  const { designs, isLoading } = useDesigns(
    { limit: PAGE_SIZE, ...(search ? { q: search } : {}) } as any,
    { placeholderData: keepPreviousData } as any
  )

  const pickedList = useMemo(() => Object.values(picked), [picked])

  const reset = () => {
    setPicked({})
    setSearch("")
    setPreview(null)
    setTarget(null)
    setPreviewOpen(false)
  }

  const toggle = (design: any, on: boolean) => {
    setPicked((prev) => {
      const next = { ...prev }
      if (on) {
        next[design.id] = { id: design.id, customer_id: design.customer_id ?? null }
      } else {
        delete next[design.id]
      }
      return next
    })
  }

  const handleContinue = async () => {
    const resolved = resolveDesignOrderTarget(pickedList)
    if (!resolved.ok) {
      toast.error(resolved.error.title, { description: resolved.error.description })
      return
    }

    setIsPreviewing(true)
    try {
      const routes = designOrderRoutes(resolved.customer_id)
      const data = await sdk.client.fetch<PreviewResponse>(routes.preview, {
        method: "POST",
        body: { design_ids: resolved.design_ids },
      })
      setTarget({
        customer_id: resolved.customer_id,
        design_ids: resolved.design_ids,
      })
      setPreview(data)
      setPreviewOpen(true)
    } catch (err: any) {
      // Rendered, not swallowed — the message names what is missing.
      toast.error("Failed to estimate order", {
        description: err?.message || "An unexpected error occurred.",
      })
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleConfirm = async (
    priceOverrides: Record<string, number>,
    overrideCurrency?: string
  ) => {
    if (!target) return
    setIsCreating(true)
    try {
      const routes = designOrderRoutes(target.customer_id)
      await sdk.client.fetch(routes.create, {
        method: "POST",
        body: designOrderCreateBody({
          design_ids: target.design_ids,
          price_overrides: priceOverrides,
          override_currency: overrideCurrency,
        }),
      })
      toast.success("Checkout cart created", {
        description: target.customer_id
          ? "Share the checkout link with the customer to complete payment."
          : "No buyer is attached yet — the cart acquires one at checkout.",
      })
      reset()
      onOpenChange(false)
      onCreated()
    } catch (err: any) {
      toast.error("Failed to create order", {
        description: err?.message || "An unexpected error occurred.",
      })
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <>
      <FocusModal
        open={open}
        onOpenChange={(next) => {
          if (!next) reset()
          onOpenChange(next)
        }}
      >
        <FocusModal.Content>
          <FocusModal.Header>
            <div className="flex items-center gap-x-2">
              <Text size="small" className="text-ui-fg-subtle">
                {pickedList.length} selected
              </Text>
              <Button
                size="small"
                onClick={handleContinue}
                isLoading={isPreviewing}
                disabled={pickedList.length === 0 || isPreviewing}
              >
                Continue
              </Button>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="flex flex-col items-center overflow-y-auto py-8">
            <div className="flex w-full max-w-2xl flex-col gap-y-4">
              <div>
                <Heading level="h2">Start a design order</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Collate designs into one draft order. A buyer is optional —
                  the cart acquires one at checkout.
                </Text>
              </div>

              <Input
                placeholder="Search designs…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="divide-y rounded-lg border">
                {isLoading && (
                  <div className="px-4 py-6">
                    <Text size="small" className="text-ui-fg-subtle">
                      Loading designs…
                    </Text>
                  </div>
                )}
                {!isLoading && !(designs ?? []).length && (
                  <div className="px-4 py-6">
                    <Text size="small" className="text-ui-fg-subtle">
                      No designs found.
                    </Text>
                  </div>
                )}
                {(designs ?? []).map((d: any) => (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-center gap-x-3 px-4 py-3"
                  >
                    <Checkbox
                      checked={Boolean(picked[d.id])}
                      onCheckedChange={(v) => toggle(d, !!v)}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{d.name ?? d.id}</span>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {d.status}
                        {d.customer_id ? " · has a customer" : ""}
                      </Text>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>

      {preview && (
        <DesignOrderPreviewDrawer
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          estimates={preview.estimates ?? []}
          currencyCode={preview.currency_code}
          total={preview.total}
          onConfirm={handleConfirm}
          isConfirming={isCreating}
        />
      )}
    </>
  )
}
