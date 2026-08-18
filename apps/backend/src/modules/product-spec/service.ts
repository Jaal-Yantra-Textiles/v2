import { MedusaService } from "@medusajs/framework/utils"
import ProductSpec from "./models/product-spec"
import ProductSpecColor from "./models/product-spec-color"
import ProductSpecField from "./models/product-spec-field"

class ProductSpecService extends MedusaService({
  ProductSpec,
  ProductSpecColor,
  ProductSpecField,
}) {
  /**
   * Fetch a product's spec with its palette and custom fields, or null.
   *
   * Relations are requested explicitly — without them the caller gets a spec
   * whose `colors` and `fields` are simply absent, which reads identically to a
   * spec that has none.
   */
  async findByProduct(productId: string) {
    const specs = await this.listProductSpecs(
      { product_id: productId },
      { relations: ["colors", "fields"] }
    )
    return specs?.[0] || null
  }
}

export default ProductSpecService
