import { defineLink } from "@medusajs/framework/utils";
import PersonModule from "../modules/person";
import PersonPropertyModule from "../modules/personproperty";

// One Person has one profile-properties record (isList: false).
export default defineLink(
  PersonModule.linkable.person,
  {
    linkable: PersonPropertyModule.linkable.personProperty,
    field: "properties",
  }
);
