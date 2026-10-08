import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PERSON_MODULE } from "../../../../../modules/person"
import type PersonService from "../../../../../modules/person/service"
import { SetPersonSubscriptionBody } from "./validators"

/**
 * A person's newsletter subscription.
 *
 * The blog newsletter mails a person only when they have an ACTIVE
 * `person_subs` row (get-subscribers.ts), and until now only the public
 * website signup form created one. Someone added in the admin was therefore
 * never mailed, with nothing on their page to say so — Cici Rotell (added
 * 2026-10-05) and Mehak Chauhan (2026-09-15) both missed the 6 and 7 October
 * sends. This is the switch.
 */
const view = (sub: any) =>
  sub
    ? {
        id: sub.id,
        subscription_status: sub.subscription_status,
        email_subscribed: sub.email_subscribed,
        subscription_type: sub.subscription_type,
        network: sub.network,
      }
    : null

async function loadPersonAndSub(req: MedusaRequest) {
  const persons = req.scope.resolve(PERSON_MODULE) as PersonService
  const person = await persons.retrievePerson(req.params.id).catch(() => null)
  if (!person) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Person ${req.params.id} not found`)
  }
  const [sub] = await persons.listPersonSubs({ person_id: req.params.id } as any, { take: 1 })
  return { persons, person: person as any, sub: sub as any }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { person, sub } = await loadPersonAndSub(req)
  res.status(200).json({
    subscription: view(sub),
    subscribed: sub?.subscription_status === "active",
    // Why a subscribed person may still not be mailed.
    blocked_by: person.metadata?.bounced ? "bounced" : person.metadata?.unsubscribed ? "unsubscribed" : null,
  })
}

export const POST = async (req: MedusaRequest<SetPersonSubscriptionBody>, res: MedusaResponse) => {
  const { subscribed } = req.validatedBody
  const { persons, person, sub } = await loadPersonAndSub(req)

  if (subscribed && !person.email) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "This person has no email address to subscribe.")
  }
  if (subscribed && person.metadata?.unsubscribed) {
    // They opted out themselves (Kit unsubscribe). Re-subscribing them from
    // the admin would mail someone who asked us to stop.
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This person unsubscribed themselves; they can only re-join through the signup form."
    )
  }

  const status = subscribed ? "active" : "inactive"
  let saved: any
  if (sub) {
    saved = await persons.updatePersonSubs({
      id: sub.id,
      subscription_status: status,
      ...(subscribed ? { email_subscribed: person.email } : {}),
    } as any)
  } else if (subscribed) {
    saved = await persons.createPersonSubs({
      person_id: person.id,
      subscription_type: "email",
      network: "jaalyantra",
      subscription_status: "active",
      email_subscribed: person.email,
    } as any)
  }

  res.status(200).json({ subscription: view(saved ?? sub ?? null), subscribed })
}
