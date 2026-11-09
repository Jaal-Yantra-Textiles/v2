import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { Link } from "@medusajs/framework/modules-sdk"
import { PARTNER_MODULE } from "../../modules/partner"
import {
  TERMINAL_ORDER_STATUSES,
  softDeletePartnerSalesChannelsStep,
  softDeletePartnerStoresStep,
  unlinkPublishableKeysStep,
} from "./delete-partner"
import {
  planStorefrontDeletion,
  type StorefrontDeletionPlan,
} from "./lib/storefront-deletion-plan"

type DeletePartnerStorefrontInput = {
  partner_id: string
}

/**
 * Read-only. Gathers the partner's store, its channel, the keys and locations
 * on that channel and any live orders, then refuses here — before anything is
 * written — if the plan says no.
 */
const planStorefrontTeardownStep = createStep(
  "plan-partner-storefront-teardown-step",
  async (input: DeletePartnerStorefrontInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: partners } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "name",
        "status",
        "stores.id",
        "stores.default_sales_channel_id",
      ],
      filters: { id: input.partner_id },
    })
    const partner = (partners ?? [])[0]
    if (!partner) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner ${input.partner_id} not found`
      )
    }

    // `s?.id` — a link to a store that is already soft-deleted expands to null.
    const stores = ((partner.stores ?? []) as any[])
      .filter((s) => s?.id)
      .map((s) => ({
        id: s.id as string,
        default_sales_channel_id: (s.default_sales_channel_id ?? null) as
          | string
          | null,
      }))
    const channelIds = stores
      .map((s) => s.default_sales_channel_id)
      .filter((id): id is string => !!id)

    let publishableKeys: Array<{ id: string; sales_channel_ids: string[] }> = []
    const liveOrderIds: string[] = []
    const stockLocationIds: string[] = []

    if (channelIds.length) {
      const { data: keys } = await query.graph({
        entity: "api_keys",
        fields: ["id", "sales_channels.id"],
        filters: { type: "publishable" },
      })
      publishableKeys = ((keys ?? []) as any[])
        .map((k) => ({
          id: k?.id,
          sales_channel_ids: ((k?.sales_channels ?? []) as any[])
            .map((sc) => sc?.id)
            .filter(Boolean),
        }))
        .filter(
          (k) =>
            k.id && k.sales_channel_ids.some((id) => channelIds.includes(id))
        )

      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "status"],
        filters: { sales_channel_id: channelIds },
      })
      for (const o of (orders ?? []) as any[]) {
        if (o?.id && !TERMINAL_ORDER_STATUSES.has(o?.status)) {
          liveOrderIds.push(o.id)
        }
      }

      const { data: channels } = await query.graph({
        entity: "sales_channels",
        fields: ["id", "stock_locations.id"],
        filters: { id: channelIds },
      })
      for (const c of (channels ?? []) as any[]) {
        for (const l of (c?.stock_locations ?? []) as any[]) {
          if (l?.id) stockLocationIds.push(l.id)
        }
      }
    }

    const plan = planStorefrontDeletion({
      partner_id: partner.id,
      partner_name: partner.name ?? null,
      partner_status: partner.status ?? null,
      stores,
      publishable_keys: publishableKeys,
      live_order_ids: liveOrderIds,
      stock_location_ids: stockLocationIds,
    })

    if (!plan.deletable) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        plan.blockers.join(" ")
      )
    }

    return new StepResponse(plan)
  }
)

/**
 * Last: a partner whose link points at a soft-deleted store reads back as
 * `stores: [null]`, which the storefront status route and the provision route
 * would each have to guard against.
 */
const dismissPartnerStoreLinkStep = createStep(
  "dismiss-partner-store-link-step",
  async (plan: StorefrontDeletionPlan, { container }) => {
    const pair = plan.dismiss_partner_store
    if (!pair) return new StepResponse(null, null)
    const link: Link = container.resolve(ContainerRegistrationKeys.LINK)
    const def = {
      [PARTNER_MODULE]: { partner_id: pair.partner_id },
      [Modules.STORE]: { store_id: pair.store_id },
    }
    await link.dismiss(def)
    return new StepResponse(pair, pair)
  },
  async (pair: StorefrontDeletionPlan["dismiss_partner_store"], { container }) => {
    if (!pair) return
    const link: Link = container.resolve(ContainerRegistrationKeys.LINK)
    await link.create({
      [PARTNER_MODULE]: { partner_id: pair.partner_id },
      [Modules.STORE]: { store_id: pair.store_id },
    })
  }
)

/**
 * Soft-delete a partner's storefront: key links, then the channel, then the
 * store, then the partner↔store link. The same order and the same steps as
 * `deletePartnerWorkflow`, minus products and the partner itself. Every step
 * compensates.
 */
export const deletePartnerStorefrontWorkflow = createWorkflow(
  "delete-partner-storefront",
  (input: DeletePartnerStorefrontInput) => {
    const plan = planStorefrontTeardownStep(input)

    unlinkPublishableKeysStep(plan)
    softDeletePartnerSalesChannelsStep(plan)
    softDeletePartnerStoresStep(plan)
    dismissPartnerStoreLinkStep(plan)

    return new WorkflowResponse(plan)
  }
)

export default deletePartnerStorefrontWorkflow
