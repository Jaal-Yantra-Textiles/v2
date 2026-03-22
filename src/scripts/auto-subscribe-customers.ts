import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ICustomerModuleService } from "@medusajs/framework/types"
import { PERSON_MODULE } from "../modules/person"
import PersonService from "../modules/person/service"

/**
 * Auto-subscribe existing customers to the blog newsletter.
 *
 * For each customer with a valid email:
 * 1. Check if a person with that email already exists
 * 2. If not, create a person record
 * 3. Check if the person already has an active subscription
 * 4. If not, create a person_subs record with subscription_status = "active"
 *
 * Run: npx medusa exec ./src/scripts/auto-subscribe-customers.ts
 */
export default async function autoSubscribeCustomers({ container }: ExecArgs) {
  const customerService = container.resolve(Modules.CUSTOMER) as ICustomerModuleService
  const personService: PersonService = container.resolve(PERSON_MODULE)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any

  logger.info("Starting auto-subscribe customers to blog newsletter...")

  // Fetch all customers with emails using service call
  const customers = await customerService.listCustomers(
    {},
    { select: ["id", "first_name", "last_name", "email"] }
  )

  let created = 0
  let alreadySubscribed = 0
  let failed = 0

  for (const customer of customers) {
    if (!customer.email || !customer.email.includes("@")) {
      continue
    }

    try {
      // Check if a person with this email already exists
      const [existingPeople] = await personService.listAndCountPeople(
        { email: customer.email },
        { take: 1 }
      )

      let personId: string

      if (existingPeople.length > 0) {
        personId = existingPeople[0].id

        // Check if they already have an active subscription
        const people = await personService.listPeople(
          { id: personId },
          { relations: ["subscribed"], take: 1 }
        ) as any[]

        const sub = people[0]?.subscribed
        if (sub && sub.subscription_status === "active") {
          alreadySubscribed++
          continue
        }
      } else {
        // Create a new person from the customer data
        const person = await personService.createPeople({
          first_name: customer.first_name || "",
          last_name: customer.last_name || "",
          email: customer.email,
        })
        personId = person.id
      }

      // Create the subscription
      await personService.createPersonSubs({
        person_id: personId,
        subscription_type: "email",
        network: "jaalyantra",
        subscription_status: "active",
        email_subscribed: customer.email,
      })

      created++
      logger.info(`Subscribed customer ${customer.email}`)
    } catch (error) {
      failed++
      logger.warn(
        `Failed to subscribe customer ${customer.email}: ${error.message}`
      )
    }
  }

  logger.info(
    `Auto-subscribe complete: ${created} new subscriptions, ${alreadySubscribed} already subscribed, ${failed} failed`
  )
}
