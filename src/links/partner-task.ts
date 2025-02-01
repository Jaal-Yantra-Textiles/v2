import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import TaskModule from "../modules/tasks"

export default defineLink(
    PartnerModule.linkable.partner,
    {
        linkable: TaskModule.linkable.task,
        isList: true,
        field: 'tasks'
    }
)
