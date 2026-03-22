import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { Subscriber } from "../types"
import { Modules } from "@medusajs/framework/utils"
import { PERSON_MODULE } from "../../../../modules/person"
import PersonService from "../../../../modules/person/service"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import { ICustomerModuleService } from "@medusajs/framework/types"

export const getSubscribersStepId = "get-subscribers"

/**
 * This step retrieves subscribers from three sources:
 * 1. Persons who have an active subscription (person_subs with subscription_status = "active")
 * 2. Customers from the Medusa customer module
 * 3. Meta leads from the socials module (with valid emails)
 *
 * Uses module service calls (not query.graph) for fetching relations.
 * Deduplicates by email to avoid sending the same person multiple emails.
 */
export const getSubscribersStep = createStep(
  getSubscribersStepId,
  async (_, { container }) => {
      const uniqueSubscribers = new Map<string, Subscriber>()

      // Source 1: Persons with active subscriptions
      const personService: PersonService = container.resolve(PERSON_MODULE)
      const persons = await personService.listPeople(
        {},
        { relations: ["subscribed"], select: ["id", "first_name", "last_name", "email"] }
      )

      for (const person of persons as any[]) {
        const sub = person.subscribed
        if (
          sub &&
          sub.subscription_status === "active" &&
          person.email &&
          typeof person.email === "string" &&
          person.email.includes("@")
        ) {
          uniqueSubscribers.set(person.email.toLowerCase(), {
            id: person.id,
            email: person.email,
            first_name: person.first_name || "",
            last_name: person.last_name || "",
          })
        }
      }

      // Source 2: Customers from the customer module
      const customerService = container.resolve(Modules.CUSTOMER) as ICustomerModuleService
      const customers = await customerService.listCustomers(
        {},
        { select: ["id", "first_name", "last_name", "email"] }
      )

      for (const customer of customers) {
        if (
          customer.email &&
          typeof customer.email === "string" &&
          customer.email.includes("@")
        ) {
          const key = customer.email.toLowerCase()
          if (!uniqueSubscribers.has(key)) {
            uniqueSubscribers.set(key, {
              id: customer.id,
              email: customer.email,
              first_name: customer.first_name || "",
              last_name: customer.last_name || "",
            })
          }
        }
      }

      // Source 3: Meta leads from the socials module
      const socialsService: SocialsService = container.resolve(SOCIALS_MODULE)
      const leads = await socialsService.listLeads(
        { status: { $nin: ["archived", "lost", "unqualified"] } },
        { select: ["id", "email", "first_name", "last_name", "full_name"] }
      )

      for (const lead of leads as any[]) {
        if (
          lead.email &&
          typeof lead.email === "string" &&
          lead.email.includes("@")
        ) {
          const key = lead.email.toLowerCase()
          if (!uniqueSubscribers.has(key)) {
            uniqueSubscribers.set(key, {
              id: lead.id,
              email: lead.email,
              first_name: lead.first_name || lead.full_name?.split(" ")[0] || "",
              last_name: lead.last_name || lead.full_name?.split(" ").slice(1).join(" ") || "",
            })
          }
        }
      }

      const result = Array.from(uniqueSubscribers.values())
      return new StepResponse(result)
    }
)
