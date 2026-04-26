import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import MediaModule from "../modules/media"

export default defineLink(
  { linkable: DesignModule.linkable.design, isList: false },
  { linkable: MediaModule.linkable.folder, isList: false }
)
