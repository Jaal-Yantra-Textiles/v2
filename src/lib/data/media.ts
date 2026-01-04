"use server"

import { sdk } from "@lib/config"
import { getCacheOptions } from "./cookies"

export type PublicMedia = {
  id: string
  filename?: string
  filename_disk?: string
  file_path?: string
  type?: string
  mime_type?: string
  filesize?: number
  width?: number
  height?: number
  title?: string
  description?: string
  alt_text?: string
  caption?: string
}

type ListPublicMediaResponse = {
  medias: PublicMedia[]
  count: number
  total: number
}

export async function listPublicMedia({
  limit = 18,
  type = "image",
  random = true,
}: {
  limit?: number
  type?: string
  random?: boolean
} = {}): Promise<ListPublicMediaResponse> {
  const next = { ...(await getCacheOptions("web_media")) }

  return sdk.client.fetch<ListPublicMediaResponse>(`/web/media`, {
    method: "GET",
    query: {
      limit,
      type,
      random: random ? "true" : "false",
    },
    next,
    cache: "force-cache",
  })
}

export function buildPublicMediaUrl(filePath?: string | null): string | null {
  if (!filePath) {
    return null
  }

  if (/^https?:\/\//i.test(filePath)) {
    return filePath
  }

  const base =
    process.env.NEXT_PUBLIC_AWS_S3 ||
    process.env.NEXT_PUBLIC_S3_BASE_URL ||
    process.env.MEDUSA_BACKEND_URL ||
    ""

  if (!base) {
    return filePath
  }

  return `${base.replace(/\/$/, "")}/${filePath.replace(/^\//, "")}`
}
