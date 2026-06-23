import { MedusaService } from "@medusajs/framework/utils"

import MarketingMetricSnapshot from "./models/marketing-metric-snapshot"
import MarketingOutreach from "./models/marketing-outreach"
import MarketingDraft from "./models/marketing-draft"
import MarketingManualOverride from "./models/marketing-manual-override"
import MarketingIdeasLog from "./models/marketing-ideas-log"

/**
 * marketing module service — the AI-VP-of-Marketing data foundation (#659).
 *
 * MedusaService auto-generates per-model CRUD, e.g.
 * `createMarketingMetricSnapshots` / `listAndCountMarketingMetricSnapshots`,
 * `createMarketingOutreaches`, `createMarketingDrafts`,
 * `createMarketingManualOverrides`, `createMarketingIdeasLogs`, etc.
 *
 * This module is INDEPENDENT of `ad_planning` (own module + admin menu); later
 * slices READ ad_planning/analytics via Query (query.graph), never the reverse.
 */
class MarketingService extends MedusaService({
  MarketingMetricSnapshot,
  MarketingOutreach,
  MarketingDraft,
  MarketingManualOverride,
  MarketingIdeasLog,
}) {}

export default MarketingService
