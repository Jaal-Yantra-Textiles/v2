"use client"

import { Text } from "@medusajs/ui"
import Image from "next/image"
import { useEffect, useState } from "react"

/**
 * The quoted item's photo, enlargeable (#1389).
 *
 * A 64px thumbnail is enough to recognise a product and nowhere near enough to
 * approve one. A buyer signing off 500 units of a weave wants to see the cloth,
 * and "email me a bigger picture" is a day of round trip.
 *
 * 🔴 Still no placeholder. If there is no image the caller renders nothing —
 * a plausible WRONG photo on a document someone is agreeing to is worse than an
 * empty cell.
 *
 * The overlay is a plain fixed div rather than a dialog primitive: it must work
 * inside a table cell on a page with no app shell, and it closes on Escape,
 * on backdrop click and on the button — three ways out, because a buyer who
 * cannot dismiss an image abandons the quote.
 */
const QuoteLineImage = ({
  src,
  alt,
  caption,
}: {
  src: string
  alt: string
  caption?: string | null
}) => {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    // The page behind must not scroll under the overlay.
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge photo of ${alt}`}
        className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-ui-bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive"
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes="64px"
          quality={60}
          className="object-cover object-center transition-transform duration-200 group-hover:scale-105"
        />
        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/40 text-[10px] font-medium text-white group-hover:flex">
          View
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        >
          <div
            // The image itself must not close the overlay when clicked — a
            // buyer inspecting a weave will click it.
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-full w-full max-w-3xl flex-col gap-y-3"
          >
            <div className="relative h-[70vh] w-full overflow-hidden rounded-lg bg-black/20">
              <Image
                src={src}
                alt={alt}
                fill
                sizes="(max-width: 768px) 100vw, 768px"
                quality={90}
                className="object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-x-4">
              <Text className="txt-small text-white/80">{caption ?? alt}</Text>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default QuoteLineImage
