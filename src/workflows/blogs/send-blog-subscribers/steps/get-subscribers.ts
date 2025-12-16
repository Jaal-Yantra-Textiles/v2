import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { Subscriber } from "../types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const getSubscribersStepId = "get-subscribers"

/**
 * This step retrieves all persons with email addresses who will receive the blog post.
 * It uses the query mechanism for efficiency when dealing with large numbers of subscribers.
 *
 * @example
 * const subscribers = getSubscribersStep()
 */
export const getSubscribersStep = createStep(
  getSubscribersStepId,
  async (_, { container }) => {
      // Use the query mechanism similar to list-and-count-with-filter workflow
      const query:any = container.resolve(ContainerRegistrationKeys.QUERY)
      
      // Query for persons with email addresses
      const { data: persons } = await query.graph({
        entity: "person",
        fields: ["id", "first_name", "last_name", "email"],
        filters: {
          // Only get persons with a valid email
          email: {
            $ne: null
          }
        }
      })
      
      // Filter out any potential duplicates and only include persons with valid emails
      const uniqueSubscribers = new Map<string, Subscriber>()
      
      for (const person of persons) {
        // Only add if we have a valid email
        if (person.email && typeof person.email === 'string' && person.email.includes('@')) {
          uniqueSubscribers.set(person.id, {
            id: person.id,
            email: person.email,
            first_name: person.first_name || '',
            last_name: person.last_name || ''
          })
        }
      }
      
      const result = Array.from(uniqueSubscribers.values()) 
      return new StepResponse(result)
    }
)
