import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { publishSocialPostWorkflow } from "../../../../../workflows/socials/publish-post"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import FacebookService from "../../../../../modules/social-provider/facebook-service"

interface PublishByPostIdBody {
  post_id: string
  page_id?: string
}

/**
 * @deprecated Use POST /admin/social-posts/:id/publish instead
 * This endpoint will be removed in a future version
 */
export const POST = async (
  req: MedusaRequest<PublishByPostIdBody>,
  res: MedusaResponse
) => {
  const { post_id, page_id } = req.body || {}

  if (!post_id) {
    res.status(400).json({ message: "Missing post_id" })
    return
  }

  console.warn(
    "[DEPRECATED] POST /admin/socials/facebook/pages is deprecated. " +
    "Use POST /admin/social-posts/:id/publish instead."
  )

  const { result, errors } = await publishSocialPostWorkflow(req.scope).run({
    input: { post_id, page_id },
  })

  if (errors?.length) {
    res.status(500).json({ message: "Publish workflow failed", errors })
    return
  }

  res.status(200).json({ 
    post: result,
    _deprecated: "This endpoint is deprecated. Use POST /admin/social-posts/:id/publish instead."
  })
}

/**
 * @deprecated This endpoint is no longer used. Facebook pages are cached in 
 * platform.api_config.metadata.pages during OAuth callback. Use that cached data instead.
 * This endpoint will be removed in a future version.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const platform_id = (req.query?.platform_id as string) || ""
  if (!platform_id) {
    res.status(400).json({ message: "Missing platform_id" })
    return
  }

  console.warn(
    "[DEPRECATED] GET /admin/socials/facebook/pages is deprecated. " +
    "Use platform.api_config.metadata.pages from the social platform instead."
  )

  const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
  const [platform] = await socials.listSocialPlatforms({ id: platform_id })
  if (!platform) {
    res.status(404).json({ message: `SocialPlatform ${platform_id} not found` })
    return
  }

  // Use user_access_token for listing pages (Page Access Token doesn't have permission)
  const userAccessToken = (platform as any).api_config?.user_access_token as string | undefined
  const fallbackToken = (platform as any).api_config?.access_token as string | undefined
  const token = userAccessToken || fallbackToken
  
  if (!token) {
    res.status(400).json({ message: "No user access token on platform.api_config" })
    return
  }

  const fb = new FacebookService()
  const pages = await fb.listManagedPages(token)
  res.status(200).json({ 
    pages,
    _deprecated: "This endpoint is deprecated. Use platform.api_config.metadata.pages instead."
  })
}