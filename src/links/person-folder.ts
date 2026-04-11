import { defineLink } from "@medusajs/framework/utils"
import PersonModule from "../modules/person"
import MediaModule from "../modules/media"

export default defineLink(
  PersonModule.linkable.person,
  {
    linkable: MediaModule.linkable.folder,
    isList: true,
    field: "folders",
  }
)
