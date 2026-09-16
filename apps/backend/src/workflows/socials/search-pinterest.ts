import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../modules/socials"
import SocialsService from "../../modules/socials/service"
import { decryptAccessToken } from "../../modules/socials/utils/token-helpers"

export type SearchPinterestInput = {
  query: string
  bookmark?: string
}

type SearchPinterestResult = {
  pins: any[]
  bookmark: string | null
}

/**
 * Resolve the Pinterest access token: the connected Pinterest SocialPlatform
 * row first (decrypting its stored token), then the legacy
 * PINTEREST_ACCESS_TOKEN env var. Throws NOT_ALLOWED when neither is present.
 */
const resolvePinterestTokenStep = createStep(
  "resolve-pinterest-access-token",
  async (_: void, { container }): Promise<StepResponse<string>> => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const platform = await socials.findPinterestPlatform?.()

    let token = ""
    if (platform?.api_config) {
      try {
        token = decryptAccessToken(platform.api_config, container)
      } catch {
        token = ""
      }
    }
    if (!token) token = process.env.PINTEREST_ACCESS_TOKEN || ""

    if (!token) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Pinterest integration not configured. Connect Pinterest in Settings → External platforms, or set PINTEREST_ACCESS_TOKEN."
      )
    }

    return new StepResponse(token)
  }
)

/**
 * Search Pinterest pins, preferring the broader partner search and falling
 * back to the authenticated user's own pins when it is unavailable.
 */
const searchPinterestPinsStep = createStep(
  "search-pinterest-pins",
  async (input: {
    token: string
    query: string
    bookmark?: string
  }): Promise<StepResponse<SearchPinterestResult>> => {
    let pins: any[] = []
    let nextBookmark: string | null = null

    try {
      const result = await searchPartnerPins(input.token, input.query, input.bookmark)
      pins = result.pins
      nextBookmark = result.bookmark
    } catch {
      try {
        const result = await searchUserPins(input.token, input.query, input.bookmark)
        pins = result.pins
        nextBookmark = result.bookmark
      } catch (e: any) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Pinterest API error: ${e.message}`
        )
      }
    }

    return new StepResponse({ pins, bookmark: nextBookmark })
  }
)

export const searchPinterestWorkflow = createWorkflow(
  "search-pinterest-workflow",
  function (input: SearchPinterestInput) {
    const token = resolvePinterestTokenStep()
    const result = searchPinterestPinsStep({
      token,
      query: input.query,
      bookmark: input.bookmark,
    })
    return new WorkflowResponse(result)
  }
)

async function searchPartnerPins(
  token: string,
  query: string,
  bookmark?: string
): Promise<{ pins: any[]; bookmark: string | null }> {
  const params = new URLSearchParams({
    term: query,
    country_code: "US",
    limit: "20",
  })
  if (bookmark) params.set("bookmark", bookmark)

  const response = await fetch(
    `https://api.pinterest.com/v5/search/partner/pins?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  if (!response.ok) {
    throw new Error(`Partner search failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    pins: data.items || [],
    bookmark: data.bookmark || null,
  }
}

async function searchUserPins(
  token: string,
  query: string,
  bookmark?: string
): Promise<{ pins: any[]; bookmark: string | null }> {
  const params = new URLSearchParams({ query })
  if (bookmark) params.set("bookmark", bookmark)

  const response = await fetch(
    `https://api.pinterest.com/v5/search/pins?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  if (!response.ok) {
    throw new Error(`User pin search failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    pins: data.items || [],
    bookmark: data.bookmark || null,
  }
}
