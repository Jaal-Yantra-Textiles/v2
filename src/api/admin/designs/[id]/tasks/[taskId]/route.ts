import { MedusaError } from "@medusajs/utils"
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework"
import { getDesignTaskWorkflow } from "../../../../../../workflows/designs/get-design-task"
import { updateDesignTaskWorkflow } from "../../../../../../workflows/designs/update-design-task"
import { deleteDesignTaskWorkflow } from "../../../../../../workflows/designs/delete-design-task"
import { UpdateDesignTask } from "./validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
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
  
  const { result: task } = await getDesignTaskWorkflow(req.scope).run({
      input: {
        designId: id,
        taskId
      }
  })

 
  return res.json({
    task: task[0]
  })
}

export const POST = async (req: MedusaRequest<UpdateDesignTask>, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
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

  const { result: task } = await updateDesignTaskWorkflow(req.scope).run({
    input: {
      designId: id,
      taskId,
      update: req.validatedBody
    }
  })

  return res.json({
    task
  })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
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

  await deleteDesignTaskWorkflow(req.scope).run({
    input: {
      designId: id,
      taskId
    }
  })

  return res.status(200).json({
    id: taskId,
    object: "task",
    deleted: true
  })
}
