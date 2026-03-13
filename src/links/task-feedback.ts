import { defineLink } from "@medusajs/framework/utils"
import TaskModule from "../modules/tasks"
import FeedbackModule from "../modules/feedback"

export default defineLink(
    { linkable: TaskModule.linkable.task, isList: true },
    { linkable: FeedbackModule.linkable.feedback, isList: true }
)
