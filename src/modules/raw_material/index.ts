import { Module } from "@medusajs/framework/utils";
import RawMaterialService from "./service";

export const RAW_MATERIAL_MODULE = "raw_materials";

const RawMaterialModule = Module(RAW_MATERIAL_MODULE, {
  service: RawMaterialService,
});

export { RawMaterialModule }

export default RawMaterialModule
