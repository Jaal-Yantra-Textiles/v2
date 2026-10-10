import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import {
  listPartnersWithStorefrontDomain,
  verifyPartnerStorefrontDomain,
} from "../workflows/stores/verify-storefront-domain"

/**
 * Hourly: bring every provisioned partner storefront domain to verified.
 *
 * A fresh `*.cicilabel.com` domain needs a `_vercel` TXT and a Vercel verify
 * that can only succeed after DNS propagates — so provisioning alone can
 * leave a storefront down with nobody told. This retries until it sticks.
 * Verified domains cost one read each and change nothing.
 */
export default async function verifyStorefrontDomains(container: MedusaContainer) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  let partners: any[] = []
  try {
    partners = await listPartnersWithStorefrontDomain(container)
  } catch (e: any) {
    logger.warn(`[storefront-domains] could not list partners: ${e?.message ?? e}`)
    return
  }

  let unverified = 0
  for (const partner of partners) {
    try {
      const check = await verifyPartnerStorefrontDomain(container, partner)
      if (!check.verified && !check.skipped) {
        unverified++
        logger.warn(
          `[storefront-domains] ${check.domain} (partner ${partner.id}) NOT verified — txt: ${JSON.stringify(
            check.txt
          )}${check.error ? `; ${check.error}` : ""}`
        )
      }
    } catch (e: any) {
      logger.warn(`[storefront-domains] ${partner.id}: ${e?.message ?? e}`)
    }
  }
  logger.info(
    `[storefront-domains] checked ${partners.length} storefront domain(s); ${unverified} not verified`
  )
}

export const config = {
  name: "verify-storefront-domains",
  schedule: "17 * * * *",
}
