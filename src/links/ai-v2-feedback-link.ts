import { defineLink } from "@medusajs/framework/utils"
import FeedbackModule from "../modules/feedback"
import AiVTwoModule from "../modules/aivtwo"

export default defineLink(
  {
    linkable: AiVTwoModule.linkable.aiVtwoRun,
    isList: true,
    filterable: ["id", "run_id", "status", "thread_id", "resource_id"],
  },
  {
    linkable: FeedbackModule.linkable.feedback,
    isList: true,
    filterable: ["id", "rating", "status", "submitted_at"],
  }
)
