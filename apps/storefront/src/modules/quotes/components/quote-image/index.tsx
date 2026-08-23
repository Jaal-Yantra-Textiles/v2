"use client"

import { Text, clx } from "@medusajs/ui"
import Image from "next/image"
import { useCallback, useEffect, useState } from "react"

/**
 * The quoted item's photography, enlargeable (#1389, gallery in #1439 S14).
 *
 * A 64px thumbnail is enough to recognise a product and nowhere near enough to
 * approve one. A buyer signing off 500 units of a weave wants to see the cloth,
 * the drape and the selvedge — and "email me a bigger picture" is a day of
 * round trip.
 *
 * ## Why this now takes a list
 *
 * The backend has fetched every variant image since #1428; only the first was
 * ever rendered and the rest were discarded silently. That is a defect with no
 * symptom — one photo looks perfectly fine and nobody knows there were five.
 *
 * 🔴 Still no placeholder. If there is no image the caller renders nothing — a
 * plausible WRONG photo on a document someone is agreeing to is worse than an
 * empty cell.
 *
 * The overlay is a plain fixed div rather than a dialog primitive: it must work
 * inside a table cell on a page with no app shell, and it closes on Escape, on
 * backdrop click and on the button — three ways out, because a buyer who cannot
 * dismiss an image abandons the quote.
 */
const QuoteLineImage = ({
  src,
  alt,
  caption,
  images,
}: {
  /** The frame shown in the table — always the first thing the buyer sees. */
  src: string
  alt: string
  caption?: string | null
  /**
   * The full gallery, when the variant has one. Omitted or short means this
   * behaves exactly as it did before: one photo, one zoom.
   */
  images?: string[]
}) => {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  // `src` is guaranteed to be the first frame by the backend (`thumbnail` IS
  // `images[0]` whenever the variant has its own images), but a caller that
  // passed a stray one must not produce a gallery missing the visible frame.
  const frames = images?.length ? images : [src]
  const many = frames.length > 1

  const step = useCallback(
    (delta: number) =>
      setIndex((i) => (i + delta + frames.length) % frames.length),
    [frames.length]
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
      // Arrow keys, because someone comparing five shots of a weave will not
      // reach for the mouse between each one.
      if (many && e.key === "ArrowRight") step(1)
      if (many && e.key === "ArrowLeft") step(-1)
    }
    document.addEventListener("keydown", onKey)
    // The page behind must not scroll under the overlay.
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previous
    }
  }, [open, many, step])

  const openAt = (i: number) => {
    setIndex(i)
    setOpen(true)
  }

  return (
    <>
      <div className="flex shrink-0 flex-col gap-y-1">
        <button
          type="button"
          onClick={() => openAt(0)}
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

        {/* The rest of the roll, small. Capped at four beside the main frame:
            beyond that the row grows taller than the line it describes, and the
            count tells the buyer the others exist. */}
        {many ? (
          <div className="flex items-center gap-x-1">
            {frames.slice(1, 5).map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => openAt(i + 1)}
                aria-label={`Enlarge photo ${i + 2} of ${
                  frames.length
                } for ${alt}`}
                className="relative h-7 w-7 shrink-0 overflow-hidden rounded bg-ui-bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive"
              >
                <Image
                  src={url}
                  alt=""
                  fill
                  sizes="28px"
                  quality={40}
                  className="object-cover object-center"
                />
              </button>
            ))}
            {frames.length > 5 ? (
              <button
                type="button"
                onClick={() => openAt(5)}
                aria-label={`See all ${frames.length} photos of ${alt}`}
                className="h-7 shrink-0 rounded bg-ui-bg-subtle px-1.5 text-[10px] text-ui-fg-subtle hover:bg-ui-bg-subtle-hover"
              >
                +{frames.length - 5}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

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
                src={frames[index]}
                alt={alt}
                fill
                sizes="(max-width: 768px) 100vw, 768px"
                quality={90}
                className="object-contain"
              />

              {many ? (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous photo"
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-white hover:bg-black/70"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next photo"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-white hover:bg-black/70"
                  >
                    ›
                  </button>
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-x-4">
              <Text className="txt-small text-white/80">
                {caption ?? alt}
                {many ? (
                  <span className="ml-2 text-white/50">
                    {index + 1} / {frames.length}
                  </span>
                ) : null}
              </Text>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={clx(
                  "rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
                )}
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
