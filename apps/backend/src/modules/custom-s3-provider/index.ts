import { Module } from "@medusajs/framework/utils";
import S3ListingServiceModule from "./service";

export const S3_LISTING_MODULE = "s3_custom";
export { S3ListingServiceModule };

export default Module(S3_LISTING_MODULE, {
  service: S3ListingServiceModule,  
});
