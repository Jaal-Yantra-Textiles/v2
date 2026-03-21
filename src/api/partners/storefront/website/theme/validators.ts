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

const trustBannerItemSchema = z.object({
  icon: z.string().optional(),
  text: z.string().min(1),
})

const testimonialItemSchema = z.object({
  quote: z.string().min(1),
  author: z.string().min(1),
  role: z.string().optional(),
  avatar_url: z.string().optional(),
})

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

export const websiteThemeSchema = z.object({
  branding: z
    .object({
      logo_url: z.string().optional(),
      store_name: z.string().optional(),
      favicon_url: z.string().optional(),
      tagline: z.string().optional(),
    })
    .optional(),
  colors: z
    .object({
      primary: hexColor,
      secondary: hexColor,
      background: hexColor,
      text: hexColor,
      accent: hexColor,
      muted: hexColor,
      border: hexColor,
    })
    .optional(),
  typography: z
    .object({
      font_family: z.string().optional(),
      heading_font_family: z.string().optional(),
      base_font_size: z.string().optional(),
      heading_weight: z.string().optional(),
    })
    .optional(),
  buttons: z
    .object({
      border_radius: z.string().optional(),
      primary_style: z.enum(["filled", "outline"]).optional(),
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
      animation: animationTypeEnum.optional(),
      bg_animation: z.enum(["none", "ken-burns", "zoom-in", "fade-in", "pan-left", "pan-right"]).optional(),
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
      min_height: z.string().optional(),
    })
    .optional(),
  navigation: z
    .object({
      links: z.array(navigationLinkSchema).optional(),
      show_account_link: z.boolean().optional(),
      show_cart_icon: z.boolean().optional(),
      show_search: z.boolean().optional(),
      sticky: z.boolean().optional(),
      style: z.enum(["transparent", "solid", "bordered"]).optional(),
    })
    .optional(),
  footer: z
    .object({
      text: z.string().optional(),
      copyright_text: z.string().optional(),
      social_links: z.array(socialLinkSchema).optional(),
      show_newsletter: z.boolean().optional(),
      newsletter_heading: z.string().optional(),
      newsletter_description: z.string().optional(),
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
      sections_order: z
        .array(
          z.enum([
            "hero",
            "trust_banner",
            "collections",
            "text_with_image",
            "categories",
            "testimonials",
            "banner",
            "newsletter",
          ])
        )
        .optional(),
      trust_banner: z
        .object({
          items: z.array(trustBannerItemSchema).optional(),
          background: hexColor,
        })
        .optional(),
      text_with_image: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          image_url: z.string().optional(),
          cta_text: z.string().optional(),
          cta_link: z.string().optional(),
          layout: z.enum(["image-left", "image-right"]).optional(),
        })
        .optional(),
      testimonials: z
        .object({
          heading: z.string().optional(),
          items: z.array(testimonialItemSchema).optional(),
        })
        .optional(),
      banner: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          background_image_url: z.string().optional(),
          background_color: hexColor,
          cta_text: z.string().optional(),
          cta_link: z.string().optional(),
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
    })
    .optional(),
  product_page: z
    .object({
      show_related_products: z.boolean().optional(),
      related_heading: z.string().optional(),
      show_tabs: z.boolean().optional(),
      show_breadcrumbs: z.boolean().optional(),
      show_sku: z.boolean().optional(),
      show_stock_status: z.boolean().optional(),
      image_layout: z.enum(["gallery", "single", "grid"]).optional(),
      gallery_position: z.enum(["left", "right"]).optional(),
      description_layout: z.enum(["tabs", "accordion", "stacked"]).optional(),
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
      show_order_summary: z.boolean().optional(),
      show_free_shipping_bar: z.boolean().optional(),
      free_shipping_threshold: z.string().optional(),
    })
    .optional(),
})

export type WebsiteTheme = z.infer<typeof websiteThemeSchema>
