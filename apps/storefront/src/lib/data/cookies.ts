import "server-only"
import { cookies as nextCookies } from "next/headers"

export const getAuthHeaders = async (): Promise<
  { authorization: string } | {}
> => {
  try {
    const cookies = await nextCookies()
    const token = cookies.get("_medusa_jwt")?.value

    if (!token) {
      return {}
    }

    return { authorization: `Bearer ${token}` }
  } catch {
    return {}
  }
}

export const getCacheTag = async (tag: string): Promise<string> => {
  try {
    const cookies = await nextCookies()
    const cacheId = cookies.get("_medusa_cache_id")?.value

    if (!cacheId) {
      return ""
    }

    return `${tag}-${cacheId}`
  } catch (error) {
    return ""
  }
}

export const getCacheOptions = async (
  tag: string
): Promise<{ tags: string[] } | {}> => {
  if (typeof window !== "undefined") {
    return {}
  }

  const cacheTag = await getCacheTag(tag)

  if (!cacheTag) {
    return {}
  }

  return { tags: [`${cacheTag}`] }
}

export const setAuthToken = async (token: string) => {
  const cookies = await nextCookies()
  cookies.set("_medusa_jwt", token, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  })
}

export const removeAuthToken = async () => {
  const cookies = await nextCookies()
  cookies.set("_medusa_jwt", "", {
    maxAge: -1,
  })
}

export const getCartId = async () => {
  const cookies = await nextCookies()
  return cookies.get("_medusa_cart_id")?.value
}

export const setCartId = async (cartId: string) => {
  const cookies = await nextCookies()
  cookies.set("_medusa_cart_id", cartId, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  })
}

export const removeCartId = async () => {
  const cookies = await nextCookies()
  cookies.set("_medusa_cart_id", "", {
    maxAge: -1,
  })
}

/**
 * Reads first-touch tracking cookies set by the middleware. Returns an
 * object with all available attribution fields — any field not yet
 * captured is omitted from the result.
 *
 * Used by cart stamping (addToCart) so the backend can join carts →
 * campaigns → orders for ad-planning attribution.
 */
export const getTrackingCookies = async (): Promise<
  Record<string, string>
> => {
  try {
    const cookies = await nextCookies()
    const keys = [
      "jyt_utm_source",
      "jyt_utm_medium",
      "jyt_utm_campaign",
      "jyt_utm_term",
      "jyt_utm_content",
      "jyt_gclid",
      "jyt_fbclid",
      "jyt_ref",
      "jyt_referrer",
      "jyt_landing_page",
    ]
    const result: Record<string, string> = {}
    for (const key of keys) {
      const value = cookies.get(key)?.value
      if (value) {
        result[key.replace("jyt_", "")] = value
      }
    }
    return result
  } catch {
    return {}
  }
}
