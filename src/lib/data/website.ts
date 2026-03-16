"use server"

import { sdk } from "@lib/config"
import { getCacheOptions } from "./cookies"

// Public Website API models (based on integration tests)
export type PublicWebsite = {
  name: string
  domain: string
  pages: Array<PublicWebsitePage>
}

export type PublicWebsitePage = {
  title: string
  slug: string
  page_type: string
  status: "Published" | "Draft" | "Archived"
  published_at?: string
  blocks?: Array<{
    id?: string
    name: string
    type: string
    content?: Record<string, unknown>
    settings?: Record<string, unknown>
    status?: string
    order: number
  }>
}

export type PublicBlog = PublicWebsitePage

const DEFAULT_DOMAIN = "shop.cicilabel.com"

// GET /web/website/:domain
export async function getWebsite(
  domain: string = DEFAULT_DOMAIN
): Promise<PublicWebsite> {
  const next = { ...(await getCacheOptions("website")) }
  return sdk.client.fetch<PublicWebsite>(`/web/website/${domain}`, {
    next,
    cache: "force-cache",
  })
}

// GET /web/website/:domain/:page
export async function getWebsitePage(
  domain: string,
  slug: string
): Promise<PublicWebsitePage> {
  const next = { ...(await getCacheOptions("website_page")) }
  return sdk.client.fetch<PublicWebsitePage>(`/web/website/${domain}/${slug}`, {
    next,
    cache: "force-cache",
  })
}

// GET /web/website/:domain/blogs
export async function listWebsiteBlogs(
  domain: string = DEFAULT_DOMAIN,
  limit: number = 20,
  offset: number = 0
): Promise<PublicBlog[]> {
  const next = { ...(await getCacheOptions("website_blogs")) }
  return sdk.client.fetch<PublicBlog[]>(`/web/website/${domain}/blogs`, {
    query: { limit: limit.toString(), offset: offset.toString() },
    next,
    cache: "force-cache",
  })
}

// GET /web/website/:domain/blogs/:blogId
export async function getWebsiteBlog(
  domain: string,
  blogSlug: string
): Promise<PublicBlog> {
  const next = { ...(await getCacheOptions("website_blog")) }
  return sdk.client.fetch<PublicBlog>(
    `/web/website/${domain}/blogs/${blogSlug}`,
    {
      next,
      cache: "force-cache",
    }
  )
}

// POST /web/website/:domain/subscribe
export async function subscribeToWebsite(
  domain: string,
  data: { first_name: string; last_name: string; email: string }
) {
  return sdk.client.fetch<{ message: string }>(
    `/web/website/${domain}/subscribe`,
    {
      method: "POST",
      body: data,
      cache: "no-store",
    }
  )
}
