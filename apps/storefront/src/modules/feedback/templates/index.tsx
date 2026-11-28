"use client"

import { Button, Heading, Text, Textarea } from "@medusajs/ui"
import { useEffect, useRef, useState, useTransition } from "react"

import { submitFeedback, type FeedbackRating, type FeedbackView } from "@lib/data/feedback"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * Post-delivery feedback: stars (required), an optional note, and — when the
 * backend offers some — an optional "which of these moods reflects you?" artwork
 * pick. States: the form, thank-you after sending, already answered.
 */
const LABELS = ["Not happy", "Could be better", "It's okay", "Good", "Love it"]
const RATING_NUMBER: Record<FeedbackRating, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="content-container flex min-h-[60vh] items-center justify-center py-16">
    <div className="w-full max-w-2xl px-1 small:px-0">
      {children}
    </div>
  </div>
)

const Star = ({ filled }: { filled: boolean }) => (
  <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2.8l2.83 5.74 6.33.92-4.58 4.46 1.08 6.3L12 17.25l-5.66 2.97 1.08-6.3L2.84 9.46l6.33-.92L12 2.8z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)

const Stars = ({ value, readOnly = false, onChange }: {
  value: number
  readOnly?: boolean
  onChange?: (n: number) => void
}) => {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div
      className="flex justify-center gap-1 text-ui-fg-base"
      role={readOnly ? "img" : "radiogroup"}
      aria-label={readOnly ? `${value} out of 5` : "Your rating"}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) =>
        readOnly ? (
          <Star key={n} filled={n <= value} />
        ) : (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} – ${LABELS[n - 1]}`}
            className="rounded p-1 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-border-interactive"
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange?.(n)}
            data-testid={`feedback-star-${n}`}
          >
            <Star filled={n <= shown} />
          </button>
        )
      )}
    </div>
  )
}

/**
 * An image that reports when it failed. The server-rendered <img> can fail
 * BEFORE React hydrates (onError never fires then), so also check on mount.
 * A tiny image (a 1×1 placeholder) "loads" but shows nothing, so it counts as
 * broken too.
 */
const TOO_SMALL = 32
const ArtImg = ({ src, alt, onBroken }: { src: string; alt: string; onBroken: () => void }) => {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const img = ref.current
    if (img && img.complete && img.naturalWidth < TOO_SMALL) onBroken()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt={alt}
      className="h-full w-full object-cover"
      onError={onBroken}
      onLoad={(e) => {
        if (e.currentTarget.naturalWidth < TOO_SMALL) onBroken()
      }}
    />
  )
}

const Section = ({ step, title, hint, children }: {
  step: number
  title: string
  hint?: string
  children: React.ReactNode
}) => (
  <section className="border-t border-ui-border-base pt-6 mt-6 first:mt-0 first:border-t-0 first:pt-0">
    <div className="mb-4 flex items-baseline gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ui-bg-subtle text-xs font-medium text-ui-fg-subtle">
        {step}
      </span>
      <div>
        <Text weight="plus" className="text-base">
          {title}
        </Text>
        {hint ? (
          <Text size="small" className="text-ui-fg-muted">
            {hint}
          </Text>
        ) : null}
      </div>
    </div>
    {children}
  </section>
)

/** Full-screen look at one artwork, with "choose this one" right there. */
const ArtPreview = ({ src, alt, chosen, onChoose, onClose }: {
  src: string
  alt: string
  chosen: boolean
  onChoose: () => void
  onClose: () => void
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 p-4"
      onClick={onClose}
      data-lenis-prevent
      data-testid="feedback-art-preview"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[78vh] max-w-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="mt-4" onClick={(e) => e.stopPropagation()}>
        <Button variant={chosen ? "secondary" : "primary"} onClick={onChoose}>
          {chosen ? "Chosen ✓ — tap to undo" : "Choose this one"}
        </Button>
      </div>
    </div>
  )
}

const Check = () => (
  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ui-tag-green-bg text-ui-tag-green-text">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
)

const KeepShopping = () => (
  <div className="mt-6 flex justify-center">
    <LocalizedClientLink href="/store">
      <Button variant="secondary">Keep shopping</Button>
    </LocalizedClientLink>
  </div>
)

export function FeedbackNotFound() {
  return (
    <Card>
      <div className="text-center" data-testid="feedback-not-found">
        <Heading level="h1" className="mb-2 text-2xl">
          We couldn&rsquo;t find this feedback link
        </Heading>
        <Text className="text-ui-fg-subtle">
          The link may be incomplete. Please open it again from the email we sent
          after your order arrived, or reply to that email and tell us how it went.
        </Text>
        <KeepShopping />
      </div>
    </Card>
  )
}

const Answered = ({ rating, comment, justSent }: {
  rating: number | null
  comment: string | null
  justSent: boolean
}) => (
  <Card>
    <div className="text-center" data-testid={justSent ? "feedback-thanks" : "feedback-already-answered"}>
      <Check />
      <Heading level="h1" className="mb-2 text-2xl">
        {justSent ? "Thank you!" : "You've already answered"}
      </Heading>
      <Text className="mb-4 text-ui-fg-subtle">
        {justSent
          ? "Your feedback reaches the people who made your order."
          : "Thanks, we already have your feedback for this order."}
      </Text>
      {rating ? <Stars value={rating} readOnly /> : null}
      {comment ? (
        <Text className="mt-4 whitespace-pre-line italic text-ui-fg-subtle">&ldquo;{comment}&rdquo;</Text>
      ) : null}
      <KeepShopping />
    </div>
  </Card>
)

export default function FeedbackTemplate({ view, feedbackId }: {
  view: FeedbackView
  feedbackId: string
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [artworkId, setArtworkId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [brokenArt, setBrokenArt] = useState<Set<string>>(() => new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [done, setDone] = useState<null | "sent" | "already">(
    view.feedback.answered ? "already" : null
  )
  const [pending, startTransition] = useTransition()

  if (done) {
    const answeredRating =
      done === "sent" ? rating : view.feedback.rating ? RATING_NUMBER[view.feedback.rating] : null
    return (
      <Answered
        rating={answeredRating}
        comment={done === "sent" ? comment.trim() || null : view.feedback.comment}
        justSent={done === "sent"}
      />
    )
  }

  const items = view.order?.items ?? []
  const orderNo = view.order?.display_id != null ? `#${view.order.display_id}` : null
  // An image that fails to load is dropped, so a broken picture never shows.
  const artworks = view.artworks.filter((a) => a.file_path && !brokenArt.has(a.id))
  const preview = previewId ? artworks.find((a) => a.id === previewId) ?? null : null

  const onSubmit = () => {
    if (!rating) {
      setError("Please choose a rating first.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await submitFeedback(feedbackId, {
        rating,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(artworkId ? { artwork_id: artworkId } : {}),
      })
      if (res.ok) setDone("sent")
      else if (res.already_answered) setDone("already")
      else setError(res.error)
    })
  }

  return (
    <Card>
      <div className="mb-8 text-center">
        <Heading level="h1" className="text-2xl small:text-3xl">
          How was your order{orderNo ? ` ${orderNo}` : ""}?
        </Heading>
        <Text className="mt-1 text-ui-fg-subtle">
          It takes a few seconds and helps the makers behind it.
        </Text>
      </div>

      {items.length > 0 && (
        <ul className="mb-8 flex flex-col gap-4" data-testid="feedback-items">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-4 rounded-xl bg-ui-bg-subtle p-3">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-ui-bg-component small:h-28 small:w-28">
                {it.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumbnail} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-ui-fg-muted" aria-hidden="true">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                      <path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <Text weight="plus" className="line-clamp-2 text-base">
                  {it.title}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {[it.variant_title, it.quantity > 1 ? `Qty ${it.quantity}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Section step={1} title="Your rating">
        <Stars value={rating} onChange={(n) => { setRating(n); setError(null) }} />
        <Text size="small" className="mt-1 h-5 text-center text-ui-fg-subtle">
          {rating ? LABELS[rating - 1] : "Tap a star"}
        </Text>
      </Section>

      {artworks.length > 0 && (
        <Section step={2} title="Which of these moods reflects you?" hint="Optional. Tap the one that feels like you, or open it to see it bigger.">
          <div className="grid grid-cols-2 gap-3 small:grid-cols-3 small:gap-4">
            {artworks.map((a) => {
              const chosen = artworkId === a.id
              const alt = a.alt_text || a.title || "Artwork"
              return (
                <div key={a.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setArtworkId(chosen ? null : a.id)}
                    aria-pressed={chosen}
                    className={`block aspect-[4/5] w-full overflow-hidden rounded-xl border-2 transition ${
                      chosen
                        ? "border-ui-fg-base shadow-elevation-card-hover"
                        : "border-transparent hover:border-ui-border-strong"
                    }`}
                    data-testid={`feedback-art-${a.id}`}
                  >
                    <ArtImg
                      src={a.file_path as string}
                      alt={alt}
                      onBroken={() => {
                        setBrokenArt((prev) => new Set(prev).add(a.id))
                        if (artworkId === a.id) setArtworkId(null)
                      }}
                    />
                  </button>
                  {chosen ? (
                    <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-ui-fg-base px-2 py-0.5 text-xs font-medium text-ui-bg-base">
                      Chosen
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPreviewId(a.id)}
                    aria-label={`View ${alt} larger`}
                    className="absolute bottom-2 right-2 rounded-full bg-black/55 p-2 text-white backdrop-blur-sm transition hover:bg-black/75"
                    data-testid={`feedback-art-zoom-${a.id}`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      <Section step={artworks.length > 0 ? 3 : 2} title="Anything you'd like to tell us?" hint="Optional.">
      <label className="block">
        <span className="sr-only">Your note</span>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="How it fits, the fabric, the packaging, the delivery…"
          data-testid="feedback-comment"
        />
      </label>
      </Section>

      {error && (
        <Text size="small" className="mt-2 text-ui-fg-error" data-testid="feedback-error">
          {error}
        </Text>
      )}

      <Button
        className="mt-6 w-full"
        size="large"
        onClick={onSubmit}
        isLoading={pending}
        disabled={pending}
        data-testid="feedback-submit"
      >
        Send feedback
      </Button>

      {preview ? (
        <ArtPreview
          src={preview.file_path as string}
          alt={preview.alt_text || preview.title || "Artwork"}
          chosen={artworkId === preview.id}
          onChoose={() => {
            setArtworkId(artworkId === preview.id ? null : preview.id)
            setPreviewId(null)
          }}
          onClose={() => setPreviewId(null)}
        />
      ) : null}
    </Card>
  )
}
