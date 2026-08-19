import { MedusaService } from "@medusajs/framework/utils"
import ProductSpec from "./models/product-spec"
import ProductSpecColor from "./models/product-spec-color"
import ProductSpecField from "./models/product-spec-field"
import ProductSpecOption from "./models/product-spec-option"
import ProductSpecOptionValue from "./models/product-spec-option-value"

class ProductSpecService extends MedusaService({
  ProductSpec,
  ProductSpecColor,
  ProductSpecField,
  ProductSpecOption,
  ProductSpecOptionValue,
}) {
  /**
   * Fetch a product's spec with its palette, its custom fields and its
   * selectable option groups, or null.
   *
   * Relations are requested explicitly — without them the caller gets a spec
   * whose `colors` and `fields` are simply absent, which reads identically to a
   * spec that has none. `options.values` is the same trap one level deeper:
   * asking for `options` alone yields groups with no values, i.e. a choice with
   * nothing to choose, and the cart route would then reject every selection as
   * "not in the list".
   */
  async findByProduct(productId: string) {
    const specs = await this.listProductSpecs(
      { product_id: productId },
      { relations: ["colors", "fields", "options", "options.values"] }
    )
    return specs?.[0] || null
  }
}

export default ProductSpecService
