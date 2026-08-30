"use client"

import { presignDesignImageUpload } from "@lib/data/uploads"
import { analyzeDesignReference } from "@lib/data/design-references"

/**
 * Design reference uploads — the chat design editor's file-upload utility.
 *
 * The maker drops / picks reference images (inspirations, photos of garments
 * they want to riff on). Each file is:
 *   1. previewed immediately as an object URL (no server round-trip), then
 *   2. uploaded to storage via a presigned S3 URL when the maker is signed in,
 *   3. analysed on the fly — the vision description is attached so the chat
 *      can show it and the message can ground the model on it.
 *
 * Guests keep their session-local preview (thumbnails still render across the
 * chat) — the presign endpoint is customer-authenticated, so a guest upload
 * degrades to `status: "preview"` instead of failing the whole send.
 */

export type ReferenceAnalysis = {
  title: string
  description: string
  suggestions: string[]
  media_id: string | null
  analyzed_at: string | null
  cached?: boolean
}

export type DesignReference = {
  id: string
  file: File
  /** Object URL for immediate display (session-only). */
  previewUrl: string
  /** Permanent public URL once uploaded to storage. */
  publicUrl: string | null
  /** preview → uploading → ready | error */
  status: "preview" | "uploading" | "ready" | "error"
  /** Human-readable error for guests / failed uploads. */
  error?: string
  /** Vision analysis attached after the on-the-fly read. */
  analysis?: ReferenceAnalysis | null
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_SIZE_BYTES = 10 * 1024 * 1024

let idCounter = 0
const nextId = () => `ref-${Date.now()}-${idCounter++}`

export const isAcceptedImage = (file: File): boolean =>
  ACCEPTED_TYPES.includes(file.type) && file.size <= MAX_SIZE_BYTES

/** Build a session-local reference with an object-URL preview. */
export const createReference = (file: File): DesignReference => ({
  id: nextId(),
  file,
  previewUrl: URL.createObjectURL(file),
  publicUrl: null,
  status: "preview",
})

export const releaseReference = (ref: DesignReference): void => {
  URL.revokeObjectURL(ref.previewUrl)
}

/**
 * Upload a single reference to storage. Resolves with an updated reference —
 * `publicUrl` is set on success, otherwise `status: "error"` + a friendly
 * message (guests are told to sign in rather than shown a raw 401).
 */
export const uploadDesignReference = async (
  ref: DesignReference
): Promise<DesignReference> => {
  if (ref.status === "ready" && ref.publicUrl) {
    return ref
  }

  const result = await presignDesignImageUpload({
    name: ref.file.name || "reference.jpg",
    type: ref.file.type || "image/jpeg",
    size: ref.file.size,
  })

  if (result.error) {
    return {
      ...ref,
      status: "error",
      error:
        result.error.code === "AUTH_REQUIRED"
          ? "Sign in to add references to your board."
          : result.error.message || "Upload failed.",
    }
  }

  const { url: presignedUrl, public_url } = result.presign!
  const uploadRes = await fetch(presignedUrl, {
    method: "PUT",
    body: ref.file,
    headers: { "Content-Type": ref.file.type || "image/jpeg" },
  })

  if (!uploadRes.ok) {
    return {
      ...ref,
      status: "error",
      error: "Upload failed — try again.",
    }
  }

  // On-the-fly vision read — attach the analysis so the chat can show it and
  // the message can ground the model on it. Best-effort (never blocks upload).
  const { analysis } = await analyzeDesignReference({
    url: public_url,
    name: ref.file.name,
    mime_type: ref.file.type || undefined,
  })

  return {
    ...ref,
    publicUrl: public_url,
    status: "ready",
    analysis: analysis ?? null,
  }
}