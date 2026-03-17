import { z } from "@medusajs/framework/zod"

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color (e.g. #7c3aed)")
  .optional()

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
      title: z.string().optional(),
      subtitle: z.string().optional(),
      background_image_url: z.string().optional(),
      cta_text: z.string().optional(),
      cta_link: z.string().optional(),
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
})

export type WebsiteTheme = z.infer<typeof websiteThemeSchema>
