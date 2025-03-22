import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import PersonService from "../../../../modules/person/service"
import { PERSON_MODULE } from "../../../../modules/person"

/**
 * The persons to group.
 */
export type GroupPersonsForBatchStepInput = (
  {
    /**
     * The ID of the person to update.
     */
    id?: string
    first_name: string
    last_name: string
    email: string
    [key: string]: any
  }
)[]

export type GroupPersonsForBatchStepOutput = {
  /**
   * The persons to create.
   */
  create: {
    first_name: string
    last_name: string
    email: string
    [key: string]: any
  }[]
  /**
   * The persons to update.
   */
  update: {
    id: string
    first_name?: string
    last_name?: string
    email?: string
    [key: string]: any
  }[]
}

export const groupPersonsForBatchStepId = "group-persons-for-batch"
/**
 * This step groups persons to be created or updated.
 * 
 * @example
 * const data = groupPersonsForBatchStep([
 *   {
 *     id: "per_123",
 *     first_name: "John",
 *     last_name: "Doe",
 *     email: "john@example.com"
 *   },
 *   {
 *     first_name: "Jane",
 *     last_name: "Smith",
 *     email: "jane@example.com"
 *   }
 * ])
 */
export const groupPersonsForBatchStep = createStep(
  groupPersonsForBatchStepId,
  async (
    data: GroupPersonsForBatchStepInput,
    { container }
  ) => {
    const personService: PersonService = container.resolve(PERSON_MODULE)

    // Find existing persons by IDs
    const existingPersons = await personService.listPeople(
      {
        id: data.map((person) => person.id).filter(Boolean) as string[],
      },
      { select: ["id", "email"] }
    )
    const existingPersonsSet = new Set(existingPersons.map((p) => p.id))

    // Also check for existing persons by email for those without IDs
    const emailsToCheck = data
      .filter(person => !person.id)
      .map(person => person.email)
    
    const existingPersonsByEmail = emailsToCheck.length > 0 
      ? await personService.listPeople(
          {
            email: emailsToCheck,
          },
          { select: ["id", "email"] }
        )
      : []
    
    const emailToIdMap = new Map(
      existingPersonsByEmail.map(p => [p.email, p.id])
    )

    // Group persons for create/update operations
    const { toUpdate, toCreate } = data.reduce(
      (
        acc: {
          toUpdate: {
            id: string
            [key: string]: any
          }[]
          toCreate: {
            [key: string]: any
          }[]
        },
        person
      ) => {
        // If person has an ID and it exists, add to update list
        if (person.id && existingPersonsSet.has(person.id)) {
          const { id, ...updateData } = person
          acc.toUpdate.push({
            id,
            ...updateData
          })
          return acc
        }
        
        // If person doesn't have ID but email exists, add to update list
        if (!person.id && emailToIdMap.has(person.email)) {
          const id = emailToIdMap.get(person.email)
          const { id: _, ...updateData } = person
          acc.toUpdate.push({
            id: id!,
            ...updateData
          })
          return acc
        }

        // Otherwise, add to create list
        // Remove any ID for creating new persons
        const { id, ...createData } = person
        acc.toCreate.push(createData)
        return acc
      },
      { toUpdate: [], toCreate: [] }
    )

    return new StepResponse(
      { create: toCreate, update: toUpdate } as GroupPersonsForBatchStepOutput,
    )
  }
)
