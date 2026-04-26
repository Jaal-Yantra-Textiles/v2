// src/modules/person/index.ts
import { Module } from "@medusajs/framework/utils";
import PersonTypeService from "./service";

export const PERSON_TYPE_MODULE = "person_type";

 const PersonTypeModule =  Module(PERSON_TYPE_MODULE, {
  service: PersonTypeService,
});

export { PersonTypeModule }
export default PersonTypeModule
