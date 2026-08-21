import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../modules/partner"
import PartnerService from "../../modules/partner/service"
import {
  planPartnerDeletion,
  type PartnerDeletionFacts,
  type PartnerDeletionPlan,
} from "./lib/partner-deletion-plan"

type DeletePartnerInput = {
  id: string
  /** Delete even though orders are still in flight. See the planner's docs. */
  force?: boolean
}

/**
 * An order still in flight. Everything else is history: a completed, canceled,
 * archived or draft order is not waiting on this partner for anything.
 */
const TERMINAL_ORDER_STATUSES = new Set([
  "completed",
  "canceled",
  "archived",
  "draft",
])

/**
 * Read-only. Gathers what the partner owns, asks the pure planner what should
 * travel with it, and refuses here — before anything has been written — if the
 * partner is still doing business.
 */
const planPartnerCascadeStep = createStep(
  "plan-partner-cascade-step",
  async (input: DeletePartnerInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: partners } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "name",
        "stores.id",
        "stores.default_sales_channel_id",
        "products.id",
        "orders.id",
        "orders.status",
      ],
      filters: { id: input.id },
    })
    const partner = (partners ?? [])[0]
    if (!partner) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner ${input.id} not found`
      )
    }

    const storeIds: string[] = []
    const salesChannelIds: string[] = []
    for (const s of (partner.stores ?? []) as any[]) {
      if (s?.id) storeIds.push(s.id)
      if (s?.default_sales_channel_id)
        salesChannelIds.push(s.default_sales_channel_id)
    }

    // Publishable keys reachable from those channels. Their links are what we
    // dismiss; the key rows themselves are never touched.
    let publishableKeys: Array<{ id: string; sales_channel_ids: string[] }> = []
    if (salesChannelIds.length) {
      const { data: keys } = await query.graph({
        entity: "api_keys",
        fields: ["id", "sales_channels.id"],
        filters: { type: "publishable" },
      })
      publishableKeys = ((keys ?? []) as any[])
        .map((k) => ({
          id: k?.id,
          // `sc?.id` — a dangling link expands to a null element, and one
          // tenant's dead row must never break another tenant's deletion.
          sales_channel_ids: ((k?.sales_channels ?? []) as any[])
            .map((sc) => sc?.id)
            .filter(Boolean),
        }))
        .filter(
          (k) =>
            k.id && k.sales_channel_ids.some((id) => salesChannelIds.includes(id))
        )
    }

    // Live orders, from BOTH scopings: work-orders hang off the partner↔order
    // link, retail orders off the partner's sales channel. Checking only one
    // would clear a partner that is mid-delivery on the other.
    const liveOrderIds = new Set<string>()
    for (const o of (partner.orders ?? []) as any[]) {
      if (o?.id && !TERMINAL_ORDER_STATUSES.has(o?.status)) liveOrderIds.add(o.id)
    }
    if (salesChannelIds.length) {
      const { data: retail } = await query.graph({
        entity: "order",
        fields: ["id", "status"],
        filters: { sales_channel_id: salesChannelIds },
      })
      for (const o of (retail ?? []) as any[]) {
        if (o?.id && !TERMINAL_ORDER_STATUSES.has(o?.status))
          liveOrderIds.add(o.id)
      }
    }

    const facts: PartnerDeletionFacts = {
      partner_id: input.id,
      partner_name: partner.name ?? null,
      store_ids: storeIds,
      sales_channel_ids: salesChannelIds,
      publishable_keys: publishableKeys,
      product_ids: ((partner.products ?? []) as any[])
        .map((p) => p?.id)
        .filter(Boolean),
      live_order_ids: [...liveOrderIds],
      force: input.force === true,
    }

    const plan = planPartnerDeletion(facts)

    if (!plan.deletable) {
      // Nothing has been written yet, so there is nothing to unwind.
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        plan.blockers.join(" ")
      )
    }

    return new StepResponse(plan)
  }
)

/**
 * Dismiss the key↔channel links FIRST, before the channel goes.
 *
 * 🔴 Order is the whole point. On 2026-08-21 a sales channel was removed while
 * its publishable key survived; the key expanded to `sales_channels: [null]`
 * and threw inside a query that walks EVERY tenant's keys, so one dead row
 * 404'd every storefront on the platform. Unlinking first means the dangling
 * state never exists — not between two awaits, and not at all if the channel
 * soft-delete then fails.
 */
const unlinkPublishableKeysStep = createStep(
  "unlink-partner-publishable-keys-step",
  async (plan: PartnerDeletionPlan, { container }) => {
    for (const k of plan.unlink_keys) {
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: k.key_id, add: [], remove: k.sales_channel_ids },
      })
    }
    return new StepResponse({ count: plan.unlink_keys.length }, plan.unlink_keys)
  },
  async (unlinked: PartnerDeletionPlan["unlink_keys"] | undefined, { container }) => {
    if (!unlinked?.length) return
    for (const k of unlinked) {
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: k.key_id, add: k.sales_channel_ids, remove: [] },
      })
    }
  }
)

const softDeletePartnerSalesChannelsStep = createStep(
  "soft-delete-partner-sales-channels-step",
  async (plan: PartnerDeletionPlan, { container }) => {
    const ids = plan.soft_delete_sales_channel_ids
    if (!ids.length) return new StepResponse({ count: 0 }, [])
    const scService: any = container.resolve("sales_channel")
    await scService.softDeleteSalesChannels(ids)
    return new StepResponse({ count: ids.length }, ids)
  },
  async (ids: string[] | undefined, { container }) => {
    if (!ids?.length) return
    const scService: any = container.resolve("sales_channel")
    await scService.restoreSalesChannels(ids)
  }
)

const softDeletePartnerStoresStep = createStep(
  "soft-delete-partner-stores-step",
  async (plan: PartnerDeletionPlan, { container }) => {
    const ids = plan.soft_delete_store_ids
    if (!ids.length) return new StepResponse({ count: 0 }, [])
    const storeService: any = container.resolve("store")
    await storeService.softDeleteStores(ids)
    return new StepResponse({ count: ids.length }, ids)
  },
  async (ids: string[] | undefined, { container }) => {
    if (!ids?.length) return
    const storeService: any = container.resolve("store")
    await storeService.restoreStores(ids)
  }
)

/**
 * Products stop being purchasable, and stay restorable. Line items on past
 * orders snapshot their own title and price, so history reads the same either
 * way.
 */
const softDeletePartnerProductsStep = createStep(
  "soft-delete-partner-products-step",
  async (plan: PartnerDeletionPlan, { container }) => {
    const ids = plan.soft_delete_product_ids
    if (!ids.length) return new StepResponse({ count: 0 }, [])
    const productService: any = container.resolve("product")
    await productService.softDeleteProducts(ids)
    return new StepResponse({ count: ids.length }, ids)
  },
  async (ids: string[] | undefined, { container }) => {
    if (!ids?.length) return
    const productService: any = container.resolve("product")
    await productService.restoreProducts(ids)
  }
)

const deletePartnerAdminsStep = createStep(
  "delete-partner-admins-step",
  async (input: DeletePartnerInput, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    const admins = await partnerService.listPartnerAdmins({
      partner_id: input.id,
    })
    if (admins.length) {
      await partnerService.softDeletePartnerAdmins(admins.map((a: any) => a.id))
    }
    return new StepResponse({ count: admins.length }, { adminIds: admins.map((a: any) => a.id) })
  },
  async (data: { adminIds: string[] } | undefined, { container }) => {
    if (!data?.adminIds?.length) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.restorePartnerAdmins(data.adminIds)
  }
)

const softDeletePartnerStep = createStep(
  "soft-delete-partner-step",
  async (input: DeletePartnerInput, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.softDeletePartners(input.id)
    return new StepResponse({ id: input.id }, { id: input.id })
  },
  async (data: { id: string } | undefined, { container }) => {
    if (!data?.id) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.restorePartners(data.id)
  }
)

/**
 * Soft-delete a partner and everything that is meaningless without it.
 *
 * The order is deliberate and is documented in `lib/partner-deletion-plan.ts`:
 * key links, then channels, then stores, then products, then admins, then the
 * partner itself. Every step compensates, so a failure anywhere leaves the
 * tenant exactly as it was.
 */
export const deletePartnerWorkflow = createWorkflow(
  "delete-partner",
  (input: DeletePartnerInput) => {
    const plan = planPartnerCascadeStep(input)

    unlinkPublishableKeysStep(plan)
    softDeletePartnerSalesChannelsStep(plan)
    softDeletePartnerStoresStep(plan)
    softDeletePartnerProductsStep(plan)

    deletePartnerAdminsStep(input)
    softDeletePartnerStep(input)

    // The plan is what the caller wants back: not just "deleted: true", but
    // exactly what travelled with the partner and what was deliberately left
    // alone. A deletion whose scope you have to reconstruct later is how the
    // 2026-08-21 orphan came to be a mystery.
    return new WorkflowResponse(plan)
  }
)

export default deletePartnerWorkflow
