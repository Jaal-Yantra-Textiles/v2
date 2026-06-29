import { FocusModal, clx } from "@medusajs/ui"
import { useContext, useId } from "react"

import { Thumbnail } from "./thumbnail"
import { StackedModalContext } from "../../modals/stacked-modal-provider/stacked-modal-context"
import { StackedFocusModal } from "../../modals/stacked-focus-modal/stacked-focus-modal"

type ThumbnailPreviewProps = {
  src?: string | null
  alt?: string
  size?: "small" | "base"
}

/**
 * A <Thumbnail> that expands to the full-size image in a modal on click (#735).
 *
 * Context-aware: when rendered inside a RouteFocusModal (which provides a
 * `StackedModalProvider`) it stacks ABOVE the parent modal via
 * `StackedFocusModal` instead of nesting two FocusModals; on a plain page it
 * falls back to a standalone `FocusModal`. With no `src` it renders the
 * placeholder thumbnail and is not interactive. Mirrors the admin component of
 * the same name.
 */
export const ThumbnailPreview = ({
  src,
  alt,
  size = "base",
}: ThumbnailPreviewProps) => {
  // `useContext` returns null (instead of throwing) when there's no provider.
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
