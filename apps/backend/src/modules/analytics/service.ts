import { MedusaService } from "@medusajs/framework/utils";
import AnalyticsEvent from "./models/analytics-event";
import AnalyticsSession from "./models/analytics-session";
import AnalyticsDailyStats from "./models/analytics-daily-stats";

class AnalyticsService extends MedusaService({
  AnalyticsEvent,
  AnalyticsSession,
  AnalyticsDailyStats,
}) {
  constructor() {
    super(...arguments)
  }
}

export default AnalyticsService;
