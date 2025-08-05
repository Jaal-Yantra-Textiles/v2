import { defineLink } from "@medusajs/framework/utils";
import PersonModule from "../modules/person";
import PersonTypeModule from "../modules/persontype";


export default defineLink(
  { linkable: PersonModule.linkable.person, isList: true },
  { linkable: PersonTypeModule.linkable.personType, isList: true , field: 'person_type' }
)