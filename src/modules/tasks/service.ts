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
        const { template_ids, parent_task_id, dependency_type, ...taskData } = data;
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
        }))
        
        // Create all tasks in a single call
        return await this.createTasks(tasksToCreate)
    }
}

export default TaskService;