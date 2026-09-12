import { HttpTypes } from "@medusajs/types"
import { NextRequest, NextResponse } from "next/server"

import {
  REGION_MAP_UNCONFIGURED,
  isUnconfiguredRegionsError,
  pickCountryCode,
} from "./lib/util/region-routing"

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
        // 🔑 TAGGED, because this is the one region-map failure that must NOT
        // degrade (#1993). The backend answered; it simply has no regions —
        // a misconfiguration in Medusa Admin, by a developer. Falling back to
        // DEFAULT_REGION here would route every visitor to /us and render
        // empty pages forever with nobody told why.
        const unconfigured = new Error(
          "No regions found. Please set up regions in your Medusa Admin."
        )
        unconfigured.name = REGION_MAP_UNCONFIGURED
        throw unconfigured
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
      } else if (isUnconfiguredRegionsError(error)) {
        // A real misconfiguration: stay loud. See the tag above.
        console.error(`[Middleware] ${error.message}`)
        throw error
      } else {
        // 🔴 #1993: this used to rethrow, which meant a COLD instance — just
        // deployed, restarted or scaled up — 500'd on EVERY route the moment
        // the backend was unreachable. A warm one survived on its stale cache,
        // so "it worked when I tried it" was never evidence the next instance
        // would.
        //
        // It also hid #1992's work: the payment page that tells a buyer "our
        // side is not responding, your link is fine" only renders if
        // middleware lets the request through.
        //
        // So: serve the site on an empty map and let each page say what it
        // cannot load.
        console.error(
          `[Middleware] Region fetch failed with no cache, serving degraded: ${error.message}`
        )
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

    // The precedence itself lives in `lib/util/region-routing` so it can be
    // tested: the case that matters most — an EMPTY map — is exactly the one
    // that is hardest to reach through the middleware.
    const pick = pickCountryCode({
      urlCountryCode,
      vercelCountryCode,
      regionMap,
      defaultRegion: DEFAULT_REGION,
    })

    if (pick.degraded) {
      console.warn(
        `[Middleware] No region map — serving ${pick.countryCode ?? "(no country)"} degraded`
      )
    }

    countryCode = pick.countryCode

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
    // Reachable only when the region map is empty AND no DEFAULT_REGION is
    // set — i.e. nobody has said where an unrouted visitor should go. Since
    // #1993 an unreachable backend no longer lands here: it degrades onto
    // DEFAULT_REGION (which is "us" unless NEXT_PUBLIC_DEFAULT_REGION says
    // otherwise), so this is a configuration answer, not an outage one.
    console.log(`[Middleware] → 500: no region map and no DEFAULT_REGION`)
    return new NextResponse(
      "No regions configured and no NEXT_PUBLIC_DEFAULT_REGION set. Set up regions with countries in your Medusa Admin, or set a default region.",
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
