import { Module } from "@medusajs/framework/utils";
import EtsysyncService from "./service";

export const ETSYSYNC_MODULE = "etsysync";

const EtsysyncModule = Module(ETSYSYNC_MODULE, {
  service: EtsysyncService,
});

export default EtsysyncModule;
