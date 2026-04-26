"use server"

import { sdk } from "@lib/config"
import { headers } from "next/headers"

export const submitWebsiteFormResponse = async (
  input: {
    email?: string | null
    data: Record<string, any>
    page_url?: string | null
    referrer?: string | null
    metadata?: Record<string, any> | null
  },
  options?: {
    domain?: string
    handle?: string
  }
) => {
  const domain =
    options?.domain ||
    process.env.NEXT_PUBLIC_CONTACT_FORM_DOMAIN ||
    process.env.CONTACT_FORM_DOMAIN ||
    "cicilabel.com"

  const handle =
    options?.handle ||
    process.env.NEXT_PUBLIC_CONTACT_FORM_HANDLE ||
    process.env.CONTACT_FORM_HANDLE ||
    "contact"

  const hdrs = await headers()
  const inferredReferrer = hdrs.get("referer") || null

  return sdk.client.fetch<{ response: any }>(
    `/web/website/${domain}/forms/${handle}`,
    {
      method: "POST",
      body: {
        email: input.email ?? null,
        data: input.data,
        page_url: input.page_url ?? inferredReferrer,
        referrer: input.referrer ?? inferredReferrer,
        metadata: input.metadata ?? null,
      },
      cache: "no-store",
    }
  )
}
