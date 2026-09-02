import { getLocaleHeader } from "@lib/util/get-locale-header"
import Medusa, { FetchArgs, FetchInput } from "@medusajs/js-sdk"

/**
 * The backend origin this SDK talks to (#1720).
 *
 * 🔴 `NEXT_PUBLIC_MEDUSA_BACKEND_URL` FIRST, and it is not a style choice.
 * Next.js inlines only `NEXT_PUBLIC_*` into the client bundle, so reading the
 * unprefixed name alone left `MEDUSA_BACKEND_URL` undefined in the BROWSER and
 * every client-side call fell through to `http://localhost:9000` — in the
 * visitor's own browser, on production, with no error anywhere.
 *
 * It stayed invisible for two reasons. This app fetches almost everything in
 * server components and server actions, where `process.env` works, so the
 * catalogue, checkout and the AI chat stream were all fine; the design chat's
 * `"use client"` libs were the first client-side SDK callers. And a developer
 * running Medusa locally cannot see it at all — the request resolves to their
 * own :9000 backend.
 *
 * The unprefixed name is kept as a fallback: it is what server-only contexts
 * are configured with, and `provision-storefront.ts` sets BOTH on every
 * partner project.
 *
 * ⚠️ `process.env.NEXT_PUBLIC_*` must be read as a whole static expression for
 * the inlining to happen — never destructured, never index-accessed.
 */
let MEDUSA_BACKEND_URL = "http://localhost:9000"

if (process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL) {
  MEDUSA_BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
} else if (process.env.MEDUSA_BACKEND_URL) {
  MEDUSA_BACKEND_URL = process.env.MEDUSA_BACKEND_URL
}

export const sdk = new Medusa({
  baseUrl: MEDUSA_BACKEND_URL,
  debug: process.env.NODE_ENV === "development",
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
})

const originalFetch = sdk.client.fetch.bind(sdk.client)

sdk.client.fetch = async <T>(
  input: FetchInput,
  init?: FetchArgs
): Promise<T> => {
  const headers = init?.headers ?? {}
  let localeHeader: Record<string, string | null> | undefined
  try {
    localeHeader = await getLocaleHeader()
    headers["x-medusa-locale"] ??= localeHeader["x-medusa-locale"]
  } catch {}

  const newHeaders = {
    ...localeHeader,
    ...headers,
  }
  init = {
    ...init,
    headers: newHeaders,
  }
  return originalFetch(input, init)
}
