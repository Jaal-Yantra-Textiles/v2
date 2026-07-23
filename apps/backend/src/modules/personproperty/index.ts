import { Module } from "@medusajs/framework/utils";
import hyperbeeDalLoader from "./loaders/hyperbee-dal";
import PersonPropertyService from "./service";

export const PERSON_PROPERTY_MODULE = "person_property";

export default Module(PERSON_PROPERTY_MODULE, {
  service: PersonPropertyService,
  // Flag-gated MikroHyperbee DAL swap; strict no-op unless
  // PERSON_PROPERTY_HYPERBEE=true (defaults to the MikroORM/Postgres DAL).
  loaders: [hyperbeeDalLoader],
});
