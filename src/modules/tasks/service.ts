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

        // If template_ids are provided, merge template properties with task data
        if (template_ids?.length) {
            const templates = await this.listTaskTemplates(template_ids);
            
            // Merge template properties into task data
            templates.forEach(template => {
                taskData.priority = taskData.priority || template.priority;
                taskData.eventable = taskData.eventable ?? template.eventable;
                taskData.notifiable = taskData.notifiable ?? template.notifiable;
                taskData.message = taskData.message || template.message_template;
                
                // Merge metadata
                if (template.metadata) {
                    taskData.metadata = {
                        ...template.metadata,
                        ...taskData.metadata
                    };
                }
            });
        }

        // Create the task with merged data
        const task = await this.createTasks(taskData);
        return task;
    }
}

export default TaskService;