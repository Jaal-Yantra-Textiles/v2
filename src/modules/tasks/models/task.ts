import { model } from "@medusajs/framework/utils";
import { TaskDependency } from "./task-dependency";


const Task = model.define("task",  {
    id: model.id().primaryKey(),
    title: model.text().searchable(),
    description: model.text().nullable(),
    
    start_date: model.dateTime(),
    end_date: model.dateTime().nullable(),
    
    status: model.enum(['pending', 'in_progress', 'completed', 'cancelled', 'accepted'])
        .default('pending'),
    
    priority: model.enum(['low', 'medium', 'high'])
        .default('medium'),
    transaction_id: model.text().nullable(),
    eventable: model.boolean().default(false),
    notifiable: model.boolean().default(false),
    message: model.text().nullable(),
    
    assigned_to: model.text().nullable(), 
    assigned_by: model.text().nullable(), 
    
    metadata: model.json().nullable(),
    completed_at: model.dateTime().nullable(),
     
    // Dependency relationships
    outgoing: model.hasMany(() => TaskDependency, { mappedBy: 'outgoing_task' }),
    incoming: model.hasMany(() => TaskDependency, { mappedBy: 'incoming_task' }),

    // Parent-child relationship
    parent_task: model.belongsTo(() => Task, {
        mappedBy: "subtasks",
    }).nullable(),

    subtasks: model.hasMany(() => Task, {
        mappedBy: "parent_task",
    }),
   
}).cascades(
    {
        delete: ['outgoing', 'incoming', 'subtasks']
    }
);

export default Task;
