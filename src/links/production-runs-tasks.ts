import { defineLink } from "@medusajs/framework/utils"
import ProductionRunsModule from "../modules/production_runs"
import TasksModule from "../modules/tasks"

export default defineLink(
  { linkable: ProductionRunsModule.linkable.productionRuns, isList: true },
  { linkable: TasksModule.linkable.task, isList: true, field: "tasks" }
)
