import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SOCIAL_PROVIDER_MODULE, SocialProviderService } from "../../../../modules/social-provider"
import { initiateOauthWorkflow } from "../../../../workflows/socials/initiate-oauth"

/**
 * GET /admin/oauth/:platform
 *
 * Returns a JSON object `{ authUrl: string, code_verifier: string, state: string }`
 * where `authUrl` is the provider authorization URL that the frontend should
 * redirect the user to in order to start the OAuth flow.
 *
 * Supports Instagram, Facebook, LinkedIn, Twitter, and (placeholder) Bluesky.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const platform = req.params.platform as string | undefined

  if (!platform) {
    res.status(400).json({ message: "Missing platform parameter" })
    return
  }

  const flow = (req.query.flow as string | undefined) ?? "oauth-user"

  // Resolve provider service via social_provider module
  const socialProvider = req.scope.resolve(
    SOCIAL_PROVIDER_MODULE
  ) as SocialProviderService
  const provider = socialProvider.getProvider(platform.toLowerCase())
  if (flow === "app-only") {
    if (typeof provider.getAppBearerToken !== "function") {
      res
        .status(400)
        .json({ message: `Provider ${platform} does not support app-only flow` })
      return
    }
    try {
      const token = await provider.getAppBearerToken()
      res.status(200).json(token)
    } catch (e) {
      res.status(500).json({ message: (e as Error).message })
    }
    return
  }

  const redirectEnvKey = `${platform.toUpperCase()}_REDIRECT_URI`
  const scopeEnvKey = `${platform.toUpperCase()}_SCOPE`
  const redirectUri = process.env[redirectEnvKey] ?? ""
  const scope =
    process.env[scopeEnvKey] ?? "tweet.read tweet.write offline.access"

  const { result, errors } = await initiateOauthWorkflow(req.scope).run({
    input: {
      platform,
      redirectUri,
      scope,
    },
  })

  if (errors?.length > 0) {
    // TODO: Better error logging
    console.warn("Workflow reported errors:", errors)
    res.status(500).json({ message: "Workflow execution failed." })
    return
  }

  res.status(200).json({
    authUrl: result.authUrl,
    code_verifier: result.codeVerifier,
    state: result.state,
  })
}
