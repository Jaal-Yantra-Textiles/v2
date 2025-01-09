import { Module } from "@medusajs/framework/utils";
import WebsiteService from "./service";

export const WEBSITE_MODULE = "websites";

const WebsiteModule = Module(WEBSITE_MODULE, {
  service: WebsiteService,
});

export { WebsiteModule }

export default WebsiteModule
