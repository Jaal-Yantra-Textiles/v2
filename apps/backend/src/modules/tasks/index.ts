// src/modules/tasks/index.ts
import { Module } from "@medusajs/framework/utils";
import TaskService from "./service";

export const TASKS_MODULE = "tasks";

const TasksModule = Module(TASKS_MODULE, {
    service: TaskService,
});

export { TasksModule };
export default TasksModule;
