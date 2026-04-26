import { createTaskWorkflow } from "../tasks/create-task"
import { TASKS_MODULE } from "../../modules/tasks"
import TaskService from "../../modules/tasks/service"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

type TaskDependencyInput = {
    outgoing_task_id: string
    incoming_task_id: string
    dependency_type: 'blocking' | 'related' | 'subtask'
    metadata?: Record<string, any>
}

// Helper function to check for circular dependencies
async function hasCircularDependency(
    taskService: TaskService,
    outgoingTaskId: string,
    incomingTaskId: string,
    visited = new Set<string>()
): Promise<boolean> {
    // If we've seen this task before, we have a cycle
    if (visited.has(incomingTaskId)) {
        return true
    }

    // If the incoming task is the same as our original outgoing task, we have a cycle
    if (incomingTaskId === outgoingTaskId) {
        return true
    }

    visited.add(incomingTaskId)

    // Get all outgoing dependencies of the incoming task
    const dependencies = await taskService.listTaskDependencies({
        outgoing_task_id: incomingTaskId
    })

    // Recursively check each dependency
    for (const dep of dependencies) {
        if (await hasCircularDependency(taskService, outgoingTaskId, dep.incoming_task_id, visited)) {
            return true
        }
    }

    return false
}

// Helper function to validate and create dependency
async function createValidatedDependency(
    taskService: TaskService,
    dependency: TaskDependencyInput
) {
    const { outgoing_task_id, incoming_task_id } = dependency

    // Check for circular dependency
    const hasCircular = await hasCircularDependency(taskService, outgoing_task_id, incoming_task_id)
    if (hasCircular) {
        const err = new Error(
            `Cannot create dependency: Circular dependency detected between tasks ${outgoing_task_id} and ${incoming_task_id}`
        )
        throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            err.message
       )
    }

    // Create the dependency if no circular dependency found
    return await taskService.createTaskDependencies(dependency)
}

createTaskWorkflow.hooks.taskCreated(
    async (
        data: {
            task: {
                withParent: any
                withTemplates: any
                withoutTemplates: any
                input: any
                inputWithTemplateIds: any
            }
        },
        { container }
    ) => {
        
        const taskService: TaskService = container.resolve(TASKS_MODULE)
        const { task } = data

        try {
            // Handle parent-child relationships as dependencies
            if (task.withParent) {
                const parentTask = task.withParent.parent[0] || task.withParent.parent
                const childTasks = task.withParent.children || []
                console.log(childTasks, task, task.withParent.parent)
                // Create dependencies for each child task
                for (const childTask of childTasks) {
                    await createValidatedDependency(taskService, {
                        outgoing_task_id: parentTask.id,
                        incoming_task_id: childTask.id,
                        dependency_type: task.input.dependency_type || 'subtask',
                        metadata: {
                            parent_child: true,
                            ...task.input.metadata
                        }
                    })
                }
            }
           

            // Handle template-based tasks dependencies
            if (task.withTemplates?.length > 0) {
                // Create dependencies between template-based tasks in sequence
                for (let i = 0; i < task.withTemplates.length - 1; i++) {
                    await createValidatedDependency(taskService, {
                        outgoing_task_id: task.withTemplates[i].id,
                        incoming_task_id: task.withTemplates[i + 1].id,
                        dependency_type: 'blocking',
                        metadata: {
                            template_based: true,
                            template_ids: task.inputWithTemplateIds.template_ids
                        }
                    })
                }
            }

            // Handle explicit dependencies from input
            if (task.input.dependencies) {
                const { incoming, outgoing } = task.input.dependencies

                // First, validate all dependencies to catch circular dependencies early
                if (incoming?.length > 0) {
                    for (const dep of incoming) {
                        const hasCircular = await hasCircularDependency(
                            taskService,
                            dep.task_id,
                            task.withoutTemplates.id
                        )
                        if (hasCircular) {
                            const err = new Error(
                                `Cannot create dependency: Circular dependency detected between tasks ${dep.task_id} and ${task.withoutTemplates.id}`
                            )
                           throw new MedusaError(
                                MedusaError.Types.NOT_ALLOWED,
                                err.message
                           )
                        }
                    }
                }

                if (outgoing?.length > 0) {
                    for (const dep of outgoing) {
                        const hasCircular = await hasCircularDependency(
                            taskService,
                            task.withoutTemplates.id,
                            dep.task_id
                        )
                        if (hasCircular) {
                            const err = new Error(
                                `Cannot create dependency: Circular dependency detected between tasks ${task.withoutTemplates.id} and ${dep.task_id}`
                            )
                            throw new MedusaError(
                                MedusaError.Types.NOT_ALLOWED,
                                err.message
                           )
                        }
                    }
                }

                // If no circular dependencies found, create the dependencies
                if (incoming?.length > 0) {
                    for (const dep of incoming) {
                        await createValidatedDependency(taskService, {
                            outgoing_task_id: dep.task_id,
                            incoming_task_id: task.withoutTemplates.id,
                            dependency_type: dep.dependency_type,
                            metadata: dep.metadata
                        })
                    }
                }

                if (outgoing?.length > 0) {
                    for (const dep of outgoing) {
                        await createValidatedDependency(taskService, {
                            outgoing_task_id: task.withoutTemplates.id,
                            incoming_task_id: dep.task_id,
                            dependency_type: dep.dependency_type,
                            metadata: dep.metadata
                        })
                    }
                }
            }

            return new StepResponse(true)
        } catch (error) {
            // Log the error and rethrow
            console.error("Error creating task dependencies:", error)
            throw error
        }
    }
)
