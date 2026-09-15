import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  createStockLocationsWorkflow,
  deleteStockLocationsWorkflow,
} from "@medusajs/medusa/core-flows"
import type { Link } from "@medusajs/framework/modules-sdk"

import { PARTNER_MODULE } from "../../modules/partner"
import { autoLinkFulfillmentProvidersStep } from "../stores/create-store-with-defaults"

/**
 * Give a partner a warehouse — and nothing else. (#2061)
 *
 * WHY THIS EXISTS
 * ---------------
 * A "store" bundles two unrelated jobs: a STOREFRONT (publishable key, domain,
 * sales channel, region) and a WAREHOUSE (stock location, carrier
 * registrations). Until now they could only be obtained together, so a partner
 * who produces but never sells direct had to mint an entire storefront just to
 * have somewhere to put goods.
 *
 * That is not hypothetical. Prince Tailors needed a warehouse so 7 finished
 * garments could be banked; the only route was a full store, so a tailoring
 * business now owns a publishable key and a storefront it will never use.
 *
 * Surveyed on prod 2026-09-15: **12 of the 14 partners who own a store are
 * `workspace_type: "manufacturer"`**, not sellers. The bundle is backwards for
 * most of the partner base.
 *
 * #2053 already shipped the typed `partner → stock_location` link, so a partner
 * can HOLD a warehouse with no store. What was missing was a way to CREATE one.
 * This is that, and deliberately nothing more: no store, no sales channel, no
 * region, no publishable key, no domain.
 *
 * NO GATE HERE, DELIBERATELY
 * --------------------------
 * Holding goods is not a sales decision, so this path is open to any partner.
 * Gating the STOREFRONT half is a separate question that cannot be answered
 * yet: `workspace_type` would block 12 of the 14 stores that exist, and
 * `metadata.use_type` is null for 25 of 30 partners. See #2061 / #2029.
 */

export type CreatePartnerWarehouseInput = {
  partner_id: string
  name: string
  address: {
    address_1: string
    address_2?: string | null
    city?: string | null
    country_code: string
    province?: string | null
    postal_code?: string | null
    phone?: string | null
    company?: string | null
  }
  metadata?: Record<string, unknown> | null
  /** Drives which carriers are auto-registered. Defaults to the address country. */
  currency_code?: string
}

/**
 * 🔴 REFUSE to give a partner a SECOND warehouse.
 *
 * This guard is the whole reason this workflow is not three lines.
 *
 * `pickPartnerLocation` (lib/partner-location.ts) returns a location only when
 * the partner is linked to exactly ONE. Linked to two, it returns
 * `ambiguous_linked_locations` rather than guessing — correctly, because `[0]`
 * on a two-warehouse partner banks goods in a city they are not in.
 *
 * But `stockFinishedGoodsStep` THROWS when it has no location. So quietly
 * adding a second warehouse to a partner who already has one does not give them
 * a nice extra warehouse: it stops every production run of theirs from
 * completing. A convenience route would have turned this fix into an outage for
 * exactly the partners who use it most.
 *
 * Multi-warehouse partners are a real need, but they require the resolver to be
 * able to CHOOSE (a primary flag, or a per-run location). Until that exists,
 * refusing loudly and naming the warehouse they already have is the honest
 * answer.
 */
export const guardSingleWarehouseStep = createStep(
  "guard-partner-single-warehouse",
  async (input: { partner_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "name", "stock_locations.id", "stock_locations.name"],
      filters: { id: input.partner_id },
    })

    const partner = partners?.[0]
    if (!partner) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner ${input.partner_id} not found.`
      )
    }

    const existing = (partner.stock_locations || []).filter((l: any) => l?.id)
    if (existing.length) {
      const named = existing
        .map((l: any) => `${l.name || "(unnamed)"} (${l.id})`)
        .join(", ")
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Partner ${partner.name || input.partner_id} already has a warehouse: ${named}. ` +
          `Creating a second one would make their goods location ambiguous, and every ` +
          `production run they complete would then fail rather than bank stock. ` +
          `Use the existing warehouse, or unlink it first.`
      )
    }

    return new StepResponse({ ok: true })
  }
)

/** Create the stock location, and remove it again if anything downstream fails. */
const createWarehouseLocationStep = createStep(
  "create-partner-warehouse-location",
  async (input: CreatePartnerWarehouseInput, { container }) => {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: input.name,
            address: input.address as any,
            metadata: (input.metadata ?? undefined) as any,
          },
        ],
      },
    })

    return new StepResponse(result[0], { locationId: result[0].id })
  },
  /**
   * Without this, a failure after creation leaves a stock location belonging to
   * nobody — the exact residue counted on prod last session (11 orphaned
   * locations, 7 after repair). A half-provisioned warehouse is worse than none:
   * it looks like somewhere goods could be.
   */
  async (compensation, { container }) => {
    if (!compensation?.locationId) return
    await deleteStockLocationsWorkflow(container).run({
      input: { ids: [compensation.locationId] },
    })
  }
)

/** The typed `partner → stock_location` link from #2053. */
const linkPartnerToWarehouseStep = createStep(
  "link-partner-to-warehouse",
  async (
    input: { partner_id: string; location_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.create({
      [PARTNER_MODULE]: { partner_id: input.partner_id },
      [Modules.STOCK_LOCATION]: { stock_location_id: input.location_id },
    })
    return new StepResponse(input, input)
  },
  async (compensation, { container }) => {
    if (!compensation) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss({
      [PARTNER_MODULE]: { partner_id: compensation.partner_id },
      [Modules.STOCK_LOCATION]: { stock_location_id: compensation.location_id },
    })
  }
)

export const createPartnerWarehouseWorkflow = createWorkflow(
  "create-partner-warehouse",
  (input: CreatePartnerWarehouseInput) => {
    guardSingleWarehouseStep({ partner_id: input.partner_id })

    const location = createWarehouseLocationStep(input)

    linkPartnerToWarehouseStep({
      partner_id: input.partner_id,
      location_id: location.id,
    })

    // Same carrier registration the store path performs — a warehouse that no
    // courier can collect from is not a warehouse.
    autoLinkFulfillmentProvidersStep({
      locationId: location.id,
      countryCode: input.address.country_code,
      currencyCode: input.currency_code ?? "inr",
    })

    return new WorkflowResponse({ location })
  }
)
