"use client"

import React from "react"
import clsx from "clsx"
import { PhotoSolid, Spinner, XMark } from "@medusajs/icons"
import type { DesignReference } from "../lib/design-uploads"

/**
 * Attachment thumbnails — the chat design editor's file display primitives.
 *
 * Two jobs:
 *   - `AttachButton` opens the OS file picker and hands accepted images up.
 *   - `AttachmentThumb` / `AttachmentThumbnails` render the thumbnails
 *     "across the chat": in the composer (pending) and inside the sent
 *     user message bubble (preview / uploading / ready / errored states).
 */

export type AttachmentThumbData = {
  id: string
  name: string
  previewUrl: string
  status?: DesignReference["status"]
  error?: string
  /** On-the-fly vision read — shown as a hover hint + "AI read" badge. */
  analysis?: { title?: string; description?: string } | null
}

export function AttachmentThumb({
  id,
  name,
  previewUrl,
  status = "preview",
  error,
  analysis,
  onRemove,
  compact = false,
  className,
}: AttachmentThumbData & {
  onRemove?: (id: string) => void
  compact?: boolean
  className?: string
}) {
  const hint = analysis?.title
    ? `${analysis.title}${analysis.description ? ` — ${analysis.description}` : ""}`
    : name

  return (
    <div
      className={clsx(
        "group relative shrink-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base",
        compact ? "h-14 w-14" : "h-20 w-20",
        className
      )}
      title={hint}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl}
        alt={name}
        className="h-full w-full object-cover"
      />

      {status === "uploading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Spinner className="h-4 w-4 animate-spin text-white" />
        </div>
      )}

      {analysis?.title && status !== "uploading" && (
        <span
          className="absolute left-1 top-1 rounded bg-black/55 px-1 py-0.5 text-[8px] font-medium uppercase tracking-wide text-white/90"
          title={hint}
        >
          ✦ AI read
        </span>
      )}

      {status === "error" && (
        <div className="absolute inset-x-0 bottom-0 bg-ui-tag-red-bg/90 px-1 py-0.5 text-center text-[9px] leading-3 text-ui-tag-red-text">
          {error ?? "upload failed"}
        </div>
      )}

      {status === "ready" && (
        <div className="absolute inset-x-0 bottom-0 bg-ui-tag-green-bg/90 px-1 py-0.5 text-center text-[9px] font-medium leading-3 text-ui-tag-green-text">
          Ready
        </div>
      )}

      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(id)}
          aria-label={`Remove ${name}`}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          <XMark className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export function AttachmentThumbnails({
  refs,
  onRemove,
  compact = false,
  className,
}: {
  refs: AttachmentThumbData[]
  onRemove?: (id: string) => void
  compact?: boolean
  className?: string
}) {
  if (!refs.length) return null
  return (
    <div className={clsx("flex flex-wrap gap-2", className)}>
      {refs.map((ref) => (
        <AttachmentThumb
          key={ref.id}
          id={ref.id}
          name={ref.name}
          previewUrl={ref.previewUrl}
          status={ref.status}
          error={ref.error}
          onRemove={onRemove}
          compact={compact}
        />
      ))}
    </div>
  )
}

export function AttachButton({
  onFiles,
  disabled,
  className,
  inputRef,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  className?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) onFiles(files)
    // Reset so the same file can be picked again.
    e.target.value = ""
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        /**
         * Kept in step with `ACCEPTED_TYPES` in `lib/design-uploads`, which is
         * itself kept in step with the upload route's own list. A type the
         * picker filters out never reaches the validator that would have
         * accepted it — the maker just sees their photo greyed out with no
         * reason given. HEIC matters here: it is what an iPhone hands you.
         */
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif"
        multiple
        onChange={handleChange}
        className="hidden"
        aria-label="Attach reference images"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef?.current?.click()}
        aria-label="Attach reference images"
        title="Add inspirations / reference photos"
        className={clsx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ui-fg-subtle transition-colors hover:bg-ui-bg-base-hover hover:text-ui-fg-base disabled:opacity-40",
          className
        )}
      >
        <PhotoSolid className="h-5 w-5" />
      </button>
    </>
  )
}