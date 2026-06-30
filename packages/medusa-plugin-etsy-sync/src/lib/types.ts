export interface EtsyPluginOptions {
  keystring: string
  sharedSecret: string
  redirectUri: string
  scope?: string
}

export const DEFAULT_SCOPES = "listings_r listings_w listings_d shops_r"

export interface TokenData {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  retrieved_at: number
}

export interface ShopInfo {
  shop_id: string
  shop_name: string
  shop_url?: string
  currency?: string
  country?: string
  raw: Record<string, any>
}

export type WhoMade = "i_did" | "someone_else" | "collective"
export type WhenMade =
  | "made_to_order"
  | "2020_2026"
  | "2010_2019"
  | "2007_2009"
  | "before_2007"
  | "2000_2006"
  | "1990s"
  | "1980s"
  | "1970s"
  | "1960s"
  | "1950s"
  | "1940s"
  | "1930s"
  | "1920s"
  | "1910s"
  | "1900s"
  | "1800s"
  | "1700s"
  | "before_1700"

export type ListingType = "physical" | "download" | "both"
export type ListingState = "active" | "inactive" | "sold_out" | "draft" | "expired"

export interface CreateListingInput {
  quantity: number
  title: string
  description: string
  price: number
  who_made: WhoMade
  when_made: WhenMade
  taxonomy_id: number
  shipping_profile_id?: number
  return_policy_id?: number
  readiness_state_id?: number
  image_ids?: number[]
  materials?: string[]
  tags?: string[]
  shop_section_id?: number
  is_supply?: boolean
  type?: ListingType
  item_weight?: number
  item_length?: number
  item_width?: number
  item_height?: number
  item_weight_unit?: "oz" | "lb" | "g" | "kg"
  item_dimensions_unit?: "in" | "ft" | "mm" | "cm" | "m" | "yd" | "inches"
  should_auto_renew?: boolean
  is_taxable?: boolean
}

export interface UpdateListingInput extends Partial<CreateListingInput> {
  state?: "active" | "inactive"
}

export interface ListingResponse {
  listing_id: string
  shop_id?: string
  state: ListingState
  title: string
  url?: string
  quantity: number
  price?: number
  raw: Record<string, any>
}

export interface ShippingProfile {
  shipping_profile_id: string
  title: string
  raw: Record<string, any>
}

export interface ReturnPolicy {
  return_policy_id: string
  name: string
  raw: Record<string, any>
}

export interface TaxonomyNode {
  id: number
  name: string
  parent_id: number | null
  level: number
  children?: TaxonomyNode[]
}

export interface ReadinessState {
  id: string
  label: string
  raw: Record<string, any>
}

export interface UploadedImage {
  listing_image_id: string
  rank: number
  url_fullxfull?: string
  raw: Record<string, any>
}

export interface PkcePair {
  code_verifier: string
  code_challenge: string
}

export interface PreparedListing {
  listing: ListingResponse
  uploaded_images: UploadedImage[]
  published: boolean
  warnings: string[]
}
