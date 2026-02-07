import { Module } from "@medusajs/framework/utils";
import AdPlanningService from "./service";

export const AD_PLANNING_MODULE = "ad_planning";

const AdPlanningModule = Module(AD_PLANNING_MODULE, {
  service: AdPlanningService,
});

export default AdPlanningModule;
