import { FocusModal, clx } from "@medusajs/ui"
import { useContext, useId } from "react"

import { Thumbnail } from "./thumbnail"
import { StackedModalContext } from "../modal/stacked-modal/stacked-modal-context"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"

type ThumbnailPreviewProps = {
  src?: string | null
  alt?: string
  size?: "small" | "base" | "large"
}

/**
 * A products-table-style <Thumbnail> that expands to the full-size image in a
 * modal on click (#735).
 *
 * Context-aware so it's reusable everywhere a raw-material/media thumbnail is
 * rendered:
 *  - Inside a RouteFocusModal (e.g. the design→inventory DataTable) a parent
 *    `StackedModalProvider` is present, so it uses `StackedFocusModal` — the
 *    preview stacks ABOVE the parent modal instead of nesting two FocusModals
 *    (which would fight over focus-trap / overlay).
 *  - On a plain page (e.g. the inventory raw-material widget) there's no
 *    provider, so it falls back to a standalone `FocusModal`.
 *
 * With no `src` it renders the placeholder thumbnail and is not interactive.
 */
export const ThumbnailPreview = ({
  src,
  alt,
  size = "small",
}: ThumbnailPreviewProps) => {
  // `useContext` returns null (instead of throwing like `useStackedModal`) when
  // there's no provider — that's exactly the signal we want.
  const inStackedContext = useContext(StackedModalContext) !== null
  const reactId = useId()

  if (!src) {
    return <Thumbnail src={src} alt={alt} size={size} />
  }

  const trigger = (
    <button
      type="button"
      className={clx(
        "rounded outline-none transition-shadow",
        "focus-visible:shadow-borders-focus hover:opacity-80"
      )}
      aria-label={alt ? `Preview image: ${alt}` : "Preview image"}
    >
      <Thumbnail src={src} alt={alt} size={size} />
    </button>
  )

  const fullImage = (
    <div className="flex h-full w-full items-center justify-center bg-ui-bg-subtle p-4">
      <img
        src={src}
        alt={alt}
        className="max-h-[80vh] max-w-full rounded-lg object-contain"
      />
    </div>
  )

  if (inStackedContext) {
    return (
      <StackedFocusModal id={`thumbnail-preview-${reactId}`}>
        <StackedFocusModal.Trigger asChild>{trigger}</StackedFocusModal.Trigger>
        <StackedFocusModal.Content>
          <StackedFocusModal.Header />
          <StackedFocusModal.Body className="flex items-center justify-center p-0">
            {fullImage}
          </StackedFocusModal.Body>
        </StackedFocusModal.Content>
      </StackedFocusModal>
    )
  }

  return (
    <FocusModal>
      <FocusModal.Trigger asChild>{trigger}</FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header />
        <FocusModal.Body className="flex items-center justify-center p-0">
          {fullImage}
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
