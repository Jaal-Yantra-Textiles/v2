import { model } from "@medusajs/framework/utils";
import Task from "./task";

export const TaskDependency = model.define("task_dependency", {
    id: model.id().primaryKey(),
    dependency_type: model.enum(['blocking', 'related', 'subtask'])
      .default('blocking'),
    metadata: model.json().nullable(),

    outgoing_task: model.belongsTo(() => Task, {
      mappedBy: "outgoing"
    }),
    incoming_task: model.belongsTo(() => Task, {
      mappedBy: "incoming",
    })
  });