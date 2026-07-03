import { XMark } from "@medusajs/icons"
import FileModal from "../../../routes/inventory/[id]/raw-materials/create/media/page"

type MediaFieldProps = {
  /** Selected media URLs (bound via RHF through DynamicForm's `custom` field). */
  value?: string[]
  onChange: (urls: string[]) => void
}

/**
 * Controlled media picker for the raw-material forms. Reuses the SAME
 * StackedFocusModal (`FileModal`) the create flow uses, so editing a raw
 * material can add, replace, or remove its media exactly like creating one.
 *
 * The modal's "Save and Close" replaces the whole selection (update/replace);
 * each thumbnail's ✕ removes a single image.
 */
export const MediaField = ({ value, onChange }: MediaFieldProps) => {
  const urls = Array.isArray(value) ? value : []

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {urls.map((url, index) => (
        <div
          key={`${url}-${index}`}
          className="relative h-20 w-20 overflow-hidden rounded-md border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Selected media ${index + 1}`}
            className="h-full w-full object-cover"
          />
          <div className="absolute right-1 top-1 flex items-center justify-center rounded-full bg-white/50 p-0.5">
            <XMark
              className="text-ui-fg-muted hover:text-ui-fg-subtle cursor-pointer"
              onClick={() => onChange(urls.filter((u) => u !== url))}
            />
          </div>
        </div>
      ))}
      {/* Same StackedFocusModal the create form uses; onSave replaces selection. */}
      <FileModal onSave={onChange} initialUrls={urls} />
    </div>
  )
}

export default MediaField
