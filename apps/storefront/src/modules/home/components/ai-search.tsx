"use client"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { sdk } from "@lib/config"
import { useEffect, useRef, useState } from "react"

/**
 * Natural-language product search input on the homepage.
 *
 * Calls POST /store/ai/search — the backend LLM-extracts keywords, runs
 * a semantic vector search against PgVector, and returns a small set of
 * products shaped like /store/products. Results render in an inline
 * dropdown below the input; clicking a result navigates to the product
 * page via LocalizedClientLink so the country-code prefix is preserved.
 *
 * Debounce window is intentionally short (350ms) — each call hits a
 * paid LLM, so we want one call per "thought" rather than per keystroke,
 * but the user shouldn't notice waiting.
 */
type Variant = {
  id: string
  title?: string | null
  calculated_price?: {
    calculated_amount?: number | null
    currency_code?: string | null
  } | null
}

type SearchProduct = {
  id: string
  handle: string
  title: string
  thumbnail?: string | null
  variants?: Variant[]
}

type SearchResponse = {
  query: string
  mode: "vector" | "lexical"
  interpretation: {
    keywords: string[]
    color?: string
    material?: string
    min_price?: number
    max_price?: number
  }
  products: SearchProduct[]
  count: number
}

const DEBOUNCE_MS = 350
const MIN_QUERY_LEN = 2

const formatPrice = (variants: Variant[] | undefined): string | null => {
  const amounts = (variants ?? [])
    .map((v) => v?.calculated_price?.calculated_amount)
    .filter((n): n is number => typeof n === "number")
  if (!amounts.length) return null
  const low = Math.min(...amounts)
  const cc =
    (variants ?? []).find(
      (v) => v?.calculated_price?.currency_code
    )?.calculated_price?.currency_code ?? "INR"
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cc.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(low)
  } catch {
    return `${cc.toUpperCase()} ${low}`
  }
}

export default function AiSearch() {
  const [query, setQuery] = useState("")
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // Tracks the AbortController of the most recent in-flight request so
  // we cancel old requests when the user keeps typing — otherwise a
  // slow earlier response could overwrite a faster later one.
  const inflightRef = useRef<AbortController | null>(null)

  // Close on outside click.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  // Debounced search effect.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LEN) {
      setResponse(null)
      setLoading(false)
      return
    }

    const handle = window.setTimeout(async () => {
      inflightRef.current?.abort()
      const controller = new AbortController()
      inflightRef.current = controller
      setLoading(true)
      try {
        const r = await sdk.client.fetch<SearchResponse>("/store/ai/search", {
          method: "POST",
          body: { query: trimmed, limit: 6 },
          signal: controller.signal,
        } as any)
        if (controller.signal.aborted) return
        setResponse(r)
      } catch (e) {
        if ((e as any)?.name === "AbortError") return
        setResponse(null)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(handle)
  }, [query])

  const hasResults = Boolean(response?.products?.length)
  const showDropdown =
    open && query.trim().length >= MIN_QUERY_LEN && (loading || response)

  return (
    <div ref={containerRef} className="relative">
      <label className="sr-only" htmlFor="ai-search">
        Search products
      </label>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 sm:left-5 sm:h-5 sm:w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        id="ai-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Describe what you want — e.g. soft cotton dress"
        className="w-full rounded-full border border-neutral-300 bg-white pl-11 pr-5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 sm:pl-12 sm:pr-6 sm:py-3 sm:text-base"
        autoComplete="off"
        spellCheck={false}
      />
      <p className="mt-2 text-center text-xs text-neutral-500 sm:text-sm">
        Natural-language discovery — powered by AI.
      </p>

      {showDropdown && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-neutral-200 bg-white shadow-xl"
        >
          {loading && (
            <div className="px-4 py-3 text-sm text-neutral-500">
              Searching…
            </div>
          )}
          {!loading && response && !hasResults && (
            <div className="px-4 py-3 text-sm text-neutral-500">
              No matches yet — try simpler keywords.
            </div>
          )}
          {hasResults &&
            response!.products.map((p) => {
              const price = formatPrice(p.variants)
              return (
                <LocalizedClientLink
                  key={p.id}
                  href={`/products/${p.handle}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none"
                  onClick={() => setOpen(false)}
                >
                  {p.thumbnail ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={p.thumbnail}
                      alt=""
                      className="h-12 w-12 rounded-md object-cover sm:h-14 sm:w-14"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-md bg-neutral-100 sm:h-14 sm:w-14" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900 sm:text-base">
                      {p.title}
                    </p>
                    {price && (
                      <p className="text-xs text-neutral-500 sm:text-sm">
                        from {price}
                      </p>
                    )}
                  </div>
                </LocalizedClientLink>
              )
            })}
          {response?.interpretation && (
            <div className="border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-400 sm:text-xs">
              Interpreted as:{" "}
              {response.interpretation.keywords.join(", ") || query}
              {response.interpretation.color
                ? ` · ${response.interpretation.color}`
                : ""}
              {response.interpretation.material
                ? ` · ${response.interpretation.material}`
                : ""}
              {response.interpretation.max_price
                ? ` · under ${response.interpretation.max_price}`
                : ""}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
