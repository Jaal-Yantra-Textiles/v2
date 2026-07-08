/**
 * Safe theme patch schema — the scoped subset of theme tokens the LLM is
 * allowed to touch (issue #7 / #339).
 *
 * Design principles:
 *   - **Strict** (no `.passthrough()`) — the LLM cannot inject unknown keys.
 *   - **Non-destructive** — every field is `.optional()`, so the LLM emits
 *     only the tokens it wants to change. The backend deep-merges the patch
 *     with the existing theme (`deepMergeTheme`), so omitted sections /
 *     fields are preserved.
 *   - **Full customization surface** — colours, typography, buttons, nav,
 *     animations, hero (incl. background image), footer, branding (logo,
 *     favicon, store name), all home_sections sub-sections (text_with_image,
 *     banner, testimonials, newsletter, trust_banner), section ordering,
 *     product page, and cart text.
 *
 * This schema is reused as:
 *   1. The `inputSchema` of the `update_theme` tool the LLM calls.
 *   2. The validation layer for the proposed patch before the frontend
 *      applies it.
 */
import { z } from "@medusajs/framework/zod"

const hexColorStrict = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color (e.g. #7c3aed)")

const safeUrl = z
  .string()
  .regex(
    /^(https?:\/\/|\/)[^\s]*$/,
    "Must be an http(s) or root-relative URL"
  )

const imageUrl = z
  .string()
  .regex(
    /^(https?:\/\/|\/)[^\s]+\.(jpg|jpeg|png|gif|webp|svg|ico)(\?[^\s]*)?$/i,
    "Must be an image URL (jpg, png, gif, webp, svg, ico) — http(s) or root-relative"
  )
  .or(safeUrl)

const animationTypeEnum = z.enum([
  "none",
  "fade-up",
  "fade-in",
  "fade-down",
  "slide-left",
  "slide-right",
  "zoom-in",
  "zoom-out",
])

const sectionOrderEnum = z.enum([
  "hero",
  "trust_banner",
  "collections",
  "text_with_image",
  "categories",
  "testimonials",
  "banner",
  "newsletter",
])

export const safeThemePatchSchema = z.object({
  branding: z
    .object({
      store_name: z.string().optional(),
      tagline: z.string().optional(),
      logo_url: imageUrl.optional(),
      favicon_url: imageUrl.optional(),
    })
    .optional(),
  colors: z
    .object({
      primary: hexColorStrict.optional(),
      secondary: hexColorStrict.optional(),
      background: hexColorStrict.optional(),
      text: hexColorStrict.optional(),
      accent: hexColorStrict.optional(),
      muted: hexColorStrict.optional(),
      border: hexColorStrict.optional(),
    })
    .optional(),
  typography: z
    .object({
      font_family: z.string().optional(),
      heading_font_family: z.string().optional(),
      base_font_size: z.string().optional(),
      heading_weight: z.enum(["500", "600", "700"]).optional(),
    })
    .optional(),
  buttons: z
    .object({
      border_radius: z.string().optional(),
      primary_style: z.enum(["filled", "outline"]).optional(),
    })
    .optional(),
  navigation: z
    .object({
      sticky: z.boolean().optional(),
      style: z.enum(["transparent", "solid", "bordered"]).optional(),
      show_account_link: z.boolean().optional(),
      show_cart_icon: z.boolean().optional(),
      show_search: z.boolean().optional(),
    })
    .optional(),
  animations: z
    .object({
      enabled: z.boolean().optional(),
      global_duration: z.enum(["fast", "normal", "slow"]).optional(),
      hero_entrance: animationTypeEnum.optional(),
      section_entrance: z.enum(["none", "fade-up", "stagger"]).optional(),
      stagger_delay: z.number().min(50).max(500).optional(),
    })
    .optional(),
  hero: z
    .object({
      layout: z.enum(["center", "left", "right", "split"]).optional(),
      badge_text: z.string().optional(),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      background_image_url: imageUrl.optional(),
      overlay_opacity: z.number().min(0).max(100).optional(),
      cta_text: z.string().optional(),
      cta_link: safeUrl.optional(),
      secondary_cta_text: z.string().optional(),
      secondary_cta_link: safeUrl.optional(),
      animation: animationTypeEnum.optional(),
      bg_animation: z
        .enum(["none", "ken-burns", "zoom-in", "fade-in", "pan-left", "pan-right"])
        .optional(),
    })
    .optional(),
  footer: z
    .object({
      text: z.string().optional(),
      copyright_text: z.string().optional(),
      show_newsletter: z.boolean().optional(),
      newsletter_heading: z.string().optional(),
      newsletter_description: z.string().optional(),
    })
    .optional(),
  home_sections: z
    .object({
      show_featured_collections: z.boolean().optional(),
      show_categories: z.boolean().optional(),
      collection_heading: z.string().optional(),
      category_heading: z.string().optional(),
      featured_collection_count: z.number().min(1).max(20).optional(),
      products_per_collection: z.number().min(1).max(20).optional(),
      empty_state_product_name: z.string().optional(),
      sections_order: z.array(sectionOrderEnum).optional(),
      text_with_image: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          image_url: imageUrl.optional(),
          cta_text: z.string().optional(),
          cta_link: safeUrl.optional(),
          layout: z.enum(["image-left", "image-right"]).optional(),
        })
        .optional(),
      banner: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          background_image_url: imageUrl.optional(),
          background_color: hexColorStrict.optional(),
          cta_text: z.string().optional(),
          cta_link: safeUrl.optional(),
        })
        .optional(),
      testimonials: z
        .object({
          heading: z.string().optional(),
        })
        .optional(),
      newsletter: z
        .object({
          heading: z.string().optional(),
          description: z.string().optional(),
          placeholder: z.string().optional(),
          button_text: z.string().optional(),
        })
        .optional(),
      trust_banner: z
        .object({
          background: hexColorStrict.optional(),
        })
        .optional(),
    })
    .optional(),
  product_page: z
    .object({
      show_related_products: z.boolean().optional(),
      related_heading: z.string().optional(),
      show_breadcrumbs: z.boolean().optional(),
      show_sku: z.boolean().optional(),
      cta_text: z.string().optional(),
    })
    .optional(),
  cart: z
    .object({
      heading: z.string().optional(),
      empty_message: z.string().optional(),
      empty_cta_text: z.string().optional(),
      checkout_button_text: z.string().optional(),
      show_free_shipping_bar: z.boolean().optional(),
    })
    .optional(),
})

export type SafeThemePatch = z.infer<typeof safeThemePatchSchema>

/**
 * Human-readable description of every safe token, injected into the LLM
 * system prompt so the model knows exactly what it can and cannot do.
 */
export const SAFE_TOKEN_DESCRIPTION = `You may propose edits to the following theme tokens ONLY:

## Branding
branding: store_name, tagline, logo_url (image URL), favicon_url (image URL)

## Colors
colors: primary, secondary, background, text, accent, muted, border — hex strings like "#7c3aed"

## Typography
typography: font_family, heading_font_family (any web-safe or Google Font name), base_font_size ("14px".."18px"), heading_weight ("500"|"600"|"700")

## Buttons
buttons: border_radius ("0px".."9999px"), primary_style ("filled"|"outline")

## Navigation
navigation: sticky (boolean), style ("transparent"|"solid"|"bordered"), show_account_link, show_cart_icon, show_search (booleans)

## Animations
animations: enabled (boolean), global_duration ("fast"|"normal"|"slow"), hero_entrance (none|fade-up|fade-in|fade-down|slide-left|slide-right|zoom-in|zoom-out), section_entrance ("none"|"fade-up"|"stagger"), stagger_delay (50-500)

## Hero
hero: layout ("center"|"left"|"right"|"split"), badge_text, title, subtitle, description, background_image_url (image URL), overlay_opacity (0-100), cta_text, cta_link (URL), secondary_cta_text, secondary_cta_link, animation, bg_animation (none|ken-burns|zoom-in|fade-in|pan-left|pan-right)

## Footer
footer: text, copyright_text, show_newsletter (boolean), newsletter_heading, newsletter_description

## Home Sections
home_sections:
  - show_featured_collections (boolean), show_categories (boolean)
  - collection_heading, category_heading (strings)
  - featured_collection_count (number 1-20, how many collections to show)
  - products_per_collection (number 1-20, max products per collection)
  - empty_state_product_name (string, sample product name for empty state)
  - sections_order: array to rearrange homepage sections. Valid values: "hero", "trust_banner", "collections", "text_with_image", "categories", "testimonials", "banner", "newsletter". Use this to add, remove, or reorder sections.
  - text_with_image: { title, description, image_url (image URL), cta_text, cta_link, layout ("image-left"|"image-right") }
  - banner: { title, description, background_image_url (image URL), background_color (hex), cta_text, cta_link }
  - testimonials: { heading }
  - newsletter: { heading, description, placeholder, button_text }
  - trust_banner: { background (hex color) }

## Product Page
product_page: show_related_products (boolean), related_heading, show_breadcrumbs (boolean), show_sku (boolean), cta_text

## Cart
cart: heading, empty_message, empty_cta_text, checkout_button_text, show_free_shipping_bar (boolean)

## Image URLs
When setting image_url, background_image_url, logo_url, or favicon_url, use URLs from the media library (call the list_media tool first) or valid http(s) image URLs.

You may NOT touch: navigation links arrays, social links arrays, or any token not listed above.`
