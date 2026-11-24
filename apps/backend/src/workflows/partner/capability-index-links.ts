/**
 * #2596 — the partner ↔ capability links the index engine reads.
 *
 * Every path that creates a sample or rate must also write its link, or the
 * row exists but no search finds it. The index ignores read-only links
 * (`@medusajs/index` build-config skips `isReadOnlyLink`), so `partner_id` on
 * the row is not enough on its own.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PARTNER_MODULE } from "../../modules/partner"
import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"

type Kind = "sample" | "rate"

const KEY: Record<Kind, string> = {
  sample: "partner_capability_sample_id",
  rate: "partner_capability_rate_id",
}

const defs = (partnerId: string, kind: Kind, ids: string[]) =>
  ids.map((id) => ({
    [PARTNER_MODULE]: { partner_id: partnerId },
    [PARTNER_CAPABILITY_MODULE]: { [KEY[kind]]: id },
  }))

export const linkCapabilityRows = async (
  container: { resolve: (k: string) => any },
  partnerId: string,
  kind: Kind,
  ids: string[]
) => {
  if (!ids.length) return
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  await link.create(defs(partnerId, kind, ids))
}

export const unlinkCapabilityRows = async (
  container: { resolve: (k: string) => any },
  partnerId: string,
  kind: Kind,
  ids: string[]
) => {
  if (!ids.length) return
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  await link.dismiss(defs(partnerId, kind, ids))
}
