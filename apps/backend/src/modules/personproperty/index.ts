import { Module } from "@medusajs/framework/utils";
import PersonPropertyService from "./service";

export const PERSON_PROPERTY_MODULE = "person_property";

export default Module(PERSON_PROPERTY_MODULE, {
  service: PersonPropertyService,
});
