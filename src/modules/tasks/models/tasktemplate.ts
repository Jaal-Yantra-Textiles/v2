import { model } from "@medusajs/framework/utils";

const TaskCategory = model.define("task_category", {
    id: model.id().primaryKey(),
    name: model.text().searchable(),
    description: model.text().nullable(),
    metadata: model.json().nullable(),
});

const TaskTemplate = model.define("task_template", {
    id: model.id().primaryKey(),
    name: model.text().searchable(),
    description: model.text(),
    
    category: model.belongsTo(() => TaskCategory).nullable(),
    estimated_duration: model.number().nullable(), // in minutes
    
    priority: model.enum(['low', 'medium', 'high'])
        .default('medium'),
    
    required_fields: model.json().nullable(), // Array of required field configurations

    // Default cost for this type of work
    estimated_cost: model.float().nullable(),
    cost_currency: model.text().nullable(),
    
    eventable: model.boolean().default(false),
    notifiable: model.boolean().default(false),
    message_template: model.text().nullable(),
    
    metadata: model.json().nullable(),
});

export { TaskCategory };
export default TaskTemplate;
