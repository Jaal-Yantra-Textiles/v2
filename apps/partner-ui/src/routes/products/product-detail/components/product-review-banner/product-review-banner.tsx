import { Alert, Text } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"

/**
 * #859/#861 — surfaces the marketplace proposal lifecycle to the partner.
 *
 * Artisan (`core_channel_listing`) products move through the native
 * ProductStatus flow proposed → published / rejected. Only that flow produces
 * `proposed`/`rejected`, so keying the banner off status alone is reliable —
 * ordinary partner products are draft/published and render nothing here.
 */
export const ProductReviewBanner = ({
  product,
}: {
  product: HttpTypes.AdminProduct
}) => {
  const status = product?.status

  if (status === "proposed") {
    return (
      <Alert variant="info">
        <Text size="small" weight="plus">
          Pending review
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          You've proposed this product for the JYT marketplace. Our team reviews
          it before it goes live — you'll see the status change to{" "}
          <span className="font-medium">Published</span> once it's approved. No
          further action needed.
        </Text>
      </Alert>
    )
  }

  if (status === "rejected") {
    return (
      <Alert variant="error">
        <Text size="small" weight="plus">
          Not approved for the marketplace
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          This proposal wasn't approved. You can edit the details and it will be
          re-reviewed, or reach out to the JYT team if you'd like more context.
        </Text>
      </Alert>
    )
  }

  return null
}
