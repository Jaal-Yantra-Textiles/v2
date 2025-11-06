import { MedusaError } from "@medusajs/utils"
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework"
import { getInventoryOrderTaskWorkflow } from "../../../../../../workflows/inventory_orders/get-inventory-order-task"
import { UpdateInventoryOrderTask } from "./validators"
import { updateInventoryOrderTaskWorkflow } from "../../../../../../workflows/inventory_orders/update-inventory-order-task"
import { deleteInventoryOrderTaskWorkflow } from "../../../../../../workflows/inventory_orders/delete-inventory-order-task"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
  // Validate inventory order exists
  const inventoryOrderExists = await refetchEntity({
    entity: "inventory_orders",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })
  

  if (!inventoryOrderExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order with id ${id} was not found`
    )
  }
  
  const { result: task } = await getInventoryOrderTaskWorkflow(req.scope).run({
      input: {
        inventoryOrderId: id,
        taskId
      }
  })

 
  return res.json({
    task: task
  })
}

export const POST = async (req: MedusaRequest<UpdateInventoryOrderTask>, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
  // Validate inventory order exists
  const inventoryOrderExists = await refetchEntity({
    entity: "inventory_orders",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })

  if (!inventoryOrderExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order with id ${id} was not found`
    )
  }

  const { result: task } = await updateInventoryOrderTaskWorkflow(req.scope).run({
    input: {
      inventoryOrderId: id,
      taskId,
      ...req.validatedBody
    }
  })

  return res.json({
    task: task
  })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
  // Validate inventory order exists
  const inventoryOrderExists = await refetchEntity({
    entity: "inventory_orders",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })

  if (!inventoryOrderExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order with id ${id} was not found`
    )
  }

  await deleteInventoryOrderTaskWorkflow(req.scope).run({
    input: {
      inventoryOrderId: id,
      taskId
    }
  })

  return res.status(200).json({
    id: taskId,
    object: "task",
    deleted: true
  })
}
