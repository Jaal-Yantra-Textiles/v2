import { MedusaError } from "@medusajs/utils"
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework"
import { createTasksFromTemplatesWorkflow } from "../../../../../workflows/designs/create-tasks-from-templates"
import { getDesignTasksWorkflow } from "../../../../../workflows/designs/get-design-tasks"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  
  // Validate design exists
  const designExists = await refetchEntity(
    "design",
    id,
    req.scope,
    ["id"]
  )

  if (!designExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id ${id} was not found`
    )
  }

  const { result: tasks } = await getDesignTasksWorkflow(req.scope).run({
    input: {
      designId: id
    }
  })


  return res.status(200).json({
    tasks: tasks[0].tasks
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  
  // Validate design exists
  const designExists = await refetchEntity(
    "design",
    id,
    req.scope,
    ["id"]
  )
  
  if (!designExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id ${id} was not found`
    )
  }

  // Validate request body and remove duplicates
  const originalBody = req.validatedBody as { template_names?: string[] }
  const originalLength = originalBody.template_names?.length ?? 0
  
  // Explicitly remove duplicates using Set
  const uniqueTemplateNames = [...new Set(originalBody.template_names)]

  const { result: list } = await createTasksFromTemplatesWorkflow(req.scope).run({
    input: {
      designId: id,
      templateNames: uniqueTemplateNames
    }
  })
  
  return res.status(200).json({
    taskLinks: {
      list: list[1],
      count: list[1].length
    },
    message: `Design ${id} successfully created ${list[1].length} tasks from templates${originalLength > uniqueTemplateNames.length ? ' (duplicate template names were removed)' : ''}`,
    originalCount: originalLength,
    processedCount: uniqueTemplateNames.length
  })
}