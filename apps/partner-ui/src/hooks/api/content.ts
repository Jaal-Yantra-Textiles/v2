import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseQueryOptions,
  UseMutationOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

// -- Types --

export type ContentBlock = {
  id: string
  name: string
  type: string
  content?: Record<string, unknown>
  settings?: Record<string, unknown>
  order: number
  status: "Active" | "Inactive" | "Draft"
  page_id: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ContentPage = {
  id: string
  website_id?: string
  title: string
  slug: string
  content: string
  page_type: string
  status: "Draft" | "Published" | "Archived"
  meta_title?: string
  meta_description?: string
  meta_keywords?: string
  published_at?: string
  metadata?: Record<string, unknown>
  blocks?: ContentBlock[]
  created_at: string
  updated_at: string
}

export type ContentWebsite = {
  id: string
  domain: string
  name: string
  status: string
  pages?: ContentPage[]
}

// -- Query Keys --

const CONTENT_QUERY_KEY = "partner_content" as const
export const contentQueryKeys = queryKeysFactory(CONTENT_QUERY_KEY)

// -- Website --

export const usePartnerWebsite = (
  options?: Omit<
    UseQueryOptions<
      { website: ContentWebsite | null; message?: string },
      FetchError,
      { website: ContentWebsite | null; message?: string },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ website: ContentWebsite | null; message?: string }>(
        "/partners/storefront/website",
        { method: "GET" }
      ),
    queryKey: contentQueryKeys.detail("website"),
    ...options,
  })
  return { website: data?.website || null, message: data?.message, ...rest }
}

export const useCreatePartnerWebsite = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ website: ContentWebsite; seeded_pages: any[] }>(
        "/partners/storefront/website",
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentQueryKeys.all })
    },
  })
}

// -- Pages --

export const useContentPages = (
  query?: { limit?: number; offset?: number; status?: string },
  options?: Omit<
    UseQueryOptions<any, FetchError, any, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{
        pages: ContentPage[]
        count: number
        offset: number
        limit: number
      }>("/partners/storefront/pages", {
        method: "GET",
        query,
      }),
    queryKey: contentQueryKeys.list({ type: "pages", ...query }),
    ...options,
  })
  return {
    pages: data?.pages || [],
    count: data?.count || 0,
    ...rest,
  }
}

export const useContentPage = (
  pageId: string,
  options?: Omit<
    UseQueryOptions<{ page: ContentPage }, FetchError, { page: ContentPage }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ page: ContentPage }>(
        `/partners/storefront/pages/${pageId}`,
        { method: "GET" }
      ),
    queryKey: contentQueryKeys.detail(pageId),
    enabled: !!pageId,
    ...options,
  })
  return { page: data?.page || null, ...rest }
}

export const useCreateContentPage = () => {
  return useMutation({
    mutationFn: (payload: {
      title: string
      slug: string
      content: string
      page_type?: string
      status?: string
    }) =>
      sdk.client.fetch<{ page: ContentPage }>("/partners/storefront/pages", {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentQueryKeys.lists(),
      })
    },
  })
}

export const useUpdateContentPage = (pageId: string) => {
  return useMutation({
    mutationFn: (payload: Partial<ContentPage>) =>
      sdk.client.fetch<{ page: ContentPage }>(
        `/partners/storefront/pages/${pageId}`,
        { method: "PUT", body: payload }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentQueryKeys.detail(pageId),
      })
      queryClient.invalidateQueries({
        queryKey: contentQueryKeys.lists(),
      })
    },
  })
}

export const useDeleteContentPage = (pageId: string) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/storefront/pages/${pageId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentQueryKeys.lists(),
      })
    },
  })
}

// -- Blocks --

export const useContentBlocks = (
  pageId: string,
  options?: Omit<
    UseQueryOptions<any, FetchError, any, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ blocks: ContentBlock[]; count: number }>(
        `/partners/storefront/pages/${pageId}/blocks`,
        { method: "GET" }
      ),
    queryKey: contentQueryKeys.list({ type: "blocks", pageId }),
    enabled: !!pageId,
    ...options,
  })
  return { blocks: data?.blocks || [], count: data?.count || 0, ...rest }
}

// -- Theme --

export type WebsiteTheme = {
  branding?: { logo_url?: string; store_name?: string; favicon_url?: string; tagline?: string }
  colors?: {
    primary?: string
    secondary?: string
    background?: string
    text?: string
    accent?: string
    muted?: string
    border?: string
  }
  typography?: {
    font_family?: string
    heading_font_family?: string
    base_font_size?: string
    heading_weight?: string
  }
  buttons?: {
    border_radius?: string
    primary_style?: "filled" | "outline"
  }
  animations?: {
    enabled?: boolean
    global_duration?: "fast" | "normal" | "slow"
    hero_entrance?: string
    section_entrance?: "none" | "fade-up" | "stagger"
    stagger_delay?: number
  }
  hero?: {
    layout?: "center" | "left" | "right" | "split"
    animation?: string
    bg_animation?: "none" | "ken-burns" | "zoom-in" | "fade-in" | "pan-left" | "pan-right"
    badge_text?: string
    title?: string
    subtitle?: string
    description?: string
    background_image_url?: string
    overlay_opacity?: number
    cta_text?: string
    cta_link?: string
    secondary_cta_text?: string
    secondary_cta_link?: string
    features?: Array<{ icon?: string; title: string; description?: string }>
    min_height?: string
  }
  navigation?: {
    links?: Array<{ label: string; href: string }>
    show_account_link?: boolean
    show_cart_icon?: boolean
    show_search?: boolean
    sticky?: boolean
    style?: "transparent" | "solid" | "bordered"
  }
  footer?: {
    text?: string
    copyright_text?: string
    social_links?: Array<{ platform: string; url: string }>
    show_newsletter?: boolean
    newsletter_heading?: string
    newsletter_description?: string
  }
  home_sections?: {
    show_featured_collections?: boolean
    featured_collection_count?: number
    products_per_collection?: number
    collection_heading?: string
    empty_state_product_name?: string
    show_categories?: boolean
    category_heading?: string
    sections_order?: Array<
      | "hero"
      | "trust_banner"
      | "collections"
      | "text_with_image"
      | "categories"
      | "testimonials"
      | "banner"
      | "newsletter"
    >
    trust_banner?: {
      items?: Array<{ icon?: string; text: string }>
      background?: string
    }
    text_with_image?: {
      title?: string
      description?: string
      image_url?: string
      cta_text?: string
      cta_link?: string
      layout?: "image-left" | "image-right"
    }
    testimonials?: {
      heading?: string
      items?: Array<{ quote: string; author: string; role?: string; avatar_url?: string }>
    }
    banner?: {
      title?: string
      description?: string
      background_image_url?: string
      background_color?: string
      cta_text?: string
      cta_link?: string
    }
    newsletter?: {
      heading?: string
      description?: string
      placeholder?: string
      button_text?: string
    }
  }
  product_page?: {
    show_related_products?: boolean
    related_heading?: string
    show_tabs?: boolean
    show_breadcrumbs?: boolean
    show_sku?: boolean
    show_stock_status?: boolean
    image_layout?: "gallery" | "single" | "grid"
    gallery_position?: "left" | "right"
    description_layout?: "tabs" | "accordion" | "stacked"
    cta_text?: string
    sample_product_name?: string
    sample_product_price?: string
  }
  cart?: {
    heading?: string
    empty_message?: string
    empty_cta_text?: string
    empty_cta_link?: string
    show_sign_in_prompt?: boolean
    checkout_button_text?: string
    show_order_summary?: boolean
    show_free_shipping_bar?: boolean
    free_shipping_threshold?: string
  }
  animations?: {
    enabled?: boolean
    global_duration?: "fast" | "normal" | "slow"
    hero_entrance?: string
    section_entrance?: "none" | "fade-up" | "stagger"
    stagger_delay?: number
  }
}

export const useWebsiteTheme = (
  options?: Omit<
    UseQueryOptions<{ theme: WebsiteTheme }, FetchError, { theme: WebsiteTheme }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ theme: WebsiteTheme }>(
        "/partners/storefront/website/theme",
        { method: "GET" }
      ),
    queryKey: contentQueryKeys.detail("theme"),
    ...options,
  })
  return { theme: data?.theme || {}, ...rest }
}

export const useUpdateWebsiteTheme = () => {
  return useMutation({
    mutationFn: (payload: WebsiteTheme) =>
      sdk.client.fetch<{ theme: WebsiteTheme }>(
        "/partners/storefront/website/theme",
        { method: "PUT", body: payload }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentQueryKeys.detail("theme"),
      })
    },
  })
}

// -- Seed --

export const useSeedContentPages = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ pages: any[]; skipped: string[] }>(
        "/partners/storefront/seed-pages",
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentQueryKeys.all })
    },
  })
}
