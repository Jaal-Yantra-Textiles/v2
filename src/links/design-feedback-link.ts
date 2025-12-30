import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import FeedbackModule from "../modules/feedback"

export default defineLink(
  { linkable: DesignModule.linkable.design, isList: true },
  { linkable: FeedbackModule.linkable.feedback, isList: true },
  {
    database: {
      extraColumns: {
        status: { type: "text", nullable: true },
        notes: { type: "text", nullable: true },
        attachments: { type: "json", nullable: true },
        metadata: { type: "json", nullable: true },
      },
    },
  }
)
