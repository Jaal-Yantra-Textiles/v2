import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PERSON_MODULE } from "../modules/person"
import PersonService from "../modules/person/service"

/**
 * Auto-subscribe existing persons who have emails to the blog newsletter.
 *
 * For each person with a valid email:
 * 1. Check if they already have a subscription record
 * 2. If they have an active subscription, skip
 * 3. If they have an inactive subscription, update it to active
 * 4. If they have no subscription, create one with subscription_status = "active"
 *
 * Run: npx medusa exec ./src/scripts/auto-subscribe-persons.ts
 */
export default async function autoSubscribePersons({ container }: ExecArgs) {
  const personService: PersonService = container.resolve(PERSON_MODULE)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any

  logger.info("Starting auto-subscribe persons to blog newsletter...")

  // Fetch all persons with their subscription relation
  const persons = await personService.listPeople(
    {},
    { relations: ["subscribed"], select: ["id", "first_name", "last_name", "email"] }
  ) as any[]

  let created = 0
  let alreadySubscribed = 0
  let reactivated = 0
  let skippedNoEmail = 0
  let failed = 0

  for (const person of persons) {
    if (!person.email || !person.email.includes("@")) {
      skippedNoEmail++
      continue
    }

    try {
      const sub = person.subscribed

      if (sub) {
        if (sub.subscription_status === "active") {
          alreadySubscribed++
          continue
        }

        // Reactivate inactive subscription
        await personService.updatePersonSubs({
          id: sub.id,
          subscription_status: "active",
        })
        reactivated++
        logger.info(`Reactivated subscription for ${person.email}`)
      } else {
        // Create new subscription
        await personService.createPersonSubs({
          person_id: person.id,
          subscription_type: "email",
          network: "jaalyantra",
          subscription_status: "active",
          email_subscribed: person.email,
        })
        created++
        logger.info(`Created subscription for ${person.email}`)
      }
    } catch (error) {
      failed++
      logger.warn(
        `Failed to subscribe person ${person.email}: ${error.message}`
      )
    }
  }

  logger.info(
    [
      "Auto-subscribe persons complete:",
      `${created} new subscriptions`,
      `${reactivated} reactivated`,
      `${alreadySubscribed} already subscribed`,
      `${skippedNoEmail} skipped (no email)`,
      `${failed} failed`,
    ].join(", ")
  )
}
