import { defineLink } from "@medusajs/framework/utils"
import FeedbackModule from "../modules/feedback"
import AiVTwoModule from "../modules/aivtwo"

export default defineLink(
  {
    linkable: AiVTwoModule.linkable.aiVtwoRun,
    isList: true,
  },
  {
    linkable: FeedbackModule.linkable.feedback,
    isList: true,
  }
)
