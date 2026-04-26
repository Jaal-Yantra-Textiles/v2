
import { defineLink } from "@medusajs/framework/utils"
import TasksModule from "../modules/tasks"
import PersonModule from "../modules/person"

/**
 * In this case we define links for the task to persons, 
 * where we want to be able to retrieve a single persons linked to a task
 */

export default defineLink(
    TasksModule.linkable.task,
  {
    linkable: PersonModule.linkable.person
  },
  
)