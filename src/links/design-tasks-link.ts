

import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import TasksModule from "../modules/tasks"

/**
 * We link the designs to the tasks, 
 * each design can have multiple tasks linked 
 */
export default defineLink(
    DesignModule.linkable.design,
    {
      linkable: TasksModule.linkable.task,
      isList: true,
    }
  )