import { model } from "@medusajs/framework/utils";

const Task = model.define("task", {
    id: model.id().primaryKey(),
    title: model.text().searchable(),
    description: model.text().nullable(),
    
    start_date: model.dateTime(),
    end_date: model.dateTime(),
    
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
});

export default Task;
