import { defineLink } from "@medusajs/framework/utils";
import PersonModule from "src/modules/person";
import PersonTypeModule from "src/modules/persontype";


export default defineLink(
  {
    linkable: PersonModule.linkable.person,
    isList: true,
  },
  PersonTypeModule.linkable.personType
)