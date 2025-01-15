import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"



export const refetchTask = async (
  ids: string[],
  container: MedusaContainer,
  fields:  ["*"]
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: tasks } = await query.graph({
    entity: 'task',
    filters: { id: ids },
    fields: [
      "*",
     "subtasks.*",
    ],
  })

  

  if (!tasks?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Task with id "${ids}" not found`
    )
  }

  return tasks
}