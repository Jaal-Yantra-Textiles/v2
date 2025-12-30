import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"

import PersonModule from "../modules/person"

/**
 * In this case we define links for the design to persons, 
 * where we want to be able to retrieve or link n persons linked to a design
 */

export default defineLink(
  {
    linkable: DesignModule.linkable.design,
    isList: true,
  },
  PersonModule.linkable.person,
  {
    database: {
      extraColumns: {
        role: { type: "text", nullable: true },
        availability_notes: { type: "text", nullable: true },
        notification_prefs: { type: "json", nullable: true },
      },
    },
  }
)