import { HttpTypes } from "@medusajs/types"
import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL
const PUBLISHABLE_API_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "us"

/**
 * Tracking params to capture from the URL query string. Stored as
 * first-party cookies with a `jyt_` prefix so server-side code (cart
 * stamping, server actions) can read them via `next/headers`.
 *
 * First-touch model: cookies are only written when they don't already
 * exist — the initial ad click / UTM link that brought the visitor in
 * is preserved even if they navigate to other pages.
 */
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "ref",
] as const

const TRACKING_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

/**
 * Captures first-touch attribution params from the URL query string and
 * the `Referer` header, setting them as cookies on the response if they
 * aren't already present. Runs on every request that passes the matcher.
 *
 * Mutates the response's cookie set in-place — returns nothing.
 */
function captureTrackingParams(
  request: NextRequest,
  response: NextResponse,
) {
  const searchParams = request.nextUrl.searchParams
  const existingCookies = request.cookies

  for (const param of TRACKING_PARAMS) {
    const cookieName = `jyt_${param}`
    const value = searchParams.get(param)

    if (value && !existingCookies.get(cookieName)) {
      response.cookies.set(cookieName, value, {
        maxAge: TRACKING_COOKIE_MAX_AGE,
        path: "/",
        sameSite: "lax",
      })
    }
  }

  // HTTP referrer — only set if we don't already have one captured.
  // The `Referer` header is more reliable than `document.referrer` for
  // server-side attribution (it's set by the browser, not spoofable by
  // client JS) and survives ad-blockers that block the analytics script.
  const httpReferrer = request.headers.get("referer")
  if (
    httpReferrer &&
    !existingCookies.get("jyt_referrer")
  ) {
    response.cookies.set("jyt_referrer", httpReferrer, {
      maxAge: TRACKING_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    })
  }

  // Landing page — the first page the visitor landed on. Only set once
  // per cookie lifetime so it always reflects the entry point, not
  // subsequent navigations.
  if (!existingCookies.get("jyt_landing_page")) {
    const landingPath =
      request.nextUrl.pathname + (request.nextUrl.search || "")
    response.cookies.set("jyt_landing_page", landingPath, {
      maxAge: TRACKING_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    })
  }
}

const regionMapCache = {
  regionMap: new Map<string, HttpTypes.StoreRegion>(),
  regionMapUpdated: Date.now(),
}

async function getRegionMap(cacheId: string) {
  const { regionMap, regionMapUpdated } = regionMapCache

  if (!BACKEND_URL) {
    throw new Error(
      "Middleware.ts: Error fetching regions. Did you set up regions in your Medusa Admin and define a MEDUSA_BACKEND_URL environment variable? Note that the variable is no longer named NEXT_PUBLIC_MEDUSA_BACKEND_URL."
    )
  }

  if (
    !regionMap.keys().next().value ||
    regionMapUpdated < Date.now() - 3600 * 1000
  ) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    try {
      const response = await fetch(`${BACKEND_URL}/store/regions`, {
        headers: {
          "x-publishable-api-key": PUBLISHABLE_API_KEY!,
          "Accept-Encoding": "gzip, deflate, br",
        },
        signal: controller.signal,
        next: {
          revalidate: 3600,
          tags: [`regions-${cacheId}`],
        },
        cache: "force-cache",
      }).finally(() => clearTimeout(timeoutId))

      const json = await response.json()

      if (!response.ok) {
        throw new Error(json.message || `Region fetch failed (${response.status})`)
      }

      const regions = json.regions as HttpTypes.StoreRegion[] | undefined

      if (!regions?.length) {
        throw new Error(
          "No regions found. Please set up regions in your Medusa Admin."
        )
      }

      regions.forEach((region) => {
        region.countries?.forEach((c) => {
          regionMapCache.regionMap.set(c.iso_2 ?? "", region)
        })
      })

      regionMapCache.regionMapUpdated = Date.now()
    } catch (error: any) {
      // If we have a stale cache, keep using it rather than crashing
      if (regionMap.keys().next().value) {
        console.warn(
          `[Middleware] Region fetch failed, using stale cache: ${error.message}`
        )
      } else {
        // No cache at all — log and re-throw so the caller can handle it
        console.error(
          `[Middleware] Region fetch failed with no cache: ${error.message}`
        )
        throw error
      }
    }
  }

  return regionMapCache.regionMap
}

/**
 * Fetches regions from Medusa and sets the region cookie.
 * @param request
 * @param response
 */
async function getCountryCode(
  request: NextRequest,
  regionMap: Map<string, HttpTypes.StoreRegion | number>
) {
  try {
    let countryCode

    const vercelCountryCode = request.headers
      .get("x-vercel-ip-country")
      ?.toLowerCase()

    const urlCountryCode = request.nextUrl.pathname.split("/")[1]?.toLowerCase()

    if (urlCountryCode && regionMap.has(urlCountryCode)) {
      countryCode = urlCountryCode
    } else if (vercelCountryCode && regionMap.has(vercelCountryCode)) {
      countryCode = vercelCountryCode
    } else if (regionMap.has(DEFAULT_REGION)) {
      countryCode = DEFAULT_REGION
    } else if (regionMap.keys().next().value) {
      countryCode = regionMap.keys().next().value
    }

    return countryCode
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        "Middleware.ts: Error getting the country code. Did you set up regions in your Medusa Admin and define a MEDUSA_BACKEND_URL environment variable? Note that the variable is no longer named NEXT_PUBLIC_MEDUSA_BACKEND_URL."
      )
    }
  }
}

/**
 * Middleware to handle region selection and onboarding status.
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isCartCheckout = pathname.includes("/checkout/cart/")

  console.log(`[Middleware] ${request.method} ${pathname}${isCartCheckout ? " [CART CHECKOUT]" : ""}`)

  let redirectUrl = request.nextUrl.href

  let response = NextResponse.redirect(redirectUrl, 307)

  let cacheIdCookie = request.cookies.get("_medusa_cache_id")

  let cacheId = cacheIdCookie?.value || crypto.randomUUID()

  const regionMap = await getRegionMap(cacheId)

  const countryCode = regionMap && (await getCountryCode(request, regionMap))

  console.log(`[Middleware] countryCode=${countryCode}, regionMapSize=${regionMap?.size}, hasCacheId=${!!cacheIdCookie}`)

  const urlHasCountryCode =
    countryCode && request.nextUrl.pathname.split("/")[1] === countryCode

  console.log(`[Middleware] urlHasCountryCode=${urlHasCountryCode}, firstSegment=${pathname.split("/")[1]}`)

  // If the URL already has a valid country code, serve the page directly.
  // Set the cache-id cookie on the SAME response (via NextResponse.next) —
  // never redirect to the same URL, or clients without persistent cookies
  // (social preview bots, monitoring agents, some crawlers) get stuck in a
  // 307 loop.
  if (urlHasCountryCode) {
    const next = NextResponse.next()
    if (!cacheIdCookie) {
      console.log(`[Middleware] → NextResponse.next() + setting cache id cookie`)
      next.cookies.set("_medusa_cache_id", cacheId, {
        maxAge: 60 * 60 * 24,
      })
    } else {
      console.log(`[Middleware] → NextResponse.next() (cache id already set)`)
    }

    // Capture first-touch UTM / referrer / landing-page cookies.
    captureTrackingParams(request, next)

    return next
  }

  // check if the url is a static asset (file extension in the last segment only)
  const lastSegment = request.nextUrl.pathname.split("/").pop() || ""
  if (lastSegment.includes(".") && /\.\w{1,5}$/.test(lastSegment)) {
    console.log(`[Middleware] → NextResponse.next() (static asset)`)
    return NextResponse.next()
  }

  // Strip domain-like first segment (e.g., /jaalyantra.com/pages/about-us → /pages/about-us)
  const firstSegment = request.nextUrl.pathname.split("/")[1] || ""
  let cleanedPathname = request.nextUrl.pathname
  if (firstSegment.includes(".") && !regionMap.has(firstSegment)) {
    cleanedPathname = "/" + request.nextUrl.pathname.split("/").slice(2).join("/")
    console.log(`[Middleware] Stripped domain-like segment: ${firstSegment} → ${cleanedPathname}`)
  }

  const redirectPath = cleanedPathname === "/" ? "" : cleanedPathname

  const queryString = request.nextUrl.search ? request.nextUrl.search : ""

  // If no country code is set, we redirect to the relevant region.
  if (!urlHasCountryCode && countryCode) {
    redirectUrl = `${request.nextUrl.origin}/${countryCode}${redirectPath}${queryString}`
    response = NextResponse.redirect(`${redirectUrl}`, 307)
    console.log(`[Middleware] → Redirecting to ${redirectUrl}`)

    // Capture first-touch UTM / referrer / landing-page cookies on the
    // redirect response so they're set before the page even renders.
    captureTrackingParams(request, response)
  } else if (!urlHasCountryCode && !countryCode) {
    console.log(`[Middleware] → 500: No valid regions`)
    // Handle case where no valid country code exists (empty regions)
    return new NextResponse(
      "No valid regions configured. Please set up regions with countries in your Medusa Admin.",
      { status: 500 }
    )
  }

  return response
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|images|assets|png|svg|jpg|jpeg|gif|webp).*)",
  ],
}
