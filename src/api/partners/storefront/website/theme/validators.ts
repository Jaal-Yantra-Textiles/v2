import { z } from "@medusajs/framework/zod"

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color (e.g. #7c3aed)")
  .optional()

const heroFeatureSchema = z.object({
  icon: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
})

const navigationLinkSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
})

const socialLinkSchema = z.object({
  platform: z.string().min(1),
  url: z.string().url(),
})

export const websiteThemeSchema = z.object({
  branding: z
    .object({
      logo_url: z.string().optional(),
      store_name: z.string().optional(),
      favicon_url: z.string().optional(),
    })
    .optional(),
  colors: z
    .object({
      primary: hexColor,
      background: hexColor,
      text: hexColor,
      accent: hexColor,
    })
    .optional(),
  hero: z
    .object({
      layout: z.enum(["center", "left", "right", "split"]).optional(),
      badge_text: z.string().optional(),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      background_image_url: z.string().optional(),
      overlay_opacity: z.number().min(0).max(100).optional(),
      cta_text: z.string().optional(),
      cta_link: z.string().optional(),
      secondary_cta_text: z.string().optional(),
      secondary_cta_link: z.string().optional(),
      features: z.array(heroFeatureSchema).optional(),
    })
    .optional(),
  navigation: z
    .object({
      links: z.array(navigationLinkSchema).optional(),
      show_account_link: z.boolean().optional(),
    })
    .optional(),
  footer: z
    .object({
      text: z.string().optional(),
      social_links: z.array(socialLinkSchema).optional(),
    })
    .optional(),
  home_sections: z
    .object({
      show_featured_collections: z.boolean().optional(),
      featured_collection_count: z.number().min(1).max(10).optional(),
      products_per_collection: z.number().min(1).max(12).optional(),
      collection_heading: z.string().optional(),
      empty_state_product_name: z.string().optional(),
      show_categories: z.boolean().optional(),
      category_heading: z.string().optional(),
      sections_order: z.array(z.enum(["hero", "collections", "categories"])).optional(),
    })
    .optional(),
  product_page: z
    .object({
      show_related_products: z.boolean().optional(),
      related_heading: z.string().optional(),
      show_tabs: z.boolean().optional(),
      show_breadcrumbs: z.boolean().optional(),
      cta_text: z.string().optional(),
      sample_product_name: z.string().optional(),
      sample_product_price: z.string().optional(),
    })
    .optional(),
  cart: z
    .object({
      heading: z.string().optional(),
      empty_message: z.string().optional(),
      empty_cta_text: z.string().optional(),
      empty_cta_link: z.string().optional(),
      show_sign_in_prompt: z.boolean().optional(),
      checkout_button_text: z.string().optional(),
    })
    .optional(),
})

export type WebsiteTheme = z.infer<typeof websiteThemeSchema>
