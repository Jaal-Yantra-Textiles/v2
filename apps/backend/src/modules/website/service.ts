import { MedusaService } from "@medusajs/framework/utils";
import Website from "./models/website";
import WebsiteDomain from "./models/website-domain";
import Page from "./models/page";
import  Block  from "./models/blocks";
import SubscriptionSendLog from "./models/subscription-send-log";

class WebsiteService extends MedusaService({
  Website,
  WebsiteDomain,
  Page,
  Block,
  SubscriptionSendLog,
}) {
  constructor() {
    super(...arguments)
  }

  /**
   * Ensure a primary WebsiteDomain row exists for the given website + domain.
   * Idempotent — safe to call after website creation or domain rename.
   */
  async ensurePrimaryWebsiteDomain(websiteId: string, domain: string) {
    const self = this as any
    const [existing] = await self.listAndCountWebsiteDomains(
      { website_id: websiteId, is_primary: true },
      { take: 1 }
    )
    const current = existing?.[0]
    if (current) {
      if (current.domain !== domain) {
        await self.updateWebsiteDomains({ id: current.id, domain })
      }
      return current
    }

    // Also reconcile the case where the same domain already exists as a non-primary alias
    const [byDomain] = await self.listAndCountWebsiteDomains(
      { domain, website_id: websiteId },
      { take: 1 }
    )
    if (byDomain?.length) {
      await self.updateWebsiteDomains({ id: byDomain[0].id, is_primary: true })
      return byDomain[0]
    }

    return self.createWebsiteDomains({
      domain,
      is_primary: true,
      website_id: websiteId,
    })
  }
}

export default WebsiteService;
