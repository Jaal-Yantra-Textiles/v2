// src/modules/person/index.ts
import { Module } from "@medusajs/framework/utils";
import PersonTypeService from "./service";

export const PERSON_TYPE_MODULE = "person_type";

export default Module(PERSON_TYPE_MODULE, {
  service: PersonTypeService,
});
