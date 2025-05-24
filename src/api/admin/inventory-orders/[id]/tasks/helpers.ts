import { MedusaContainer } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { TASKS_MODULE } from '../../../../../modules/tasks'

/**
 * Fetch task or tasks by ID(s) using the query.graph method
 * @param id - The ID or IDs of the task(s) to fetch
 * @param container - The Medusa container
 * @param fields - The fields to select
 * @returns The fetched task(s)
 */
export const refetchTask = async (
  id: string | string[],
  container: MedusaContainer,
  fields: string[] = []
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  
  // Prepare fields configuration
  const fieldsConfig = fields.length ? fields : []
  
  if (Array.isArray(id)) {
    // For multiple tasks
    const result = await query.graph({
      entity: TASKS_MODULE,
      filters: { id: { $in: id } },
      fields: fieldsConfig
    })
    
    return result.data
  }
  
  // For single task
  const result = await query.graph({
    entity: TASKS_MODULE,
    filters: { id },
    fields: fieldsConfig
  })
  
  return result.data.length > 0 ? result.data[0] : null
}
