import { MedusaService } from "@medusajs/framework/utils";
import Task from "./models/task";
import TaskTemplate, { TaskCategory } from "./models/tasktemplate";

class TaskService extends MedusaService({
    Task,
    TaskTemplate,
    TaskCategory,
}) {
    constructor() {
        super(...arguments);
    }

    async createTaskWithTemplates(data: any) {
        const { template_ids, ...taskData } = data;
        // Set default dates
        const now = new Date()
        taskData.start_date = taskData.start_date || now
        taskData.end_date = taskData.end_date || new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000))

        const templates = await this.listTaskTemplates({id: template_ids});
            
        // Create task data for each template
        const tasksToCreate = templates.map(template => ({
            ...taskData,
            title: template.name,
            description: template.description || taskData.description,
            priority: template.priority || taskData.priority,
            eventable: template.eventable ?? taskData.eventable,
            notifiable: template.notifiable ?? taskData.notifiable,
            metadata: {
                ...(template.metadata || {}),
                ...(taskData.metadata || {}),
                template_id: template.id,
                template_name: template.name
            }
        }))
        // Create all tasks in a single call
        return await this.createTasks(tasksToCreate)
    }
}

export default TaskService;