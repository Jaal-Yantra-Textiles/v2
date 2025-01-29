import { model } from "@medusajs/framework/utils";
import { TaskDependency } from "./task-dependency";
import { now } from "lodash";

const Task = model.define("task", {
    id: model.id().primaryKey(),
    title: model.text().searchable(),
    description: model.text().nullable(),
    
    start_date: model.dateTime().default(new Date()),
    end_date: model.dateTime().nullable(),
    
    status: model.enum(['pending', 'in_progress', 'completed', 'cancelled'])
        .default('pending'),
    
    priority: model.enum(['low', 'medium', 'high'])
        .default('medium'),
    
    eventable: model.boolean().default(false),
    notifiable: model.boolean().default(false),
    message: model.text().nullable(),
    
    assigned_to: model.text().nullable(), 
    assigned_by: model.text().nullable(), 
    
    metadata: model.json().nullable(),
    completed_at: model.dateTime().nullable(),

    // Parent-child relationship
    parent_task: model.belongsTo(() => Task, {
        mappedBy: "subtasks",
    }).nullable(),

    subtasks: model.hasMany(() => Task, {
        mappedBy: "parent_task",
    }),
    
    // Dependency relationships
    outgoing_dependencies: model.hasMany(() => TaskDependency, {
        mappedBy: "source_task",
    }),
    incoming_dependencies: model.hasMany(() => TaskDependency, {
        mappedBy: "target_task",
    })
});

export default Task;
