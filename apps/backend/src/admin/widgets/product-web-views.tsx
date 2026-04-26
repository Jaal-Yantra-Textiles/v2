import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Container, Heading, Skeleton, Text } from "@medusajs/ui"
import { useProduct } from "../hooks/api/products"

type ProductPageviewsEntry = {
  views?: number
  by_source?: Record<string, number>
  by_country?: Record<string, number>
}

type ProductPageviews = {
  daily?: Record<string, ProductPageviewsEntry>
  last_day?: string
  last_updated_at?: string
}

type AdminProduct = {
  id: string
  metadata?: Record<string, any>
}

const ProductWebViewsWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const productId = typeof data === "string" ? data : data?.id

  const {
    product,
    isPending: isLoading,
    isError,
    error,
  } = useProduct(
    productId!,
    {
      fields: "+metadata",
    },
  ) as {
    product?: AdminProduct
    isPending: boolean
    isError: boolean
    error?: Error
  }

  if (isLoading) {
    return <Skeleton className="h-32" />
  }

  if (isError) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-center h-40">
          <Text className="text-ui-fg-error">
            {error?.message || "An error occurred"}
          </Text>
        </div>
      </Container>
    )
  }

  const pageviews = (product?.metadata?.analytics?.product_pageviews || null) as
    | ProductPageviews
    | null

  const daily = pageviews?.daily || {}

  const resolvedDay = (() => {
    if (pageviews?.last_day && daily[pageviews.last_day]) {
      return pageviews.last_day
    }

    const keys = Object.keys(daily).sort()
    return keys[keys.length - 1]
  })()

  const lastDayEntry = resolvedDay ? daily[resolvedDay] : undefined

  const views = lastDayEntry?.views

  const lastUpdatedAt = pageviews?.last_updated_at
    ? new Date(pageviews.last_updated_at).toLocaleString()
    : null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">Views</Heading>
          {typeof views === "number" && (
            <Badge size="2xsmall" color="blue">
              {views}
            </Badge>
          )}
        </div>
      </div>

      <div className="px-6 py-4">
        {!pageviews ? (
          <Text className="text-ui-fg-subtle">No view analytics available.</Text>
        ) : !resolvedDay ? (
          <Text className="text-ui-fg-subtle">No daily view data available.</Text>
        ) : (
          <div className="flex flex-col gap-y-1">
            <Text size="small" className="text-ui-fg-subtle">
              Last day
            </Text>
            <Text weight="plus">{resolvedDay}</Text>
            {lastUpdatedAt && (
              <Text size="small" className="text-ui-fg-subtle">
                Last updated: {lastUpdatedAt}
              </Text>
            )}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default ProductWebViewsWidget
