// src/modules/person/index.ts
import { Module } from "@medusajs/framework/utils";
import PersonService from "./service";

export const PERSON_MODULE = "person";

const PersonModule = Module(PERSON_MODULE, {
  service: PersonService,
});



export { PersonModule }


export default PersonModule


