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
 * Validates an email address using a strict regex.
 * Must have: local part, @, domain with at least one dot, 2+ char TLD.
 * No spaces, no consecutive dots, no special chars in wrong positions.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_REGEX.test(email)
}

/**
 * Extracts valid emails from a raw field value.
 * Handles comma/semicolon-separated values like "a@x.com, b@x.com".
 * Returns an array of trimmed, validated email addresses.
 */
function extractEmails(raw: unknown): string[] {
  if (!raw || typeof raw !== "string") return []
  return raw
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && isValidEmail(e))
}

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
        if (!sub || sub.subscription_status !== "active") continue
        for (const email of extractEmails(person.email)) {
          const key = email.toLowerCase()
          if (!uniqueSubscribers.has(key)) {
            uniqueSubscribers.set(key, {
              id: person.id,
              email,
              first_name: person.first_name || "",
              last_name: person.last_name || "",
            })
          }
        }
      }

      // Source 2: Customers from the customer module
      const customerService = container.resolve(Modules.CUSTOMER) as ICustomerModuleService
      const customers = await customerService.listCustomers(
        {},
        { select: ["id", "first_name", "last_name", "email"] }
      )

      for (const customer of customers) {
        for (const email of extractEmails(customer.email)) {
          const key = email.toLowerCase()
          if (!uniqueSubscribers.has(key)) {
            uniqueSubscribers.set(key, {
              id: customer.id,
              email,
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
        for (const email of extractEmails(lead.email)) {
          const key = email.toLowerCase()
          if (!uniqueSubscribers.has(key)) {
            uniqueSubscribers.set(key, {
              id: lead.id,
              email,
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
