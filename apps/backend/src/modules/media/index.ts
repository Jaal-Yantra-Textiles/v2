import { Module } from "@medusajs/framework/utils";
import MediaService from "./service";

export const MEDIA_MODULE = "media";

const MediaModule = Module(MEDIA_MODULE, {
  service: MediaService,
});

export default MediaModule;
