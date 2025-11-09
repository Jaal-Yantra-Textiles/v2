import { Module } from "@medusajs/framework/utils";
import AnalyticsService from "./service";

export const ANALYTICS_MODULE = "custom_analytics";

const AnalyticsModule = Module(ANALYTICS_MODULE, {
  service: AnalyticsService,
});

export default AnalyticsModule;
