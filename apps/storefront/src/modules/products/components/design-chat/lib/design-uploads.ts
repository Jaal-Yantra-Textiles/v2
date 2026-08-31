"use client"

/**
 * Design reference uploads — the chat's file-upload utility.
 *
 * ## Why this does not presign
 *
 * 🔴 It used to. `presignDesignImageUpload` returns `AUTH_REQUIRED` before it
 * makes any request when there are no customer auth headers — and the design
 * chat is a GUEST flow, identified by an email and nothing else. So every
 * attached photo degraded to `status: "preview"`: an object URL in the tab,
 * rendered as a thumbnail, gone when the tab closed. Nothing downstream could
 * work, because there was no public URL to work from. Production bore it out:
 * **0 media files have ever carried `metadata.source = "design-reference"`.**
 *
 * The server route (#1691) removed the auth wall by taking the bytes itself.
 * This module is the other half — until it pointed here, that route had no
 * caller and the count stayed at 0.
 *
 *   POST /store/custom/design-assistant/references   (multipart: files[])
 *
 * One request for the whole batch, not one per file: the route resolves-or-
 * CREATES the design, and N concurrent requests with no `design_id` would mint
 * N designs. That is the same defect as #1689's "two designs from one ask",
 * arriving by a different door.
 *
 * The route also analyses each image and pins it to the board, so there is no
 * separate `analyzeDesignReference` round-trip from here any more.
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
  /** Human-readable error for failed uploads. */
  error?: string
  /** Vision analysis attached by the server as it stored each image. */
  analysis?: ReferenceAnalysis | null
}

/** Mirrors the route's own ALLOWED list. */
const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]
const MAX_SIZE_BYTES = 10 * 1024 * 1024
/** The route refuses more than this per request. */
export const MAX_REFERENCES_PER_UPLOAD = 8

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

export type UploadReferencesResult = {
  references: DesignReference[]
  /** The design the photos landed on — new when the chat had none yet. */
  designId: string | null
  createdDesign: boolean
}

/**
 * ⚠️ `sdk.client.fetch` is not usable here: it defaults `content-type` to
 * `application/json` and then `JSON.stringify`s the body, which turns a
 * `FormData` into the string `"[object FormData]"`. Multipart has to go
 * through plain `fetch`, with the publishable key supplied by hand.
 */
const backendUrl = (): string =>
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"

/**
 * Upload the whole pending batch. Resolves with updated references —
 * `publicUrl` + `analysis` set on success, otherwise `status: "error"` and a
 * message the maker can act on.
 *
 * Never throws: a failed upload must not swallow the maker's message.
 */
export const uploadDesignReferences = async (
  refs: DesignReference[],
  opts: { email?: string | null; designId?: string | null }
): Promise<UploadReferencesResult> => {
  const pending = refs.filter((r) => !(r.status === "ready" && r.publicUrl))
  if (!pending.length) {
    return { references: refs, designId: opts.designId ?? null, createdDesign: false }
  }

  const email = (opts.email ?? "").trim().toLowerCase()
  if (!email) {
    // The route saves references against the maker's design, and a design
    // belongs to a maker. Without an email there is nowhere to put them —
    // say so rather than degrading to a preview that looks like it worked.
    return {
      references: refs.map((r) =>
        r.status === "ready" && r.publicUrl
          ? r
          : {
              ...r,
              status: "error" as const,
              error: "Tell me your email first and I'll save these to your board.",
            }
      ),
      designId: opts.designId ?? null,
      createdDesign: false,
    }
  }

  const form = new FormData()
  form.append("customer_email", email)
  if (opts.designId) form.append("design_id", opts.designId)
  for (const ref of pending) {
    form.append("files", ref.file, ref.file.name || "reference.jpg")
  }

  try {
    const response = await fetch(
      `${backendUrl()}/store/custom/design-assistant/references`,
      {
        method: "POST",
        body: form,
        headers: {
          "x-publishable-api-key":
            process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "",
        },
      }
    )

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(text || `HTTP ${response.status}`)
    }

    const data = (await response.json()) as {
      design_id: string | null
      created_design: boolean
      references: Array<{
        url: string
        name: string
        media_id: string | null
        analysis: Omit<ReferenceAnalysis, "media_id"> | null
      }>
    }

    /**
     * Match by filename, in order. The route preserves the order it was given
     * but drops anything it could not store, so a positional match alone would
     * silently attach the wrong analysis to the wrong photo.
     */
    const remaining = [...(data.references ?? [])]
    const merged = refs.map((ref) => {
      if (ref.status === "ready" && ref.publicUrl) return ref
      const idx = remaining.findIndex((r) => r.name === (ref.file.name || "reference.jpg"))
      if (idx === -1) {
        return {
          ...ref,
          status: "error" as const,
          error: "That image could not be stored — try again.",
        }
      }
      const [hit] = remaining.splice(idx, 1)
      return {
        ...ref,
        publicUrl: hit.url,
        status: "ready" as const,
        error: undefined,
        analysis: hit.analysis
          ? { ...hit.analysis, media_id: hit.media_id ?? null }
          : null,
      }
    })

    return {
      references: merged,
      designId: data.design_id ?? opts.designId ?? null,
      createdDesign: Boolean(data.created_design),
    }
  } catch (error: any) {
    console.error("[design-uploads] reference upload failed:", error?.message ?? error)
    return {
      references: refs.map((r) =>
        r.status === "ready" && r.publicUrl
          ? r
          : { ...r, status: "error" as const, error: "Upload failed — try again." }
      ),
      designId: opts.designId ?? null,
      createdDesign: false,
    }
  }
}
