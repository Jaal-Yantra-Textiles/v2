import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_CAPABILITY_MODULE } from "../../partner_capability"

export type BriefChoiceRef = {
  partner_id: string
  rate_id?: string | null
  sample_ids?: string[] | null
}

/**
 * 🔴 A choice's rate and samples must belong to THAT choice's partner. The
 * buyer sees the partner's name beside the price and the photos; a rate id
 * pasted from another workshop would show one workshop's price under
 * another's name.
 *
 * Pure: returns the first problem, or null.
 */
export const briefChoiceOwnershipError = (
  choices: BriefChoiceRef[],
  rateOwner: Map<string, string>,
  sampleOwner: Map<string, string>
): string | null => {
  for (const c of choices) {
    if (c.rate_id && rateOwner.get(c.rate_id) !== c.partner_id) {
      return rateOwner.has(c.rate_id)
        ? `Rate ${c.rate_id} belongs to another partner, not ${c.partner_id}`
        : `Rate ${c.rate_id} not found`
    }
    for (const sid of c.sample_ids ?? []) {
      if (sampleOwner.get(sid) !== c.partner_id) {
        return sampleOwner.has(sid)
          ? `Sample ${sid} belongs to another partner, not ${c.partner_id}`
          : `Sample ${sid} not found`
      }
    }
  }
  return null
}

/** Loads the rates and samples the choices name, and throws on a mismatch. */
export const assertBriefChoiceOwnership = async (container: any, choices: BriefChoiceRef[]) => {
  const capability: any = container.resolve(PARTNER_CAPABILITY_MODULE)
  const rateIds = [...new Set(choices.map((c) => c.rate_id).filter((x): x is string => !!x))]
  const sampleIds = [...new Set(choices.flatMap((c) => c.sample_ids ?? []))]
  // Filter by id only when there are ids — an empty list must not become "no filter".
  const rates = rateIds.length ? await capability.listPartnerCapabilityRates({ id: rateIds }) : []
  const samples = sampleIds.length ? await capability.listPartnerCapabilitySamples({ id: sampleIds }) : []
  const error = briefChoiceOwnershipError(
    choices,
    new Map<string, string>(rates.map((r: any) => [r.id, r.partner_id])),
    new Map<string, string>(samples.map((s: any) => [s.id, s.partner_id]))
  )
  if (error) throw new MedusaError(MedusaError.Types.INVALID_DATA, error)
}
