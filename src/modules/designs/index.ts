import { Module } from "@medusajs/framework/utils";
import DesignService from "./service";

export const DESIGN_MODULE = "designs";

const DesignModule = Module(DESIGN_MODULE, {
  service: DesignService,
});

export { DesignModule }

export default DesignModule
