import { MedusaService } from "@medusajs/framework/utils"
import ArtisanProductDetail from "./models/artisan-product-detail"

class ArtisanProductDetailService extends MedusaService({
  ArtisanProductDetail,
}) {
  /**
   * Fetch the artisan detail for a product, or null if none exists yet.
   */
  async findByProduct(productId: string) {
    const details = await this.listArtisanProductDetails({
      product_id: productId,
    })
    return details?.[0] || null
  }
}

export default ArtisanProductDetailService
