import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import designPartnersLink from "../../../../links/design-partners-link"
import partnerInventoryOrderLink from "../../../../links/partner-inventory-order"
import partnerOrderLink from "../../../../links/partner-order"
import partnerPaymentMethodsLink from "../../../../links/partner-payment-methods-link"
import partnerPersonLink from "../../../../links/partner-person"
import partnerProductLink from "../../../../links/partner-product"
import partnerStoresLink from "../../../../links/partner-stores-link"
import partnerSubscriptionLink from "../../../../links/partner-subscription"
import partnerTaskLink from "../../../../links/partner-task"
import submissionPartnerLink from "../../../../links/submission-partner-link"
import { GraphBuilder, asArray, resolveExisting } from "../../builder"
import type { Graph, GraphNode, SpineContext, SpineDescriptor } from "../../types"
import {
  deliveredRuns,
  domainUnverified,
  expectsAdmin,
  expectsPaymentMethod,
  expectsStore,
  whatsappUnverified,
} from "./absence"
import { PARTNER_ITEM_NODES, resolvePartnerItems } from "./items"

/**
 * The PARTNER spine (#1847).
 *
 * The biggest node in the platform: nineteen link files converge on a partner,
 * against the design's six. It is also the one where the registry earns its
 * keep — this file plus one line in `registry.ts` is the whole change. No new
 * route, no new admin hook, no new client code, and the MCP surface picks it up
 * for free.
 *
 * 🔴 Every link is read through its `entryPoint`, never as a field hop off
 * `partners`. A `query.graph` hop from an entity to a linked field can come
 * back with NO KEY AT ALL rather than an error, and on this spine an empty
 * result would silently claim a partner has no work, no people and no bank
 * account — which is the exact shape of the two absences that matter.
 */
const resolvePartnerGraph = async ({ scope, id }: SpineContext): Promise<Graph> => {
  const partnerId = id
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any

  /*
   * `admins` is an intra-module `hasMany` on the partner model itself, so it
   * resolves straight off the entity. It is the ONLY neighbour here that does.
   */
  const { data: partners } = await query.graph({
    entity: "partners",
    filters: { id: partnerId },
    fields: ["*", "admins.*"],
  })

  const partner = (partners || [])[0]
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Partner ${partnerId} was not found`
    )
  }

  const admins = asArray<any>(partner.admins)

  const [
    { data: runs },
    { data: designLinks },
    { data: personLinks },
    { data: taskLinks },
    { data: productLinks },
    { data: orderLinks },
    { data: inventoryOrderLinks },
    { data: submissionLinks },
    { data: methodLinks },
    { data: storeLinks },
    { data: subscriptionLinks },
  ] = await Promise.all([
    query.graph({
      entity: "production_runs",
      filters: { partner_id: partnerId },
      fields: ["id", "status", "partner_id", "design_id", "execution_mode"],
    }),
    query.graph({
      entity: designPartnersLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["design_id"],
    }),
    query.graph({
      entity: partnerPersonLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["person_id"],
    }),
    query.graph({
      entity: partnerTaskLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["task_id"],
    }),
    query.graph({
      entity: partnerProductLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["product_id"],
    }),
    query.graph({
      entity: partnerOrderLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["order_id"],
    }),
    query.graph({
      entity: partnerInventoryOrderLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["inventory_orders_id"],
    }),
    query.graph({
      entity: submissionPartnerLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["payment_submission_id"],
    }),
    query.graph({
      entity: partnerPaymentMethodsLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["internal_payment_details_id"],
    }),
    query.graph({
      entity: partnerStoresLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["store_id"],
    }),
    query.graph({
      entity: partnerSubscriptionLink.entryPoint,
      filters: { partner_id: partnerId },
      fields: ["partner_subscription_id"],
    }),
  ])

  const runList = asArray<any>(runs)
  const linkedDesignIds = asArray<any>(designLinks).map((l) => l.design_id).filter(Boolean)
  const linkedPersonIds = asArray<any>(personLinks).map((l) => l.person_id).filter(Boolean)
  const linkedTaskIds = asArray<any>(taskLinks).map((l) => l.task_id).filter(Boolean)
  const linkedProductIds = asArray<any>(productLinks).map((l) => l.product_id).filter(Boolean)
  const linkedOrderIds = asArray<any>(orderLinks).map((l) => l.order_id).filter(Boolean)
  const linkedInventoryOrderIds = asArray<any>(inventoryOrderLinks)
    .map((l) => l.inventory_orders_id)
    .filter(Boolean)
  const linkedSubmissionIds = asArray<any>(submissionLinks)
    .map((l) => l.payment_submission_id)
    .filter(Boolean)
  const linkedMethodIds = asArray<any>(methodLinks)
    .map((l) => l.internal_payment_details_id)
    .filter(Boolean)
  const linkedStoreIds = asArray<any>(storeLinks).map((l) => l.store_id).filter(Boolean)
  const linkedSubscriptionIds = asArray<any>(subscriptionLinks)
    .map((l) => l.partner_subscription_id)
    .filter(Boolean)

  /*
   * 🔴 Second pass: keep only the ids that resolve to a real record.
   *
   * A link row is not a record. Both of these were measured on the local
   * database — a `people` node reading "4 linked" against four link rows whose
   * person ids do not exist, and a `submissions` node reading "2 raised" with
   * both submissions gone. Counting link rows made the node claim `present`,
   * which this feature defines as "a declared link with SOMETHING ON THE OTHER
   * END".
   *
   * It only came to light because the drawer lists records while the node
   * counted links, and the two disagreed. Absent that, the graph would have
   * gone on asserting neighbours that are not there — the exact failure it was
   * built to expose, committed by the thing exposing it.
   *
   * Independent, so one round trip for all of them.
   */
  const [
    designIds,
    personIds,
    taskIds,
    productIds,
    orderIds,
    inventoryOrderIds,
    submissionIds,
    methodIds,
    storeIds,
    subscriptionIds,
  ] = await Promise.all([
    resolveExisting(query, "design", linkedDesignIds),
    resolveExisting(query, "person", linkedPersonIds),
    resolveExisting(query, "task", linkedTaskIds),
    resolveExisting(query, "product", linkedProductIds),
    resolveExisting(query, "order", linkedOrderIds),
    resolveExisting(query, "inventory_orders", linkedInventoryOrderIds),
    resolveExisting(query, "payment_submission", linkedSubmissionIds),
    resolveExisting(query, "internal_payment_details", linkedMethodIds),
    resolveExisting(query, "store", linkedStoreIds),
    resolveExisting(query, "partner_subscription", linkedSubscriptionIds),
  ])

  const builder = new GraphBuilder("partner")
  const push = builder.push.bind(builder)

  // ---- admins -------------------------------------------------------------

  if (admins.length) {
    push(
      {
        key: "admins",
        type: "partner_admin",
        label: "Admins",
        sublabel: `${admins.length} ${admins.length === 1 ? "admin" : "admins"}`,
        state: "present",
        count: admins.length,
        status: null,
        href: `/partners/${partnerId}`,
        props: admins.slice(0, 4).map((a) => ({
          key: a.email || a.id,
          value: String(a.role ?? "admin"),
        })),
        action: null,
      },
      { label: "partner_admin", state: "present", reason: null }
    )
  } else if (expectsAdmin(admins.length)) {
    push(
      {
        key: "admins",
        type: "partner_admin",
        label: "Admins",
        sublabel: "nobody can sign in",
        state: "absent",
        count: 0,
        status: null,
        href: `/partners/${partnerId}`,
        props: [{ key: "admins", value: "0" }],
        action: { label: "Add an admin", href: `/partners/${partnerId}` },
      },
      {
        label: "partner_admin",
        state: "absent",
        reason:
          "This partner has no admin, so nobody can sign in, accept a dispatch or be notified of one. Work assigned to them stops dead while the assignment still reads as successful.",
      }
    )
  }

  // ---- payment methods ----------------------------------------------------

  const delivered = deliveredRuns(runList)

  if (methodIds.length) {
    push(
      {
        key: "payment_methods",
        type: "internal_payment_details",
        label: "Payment methods",
        sublabel: `${methodIds.length} on file`,
        state: "present",
        count: methodIds.length,
        status: null,
        href: `/partners/${partnerId}`,
        props: [{ key: "methods", value: String(methodIds.length) }],
        action: null,
      },
      { label: "payment_methods", state: "present", reason: null }
    )
  } else if (expectsPaymentMethod(runList, submissionIds.length, methodIds.length)) {
    push(
      {
        key: "payment_methods",
        type: "internal_payment_details",
        label: "Payment methods",
        sublabel: "nowhere to pay",
        state: "absent",
        count: 0,
        status: null,
        href: `/partners/${partnerId}`,
        props: [
          { key: "delivered runs", value: String(delivered.length) },
          { key: "submissions", value: String(submissionIds.length) },
          { key: "methods", value: "0" },
        ],
        action: { label: "Add a payment method", href: `/partners/${partnerId}` },
      },
      {
        label: "payment_methods",
        state: "absent",
        reason:
          "There is payable work here and no account to pay it into. A payout is paid to a linked payment method, so an approved submission for this partner cannot be paid at all.",
      }
    )
  }

  // ---- stores -------------------------------------------------------------

  if (storeIds.length) {
    push(
      {
        key: "stores",
        type: "store",
        label: "Stores",
        sublabel: `${storeIds.length} ${storeIds.length === 1 ? "store" : "stores"}`,
        state: "present",
        count: storeIds.length,
        status: null,
        href: `/partners/${partnerId}`,
        props: [{ key: "stores", value: String(storeIds.length) }],
        action: null,
      },
      { label: "stores", state: "present", reason: null }
    )
  } else if (expectsStore(partner.workspace_type, storeIds.length)) {
    push(
      {
        key: "stores",
        type: "store",
        label: "Stores",
        sublabel: "nothing to sell through",
        state: "absent",
        count: 0,
        status: null,
        href: `/partners/${partnerId}`,
        props: [{ key: "workspace", value: String(partner.workspace_type) }],
        action: { label: "Link a store", href: `/partners/${partnerId}` },
      },
      {
        label: "stores",
        state: "absent",
        reason:
          "This partner is a seller and has no store linked, so the commerce surface they are routed to has nothing to act on.",
      }
    )
  }

  // ---- work ---------------------------------------------------------------

  if (runList.length) {
    const byStatus = runList.reduce<Record<string, number>>((acc, r) => {
      const k = String(r.status ?? "unknown")
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    push(
      {
        key: "runs",
        type: "production_run",
        label: "Production runs",
        sublabel: `${runList.length} ${runList.length === 1 ? "run" : "runs"}`,
        state: "present",
        count: runList.length,
        status: null,
        href: `/partners/${partnerId}`,
        props: [
          ...Object.entries(byStatus).map(([k, v]) => ({ key: k, value: String(v) })),
          { key: "delivered", value: String(delivered.length) },
        ],
        action: null,
      },
      { label: "partner_id", state: "present", reason: null }
    )
  }

  if (designIds.length) {
    push(
      {
        key: "designs",
        type: "design",
        label: "Designs",
        sublabel: `${designIds.length} linked`,
        state: "present",
        count: designIds.length,
        status: null,
        href: designIds.length === 1 ? `/designs/${designIds[0]}` : null,
        props: [{ key: "designs", value: String(designIds.length) }],
        action: null,
      },
      { label: "design_partner", state: "present", reason: null }
    )
  }

  if (taskIds.length) {
    push(
      {
        key: "tasks",
        type: "task",
        label: "Tasks",
        sublabel: `${taskIds.length} assigned`,
        state: "present",
        count: taskIds.length,
        status: null,
        href: `/partners/${partnerId}`,
        props: [{ key: "tasks", value: String(taskIds.length) }],
        action: null,
      },
      { label: "partner_task", state: "present", reason: null }
    )
  }

  if (productIds.length) {
    push(
      {
        key: "products",
        type: "product",
        label: "Products",
        sublabel: `${productIds.length} listed`,
        state: "present",
        count: productIds.length,
        status: null,
        href: productIds.length === 1 ? `/products/${productIds[0]}` : null,
        props: [{ key: "products", value: String(productIds.length) }],
        action: null,
      },
      { label: "partner_product", state: "present", reason: null }
    )
  }

  if (orderIds.length) {
    push(
      {
        key: "orders",
        type: "order",
        label: "Work orders",
        sublabel: `${orderIds.length} ${orderIds.length === 1 ? "order" : "orders"}`,
        state: "present",
        count: orderIds.length,
        status: null,
        href: orderIds.length === 1 ? `/orders/${orderIds[0]}` : null,
        props: [{ key: "orders", value: String(orderIds.length) }],
        action: null,
      },
      { label: "partner_order", state: "present", reason: null }
    )
  }

  if (inventoryOrderIds.length) {
    push(
      {
        key: "inventory_orders",
        type: "inventory_order",
        label: "Inventory orders",
        sublabel: `${inventoryOrderIds.length} raised`,
        state: "present",
        count: inventoryOrderIds.length,
        status: null,
        href: `/inventory-orders`,
        props: [{ key: "orders", value: String(inventoryOrderIds.length) }],
        action: null,
      },
      { label: "partner_inventory_order", state: "present", reason: null }
    )
  }

  if (submissionIds.length) {
    push(
      {
        key: "submissions",
        type: "payment_submission",
        label: "Payment submissions",
        sublabel: `${submissionIds.length} raised`,
        state: "present",
        count: submissionIds.length,
        status: null,
        href: `/payment-submissions`,
        props: [{ key: "submissions", value: String(submissionIds.length) }],
        action: null,
      },
      { label: "payment_submission", state: "present", reason: null }
    )
  }

  /*
   * ---- people, and the link rows that resolve to nobody ------------------
   *
   * 🔴 `dangling` is DRAWN, not just excluded (#1857).
   *
   * Counting link rows was the original fault: a node read "4 linked" against
   * four rows whose people do not exist. Filtering them out fixed the lie and
   * introduced a quieter one — with every row dangling, `personIds` is empty
   * and NO node is emitted at all, so the partner that provoked this whole
   * issue draws a graph with nothing wrong on it. "Nobody was ever linked" and
   * "four links point at nobody" are different facts and must not render the
   * same.
   */
  const danglingPeople = linkedPersonIds.length - personIds.length

  if (personIds.length) {
    push(
      {
        key: "people",
        type: "person",
        label: "People",
        sublabel: danglingPeople
          ? `${personIds.length} linked, ${danglingPeople} missing`
          : `${personIds.length} linked`,
        state: "present",
        count: personIds.length,
        status: null,
        href: `/partners/${partnerId}`,
        props: [
          { key: "people", value: String(personIds.length) },
          ...(danglingPeople
            ? [{ key: "dangling links", value: String(danglingPeople) }]
            : []),
        ],
        action: null,
      },
      { label: "partner_person", state: "present", reason: null }
    )
  } else if (danglingPeople) {
    push(
      {
        key: "people",
        type: "person",
        label: "People",
        sublabel: `${danglingPeople} ${danglingPeople === 1 ? "link points" : "links point"} at nobody`,
        state: "absent",
        count: 0,
        status: null,
        href: `/partners/${partnerId}`,
        props: [
          { key: "link rows", value: String(linkedPersonIds.length) },
          { key: "people that exist", value: "0" },
        ],
        action: { label: "Link a person", href: `/partners/${partnerId}` },
      },
      {
        label: "partner_person",
        state: "absent",
        reason: `This partner has ${danglingPeople} ${danglingPeople === 1 ? "link row" : "link rows"} to people that no longer exist or have been deleted, and nobody it can actually reach. Anything counting the link table reports this partner as having people; nothing can open one.`,
      }
    )
  }

  if (subscriptionIds.length) {
    push(
      {
        key: "subscriptions",
        type: "partner_subscription",
        label: "Subscription",
        sublabel: `${subscriptionIds.length} on file`,
        state: "present",
        count: subscriptionIds.length,
        status: null,
        href: `/partners/${partnerId}`,
        props: [{ key: "subscriptions", value: String(subscriptionIds.length) }],
        action: null,
      },
      { label: "partner_subscription", state: "present", reason: null }
    )
  }

  /*
   * ---- configured but broken ----------------------------------------------
   *
   * 🔴 These two are `derived`, not `absent`, and the distinction is the whole
   * reason they are drawn. The neighbour is not missing — it is there and it
   * does not work. WhatsApp unverified means the sender drops the message, so a
   * dispatch notification is recorded as sent and never arrives; a claimed but
   * unverified domain means the storefront does not resolve. Both read as
   * "set up" everywhere the field itself is displayed.
   */
  if (whatsappUnverified(partner.whatsapp_number, partner.whatsapp_verified)) {
    push(
      {
        key: "whatsapp",
        type: "channel",
        label: "WhatsApp",
        sublabel: "number set, never verified",
        state: "derived",
        count: 0,
        status: "unverified",
        href: `/partners/${partnerId}`,
        props: [
          { key: "number", value: String(partner.whatsapp_number) },
          { key: "verified", value: "no" },
        ],
        action: { label: "Verify the number", href: null },
      },
      {
        label: "whatsapp_number",
        state: "derived",
        reason:
          "A number is on file but was never verified, so notifications to it are dropped by the sender — a dispatch is recorded as notified and never arrives.",
      }
    )
  }

  if (domainUnverified(partner.custom_domain, partner.custom_domain_verified)) {
    push(
      {
        key: "domain",
        type: "domain",
        label: "Custom domain",
        sublabel: "claimed, not resolving",
        state: "derived",
        count: 0,
        status: "unverified",
        href: `/partners/${partnerId}`,
        props: [
          { key: "domain", value: String(partner.custom_domain) },
          { key: "verified", value: "no" },
        ],
        action: { label: "Verify the domain", href: null },
      },
      {
        label: "custom_domain",
        state: "derived",
        reason:
          "The domain is recorded against this partner but not verified, so their storefront does not resolve on it.",
      }
    )
  }

  const spine: GraphNode = {
    key: "partner",
    type: "partner",
    label: String(partner.name ?? partnerId),
    sublabel: String(partner.handle ?? partner.workspace_type ?? ""),
    state: "present",
    count: 1,
    status: String(partner.status ?? ""),
    href: `/partners/${partnerId}`,
    props: [
      { key: "status", value: String(partner.status ?? "—") },
      { key: "workspace", value: String(partner.workspace_type ?? "—") },
      { key: "verified", value: partner.is_verified ? "yes" : "no" },
      ...(partner.country_code
        ? [{ key: "country", value: String(partner.country_code).toUpperCase() }]
        : []),
      ...(partner.currency_code
        ? [{ key: "currency", value: String(partner.currency_code).toUpperCase() }]
        : []),
    ],
    action: null,
  }

  return builder.build(spine)
}

export const partnerSpine: SpineDescriptor = {
  key: "partner",
  label: "Partner",
  resolve: resolvePartnerGraph,
  items: resolvePartnerItems,
  itemNodes: PARTNER_ITEM_NODES,
}
