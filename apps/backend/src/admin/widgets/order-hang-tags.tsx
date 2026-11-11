import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { fetchHangTagData } from "../components/hang-tag/generate-pdf"
import { HangTagReviewDrawer, ReviewTag } from "../components/hang-tag/review-drawer"
import { sdk } from "../lib/config"

/**
 * Hang tags for an order (#2541): one tag per piece ordered, in the brand of
 * your choice (ours or a white-label profile), with each product's maker
 * story, care text and a blank MRP line. Opens the review step, where the
 * text is checked before the PDF is made.
 */
type AdminOrder = { id: string }

type OrderHangTagLine = {
  line_item_id: string
  product_id: string | null
  product_handle: string | null
  title: string | null
  variant_title: string | null
  quantity: number
}

type OrderHangTags = {
  order: { id: string; display_id: number | null; customer_name: string | null }
  lines: OrderHangTagLine[]
  tag_count: number
}

/** A placeholder variant name says nothing on a tag. */
const variantLine = (v: string | null) =>
  v && !/^(default|default variant|custom design)$/i.test(v.trim()) ? v : ""

const OrderHangTagsWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const [open, setOpen] = useState(false)
  const [tags, setTags] = useState<ReviewTag[]>([])
  const [loading, setLoading] = useState(false)

  const { data, isPending, isError } = useQuery({
    queryKey: ["order-hang-tags", order.id],
    queryFn: () => sdk.client.fetch<OrderHangTags>(`/admin/orders/${order.id}/hang-tags`),
  })

  const skipped = (data?.lines ?? []).filter((l) => !l.product_id)

  const prepare = async () => {
    if (!data) return
    setLoading(true)
    try {
      const printable = data.lines.filter((l) => l.product_id && l.product_handle)
      const productIds = Array.from(new Set(printable.map((l) => l.product_id as string)))
      const results = await Promise.allSettled(productIds.map((id) => fetchHangTagData(id)))
      const byProduct = new Map<string, Awaited<ReturnType<typeof fetchHangTagData>>>()
      results.forEach((r, i) => {
        if (r.status === "fulfilled") byProduct.set(productIds[i], r.value)
      })
      const next: ReviewTag[] = []
      for (const l of printable) {
        const product = byProduct.get(l.product_id as string)
        if (!product) {
          toast.warning(`Skipped "${l.title}": could not load the product`)
          continue
        }
        next.push({
          key: l.line_item_id,
          data: product,
          variant_line: variantLine(l.variant_title),
          copies: l.quantity,
        })
      }
      if (!next.length) {
        toast.error("No line in this order has a product to tag")
        return
      }
      setTags(next)
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Hang tags</Heading>
        <Button
          size="small"
          variant="secondary"
          onClick={prepare}
          isLoading={loading}
          disabled={isPending || isError || !data?.tag_count}
        >
          Make tags
        </Button>
      </div>
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {isPending
            ? "Loading..."
            : isError
              ? "Could not load the order lines"
              : `${data.tag_count} tag${data.tag_count === 1 ? "" : "s"}, one per piece, with the maker story, care and a blank MRP line for white-label brands.`}
        </Text>
        {skipped.length > 0 && (
          <Text size="xsmall" className="text-ui-fg-muted mt-1">
            {skipped.length} line(s) have no product and get no tag.
          </Text>
        )}
      </div>
      <HangTagReviewDrawer
        open={open}
        onOpenChange={setOpen}
        tags={tags}
        title={`Hang tags for order #${data?.order.display_id ?? ""}${data?.order.customer_name ? ` (${data.order.customer_name})` : ""}`}
      />
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default OrderHangTagsWidget
