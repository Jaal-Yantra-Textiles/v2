import { MedusaService } from "@medusajs/framework/utils";
import Task from "./models/task";
import TaskTemplate, { TaskCategory } from "./models/tasktemplate";
import { TaskDependency } from "./models/task-dependency";

class TaskService extends MedusaService({
    Task,
    TaskTemplate,
    TaskCategory,
    TaskDependency
}) {
    constructor() {
        super(...arguments);
    }

    async createTaskWithTemplates(data: any) {
        console.log("TaskService.createTaskWithTemplates received data:", JSON.stringify(data, null, 2));
        
        const { template_ids, parent_task_id, dependency_type, ...taskData } = data;
        
        console.log("Extracted taskData:", JSON.stringify(taskData, null, 2));
        console.log("taskData.metadata:", JSON.stringify(taskData.metadata, null, 2));
        console.log("Template IDs:", template_ids);
        
        // Set default dates
        const now = new Date()
        taskData.start_date = taskData.start_date || now
        taskData.end_date = taskData.end_date || new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000))

        const templates = await this.listTaskTemplates({id: template_ids});
        console.log("Found templates:", JSON.stringify(templates, null, 2));
            
        // Create task data for each template
        const tasksToCreate = templates.map(template => {
            const taskToCreate = {
                ...taskData,
                title: template.name,
                description: template.description || taskData.description,
                priority: template.priority || taskData.priority,
                eventable: template.eventable ?? taskData.eventable,
                notifiable: template.notifiable ?? taskData.notifiable,
                parent_task_id: parent_task_id,
                dependency_type: dependency_type,
                start_date: taskData.start_date,
                end_date: taskData.end_date,
                metadata: {
                    ...(template.metadata || {}),
                    ...(taskData.metadata || {}),
                    template_id: template.id,
                    template_name: template.name
                }
            };
            
            console.log(`Task to create for template ${template.name}:`, JSON.stringify(taskToCreate, null, 2));
            return taskToCreate;
        });
        
        console.log("All tasks to create:", JSON.stringify(tasksToCreate, null, 2));
        
        // Create all tasks in a single call
        const createdTasks = await this.createTasks(tasksToCreate);
        console.log("Created tasks from TaskService:", JSON.stringify(createdTasks, null, 2));
        
        return createdTasks;
    }
}

export default TaskService;