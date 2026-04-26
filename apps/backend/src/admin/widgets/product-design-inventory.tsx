import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"

// Merged into product-designs.tsx — this widget is intentionally disabled.
const ProductDesignInventoryWidget = (_: DetailWidgetProps<{ id: string }>) => null

export const config = defineWidgetConfig({
  zone: "product.details.before",
})

export default ProductDesignInventoryWidget
