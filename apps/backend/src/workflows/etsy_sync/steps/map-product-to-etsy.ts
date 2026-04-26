import { ListingData } from "../../../modules/external_stores/types"

/**
 * Maps MedusaJS product data to Etsy listing format.
 * 
 * @param product - MedusaJS product object
 * @returns Etsy listing data
 */
export function mapProductToEtsyListing(product: any): ListingData {
  // Get first variant for pricing
  const variant = product.variants?.[0]
  const price = variant?.prices?.[0]?.amount || 0
  
  // Get images
  const images = product.images?.map((img: any) => img.url) || []
  
  // Get tags from product tags or metadata
  const tags = product.tags?.map((tag: any) => tag.value) || []
  
  // Extract quantity from first variant
  const quantity = variant?.inventory_quantity || 1
  
  return {
    title: product.title || "Untitled Product",
    description: product.description || "",
    price: price / 100, // Convert cents to dollars
    quantity: quantity,
    images: images,
    tags: tags.slice(0, 13), // Etsy allows max 13 tags
    category_id: product.metadata?.etsy_category_id,
  }
}

/**
 * Validates that a product has the minimum required data for Etsy.
 * 
 * @param product - MedusaJS product object
 * @returns Validation result with error message if invalid
 */
export function validateProductForEtsy(product: any): { valid: boolean; error?: string } {
  if (!product.title || product.title.length < 1) {
    return { valid: false, error: "Product title is required" }
  }
  
  if (product.title.length > 140) {
    return { valid: false, error: "Product title must be 140 characters or less" }
  }
  
  const variant = product.variants?.[0]
  if (!variant) {
    return { valid: false, error: "Product must have at least one variant" }
  }
  
  const price = variant.prices?.[0]?.amount
  if (!price || price <= 0) {
    return { valid: false, error: "Product must have a valid price" }
  }
  
  return { valid: true }
}
