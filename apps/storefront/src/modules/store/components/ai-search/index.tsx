"use client"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { searchAiProducts, type AiSearchProduct } from "@lib/data/ai-search"
import { useCallback, useRef, useState } from "react"

/**
 * Inline AI search for the /store route.
 *
 * Lives at the top of the right column in StoreTemplate. When a customer
 * submits a query we call the /store/ai/search server action and render
 * results in a small product grid right above the standard catalogue —
 * the existing PaginatedProducts list stays visible below so the
 * customer can fall back to the full catalogue without navigating.
 *
 * The chat-style modal experience (multi-turn, persisted history) lives
 * separately on the homepage (`modules/home/components/ai-search-chat`).
 * /store is intentionally a single-shot search — typing then submitting
 * shows results, "Clear" wipes back to the regular catalogue.
 */
type State =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | {
      kind: "result"
      query: string
      products: AiSearchProduct[]
      interpretation?: {
        keywords: string[]
        color?: string
        material?: string
        max_price?: number
      }
      mode: "vector" | "lexical"
    }
  | { kind: "error"; query: string }

export default function StoreAiSearch() {
  const [input, setInput] = useState("")
  const [state, setState] = useState<State>({ kind: "idle" })
  // Token check so a stale response can't overwrite a fresher one when
  // the customer hits submit twice in a row.
  const inflightRef = useRef<symbol | null>(null)

  const submit = useCallback(async () => {
    const trimmed = input.trim()
    if (trimmed.length < 2) return
    setState({ kind: "loading", query: trimmed })
    const myToken = Symbol()
    inflightRef.current = myToken
    try {
      const r = await searchAiProducts(trimmed, 12)
      if (inflightRef.current !== myToken) return
      if (!r) {
        setState({ kind: "error", query: trimmed })
        return
      }
      setState({
        kind: "result",
        query: trimmed,
        products: r.products,
        interpretation: r.interpretation,
        mode: r.mode,
      })
    } catch {
      if (inflightRef.current === myToken) {
        setState({ kind: "error", query: trimmed })
      }
    }
  }, [input])

  const clear = useCallback(() => {
    setInput("")
    setState({ kind: "idle" })
    inflightRef.current = null
  }, [])

  return (
    <div className="mb-8">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="flex items-center gap-2"
      >
        <label className="sr-only" htmlFor="store-ai-search">
          Search products
        </label>
        <input
          id="store-ai-search"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search products — describe what you want"
          className="flex-1 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 sm:text-base"
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={
            state.kind === "loading" || input.trim().length < 2
          }
          className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:text-base"
        >
          {state.kind === "loading" ? "…" : "Search"}
        </button>
        {state.kind !== "idle" && (
          <button
            type="button"
            onClick={clear}
            className="rounded-full px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900"
          >
            Clear
          </button>
        )}
      </form>

      {state.kind === "loading" && (
        <p className="mt-3 text-sm text-neutral-500">
          Searching for <em>"{state.query}"</em>…
        </p>
      )}

      {state.kind === "error" && (
        <p className="mt-3 text-sm text-red-600">
          Couldn't reach the search service. Try again.
        </p>
      )}

      {state.kind === "result" && (
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-neutral-700 sm:text-base">
              <strong>{state.products.length}</strong>{" "}
              {state.products.length === 1 ? "match" : "matches"} for{" "}
              <em>"{state.query}"</em>
            </p>
            {state.interpretation && (
              <p className="text-[11px] text-neutral-500 sm:text-xs">
                Interpreted as:{" "}
                {[
                  state.interpretation.keywords?.join(", "),
                  state.interpretation.color,
                  state.interpretation.material,
                  state.interpretation.max_price
                    ? `under ${state.interpretation.max_price}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          {state.products.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Nothing matched. Try simpler keywords, or browse the
              catalogue below.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {state.products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

const ProductCard = ({ product }: { product: AiSearchProduct }) => {
  const attribution = product.storefront
  const isPartner = attribution?.kind === "partner" && Boolean(attribution.url)

  const body = (
    <>
      {product.thumbnail ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={product.thumbnail}
          alt=""
          className="aspect-square w-full rounded-md object-cover"
        />
      ) : (
        <div className="aspect-square w-full rounded-md bg-neutral-200" />
      )}
      <div className="mt-2 flex items-start justify-between gap-1">
        <p className="line-clamp-2 text-sm font-medium text-neutral-900">
          {product.title}
        </p>
        {isPartner && (
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-800">
            Partner
          </span>
        )}
      </div>
    </>
  )

  if (isPartner && attribution.url) {
    return (
      <li>
        <a
          href={attribution.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg p-1 hover:bg-amber-50/40"
        >
          {body}
        </a>
      </li>
    )
  }
  return (
    <li>
      <LocalizedClientLink
        href={`/products/${product.handle}`}
        className="block rounded-lg p-1 hover:bg-white"
      >
        {body}
      </LocalizedClientLink>
    </li>
  )
}
