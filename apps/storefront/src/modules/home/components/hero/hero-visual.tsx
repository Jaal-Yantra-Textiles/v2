"use client"

import imageLoader from "@lib/util/image-loader"
import { useRef, useState } from "react"
import AiSearchChat, {
  type AiSearchChatHandle,
} from "../ai-search-chat"
import HeroScrollButton from "./hero-scroll-button"

interface HeroVisualProps {
  imageUrl: string | null
  alt?: string
  /** Optional credit line (artist/source) rendered subtly at bottom. */
  credit?: string | null
}

// Routes Cloudflare-hosted heroes through `/cdn-cgi/image/...` (so the
// browser-fetched source is already <4MB) and falls back to Vercel's
// optimizer for everything else. Same logic as the next/image custom loader.
function nextImg(url: string, w: 1080 | 1920 | 2400 = 1920, q = 82) {
  return imageLoader({ src: url, width: w, quality: q })
}

/**
 * Painting-backed hero with a centred chat-trigger search bar.
 *
 * The chat modal (AiSearchChat) is rendered here so the trigger can
 * .open() it directly — placing them in the same component means a
 * click on the search bar pops the same concierge experience that
 * lives elsewhere on the storefront, with no prop drilling.
 *
 * Layout: a single full-bleed image fills the viewport. A subtle
 * top→bottom darkening keeps the search bar + CTAs legible against
 * paintings of any luminance. The "Cici Label" wordmark and the
 * smaller CTAs sit below the bar so the artwork can breathe.
 *
 * Performance: the painting renders with `loading="eager"` and
 * `fetchPriority="high"` since it's LCP. The CSS `animate-fade-in`
 * class is replaced with a plain Tailwind opacity transition so we
 * don't need a Framer Motion import for a one-shot fade.
 */
export default function HeroVisual({ imageUrl, alt, credit }: HeroVisualProps) {
  const chatRef = useRef<AiSearchChatHandle>(null)
  const [input, setInput] = useState("")

  const openChat = () => {
    chatRef.current?.open(input.trim() || undefined)
    setInput("")
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    openChat()
  }

  return (
    <section
      id="hero-section"
      className="relative isolate flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-neutral-900 select-none"
    >
      {/* ── Painting ───────────────────────────────────────────────── */}
      {imageUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={nextImg(imageUrl, 1920)}
          srcSet={`${nextImg(imageUrl, 1080)} 1080w, ${nextImg(imageUrl, 1920)} 1920w, ${nextImg(imageUrl, 2400)} 2400w`}
          sizes="100vw"
          alt={alt || "Hero artwork"}
          className="absolute inset-0 h-full w-full object-cover hero-fade-in"
          fetchPriority="high"
          loading="eager"
          draggable={false}
        />
      ) : (
        // Quiet placeholder gradient while the album fills up.
        <div
          className="absolute inset-0 hero-fade-in"
          style={{
            background:
              "radial-gradient(ellipse at center, #25201d 0%, #0a0a0a 70%)",
          }}
        />
      )}

      {/* Darkening overlay — soft on top, deeper at bottom — so the
          search input and CTAs stay legible regardless of painting
          luminance. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.20) 35%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Subtle film grain. Pure CSS, no asset. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "192px",
        }}
      />

      {/* ── Centre stack ───────────────────────────────────────────── */}
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center px-6 text-center text-white">
        <h1
          className="font-serif text-balance text-3xl tracking-tight sm:text-4xl md:text-5xl"
          style={{ textShadow: "0 2px 24px rgba(0,0,0,0.45)" }}
        >
          Find your next favourite piece
        </h1>
        <p
          className="mt-3 max-w-md text-sm text-white/80 sm:text-base"
          style={{ textShadow: "0 1px 12px rgba(0,0,0,0.55)" }}
        >
          Handloom-woven, naturally dyed, made by artisan partners
          across India. Ask in your own words.
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-7 flex w-full max-w-lg items-center gap-2 rounded-full bg-white/95 p-1.5 shadow-2xl backdrop-blur-sm focus-within:bg-white"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me anything — fabrics, fits, custom design…"
            aria-label="Ask the Cici Label concierge"
            className="flex-1 bg-transparent px-4 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none sm:text-base"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            onFocus={openChat}
          />
          <button
            type="submit"
            className="rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 sm:px-6 sm:text-base"
          >
            Ask
          </button>
        </form>

        {/* Small wordmark + CTAs underneath */}
        <div className="mt-8 flex flex-col items-center gap-4">
          <p
            className="font-serif text-base tracking-[0.18em] text-white/85 sm:text-lg"
            style={{ textShadow: "0 1px 8px rgba(0,0,0,0.5)" }}
          >
            Cici Label
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <a
              href="/design"
              className="text-xs uppercase tracking-[0.22em] text-white/70 underline underline-offset-[6px] decoration-white/30 transition hover:text-white hover:decoration-white sm:text-[11px]"
            >
              Design your first piece
            </a>
            <span className="hidden h-3 w-px bg-white/20 sm:inline-block" />
            <HeroScrollButton targetId="shop" />
          </div>
        </div>
      </div>

      {/* Optional credit line — bottom-left. Renders only when the
          MediaFile has a caption or description set. */}
      {credit && (
        <p className="absolute bottom-3 left-4 z-10 text-[10px] tracking-wide text-white/40 sm:text-xs">
          {credit}
        </p>
      )}

      {/* Render the chat modal here so the search trigger can open it
          inline. Mounted once on the hero — the same component is also
          mounted elsewhere on the storefront where needed. */}
      <AiSearchChat ref={chatRef} />
    </section>
  )
}
