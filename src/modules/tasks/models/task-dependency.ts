import { model } from "@medusajs/framework/utils";
import Task from "./task";

export const TaskDependency = model.define("task_dependency", {
    id: model.id().primaryKey(),
    dependency_type: model.enum(['blocking', 'related', 'subtask'])
      .default('blocking'),
    metadata: model.json().nullable(),
    source_task: model.belongsTo(() => Task, {
      mappedBy: "outgoing_dependencies",
    }),
    target_task: model.belongsTo(() => Task, {
      mappedBy: "incoming_dependencies",
    })
  });