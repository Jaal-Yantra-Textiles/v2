import type { MedusaContainer } from "@medusajs/framework/types"
import { refreshGoogleTokenWorkflow } from "../../workflows/google/refresh-token"

/**
 * The standardized "give me a working access token" entry point that every
 * Google workflow step (Merchant sync, Ads conversion upload, Search
 * Console pulls, Business Profile updates, …) calls before hitting
 * Google's REST API.
 *
 * Internally just runs the refresh workflow with `force=false`. The step
 * itself short-circuits when the stored token still has buffer headroom,
 * so the cost on a hot path is one DB read — no Google round-trip unless
 * an actual refresh is needed.
 *
 * Centralizing this means downstream Google steps never call axios →
 * Google's token endpoint directly, never duplicate refresh logic, and
 * never write tokens in a non-standard shape.
 */
export async function getValidGoogleAccessToken(
  platformId: string,
  container: MedusaContainer
): Promise<string> {
  const { result } = await refreshGoogleTokenWorkflow(container as any).run({
    input: { platform_id: platformId, force: false },
  })
  return result.access_token
}
