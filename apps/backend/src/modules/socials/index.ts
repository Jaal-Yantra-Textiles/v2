import { Module } from "@medusajs/framework/utils";
import SocialsService from "./service";

export const SOCIALS_MODULE = "socials";

const SocialsModule = Module(SOCIALS_MODULE, {
  service: SocialsService,
});

export default SocialsModule;
