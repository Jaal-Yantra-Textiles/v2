import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import TaskModule from "../modules/tasks"

export default defineLink(
    { linkable: PartnerModule.linkable.partner, isList: true, filterable: ["id", "name", "handle", "status"] },
    { linkable: TaskModule.linkable.task, isList: true , filterable: ["id", "title", "status", "priority"]}
)
