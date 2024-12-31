// src/modules/person/index.ts
import { Module } from "@medusajs/framework/utils";
import PersonService from "./service";

export const PERSON_MODULE = "person";

export default Module(PERSON_MODULE, {
  service: PersonService,
});
