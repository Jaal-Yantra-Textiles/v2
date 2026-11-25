import { Modules } from "@medusajs/framework/utils"

import designLineItemLink from "../../../links/design-line-item-link"
import { PAYMENT_SCHEDULE_MODULE } from "../../../modules/payment_schedule"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../modules/payment_submissions"
import { PARTNER_QUOTE_MODULE } from "../../../modules/partner-quote"
import { effectiveQuoteStatus } from "../../../modules/partner-quote/lib/token"
import { readPartnerLedger } from "../../../api/admin/payments/partners/[id]/ledger/read-ledger"
import { listOrdersAwaitingCount } from "../../../workflows/inventory_orders/lib/awaiting-count"
import { GraphBuilder, asArray, money } from "../builder"
import type { Graph, GraphNode, NodeItem, SpineContext } from "../types"
import { resolveProductsAwaiting } from "./products-awaiting"
import { resolveRunsRejected } from "./runs-rejected"
import { resolveRunsAwaitingDispatch } from "./runs-awaiting-dispatch"

/**
 * PENDING WORK — one board for everything that is waiting (#2625 S1).
 *
 * Each box is a BUCKET: a reader that returns how many records are waiting and
 * which ones. Every bucket reuses the reader that already answers its question
 * elsewhere — the queue boards, the partner ledger fold, the awaiting-count
 * dispatch ledger, the design-order cancel rule, the quote effective status —
 * so the board can never disagree with the screen it links to.
 *
 * 🔴 A bucket that FAILS is drawn as a failure, never as zero. "0 waiting" and
 * "we could not look" are different facts, and a board whose whole job is to
 * say what is still open must not turn the second into the first.
 */

export type BucketResult = {
  /** How many are waiting. May exceed items.length when a reader caps its rows. */
  count: number
  items: NodeItem[]
  /** One line under the label, e.g. "₹12,505 outstanding". */
  summary?: string | null
}

type Bucket = {
  key: string
  label: string
  /** Who has to move: us, a partner, or a customer. Shown as the node status. */
  side: "us" | "partner" | "customer"
  href: string | null
  load: (ctx: SpineContext) => Promise<BucketResult>
}

const DAY_MS = 24 * 60 * 60 * 1000
const daysSince = (at: unknown, now = Date.now()): number | null => {
  const t = at ? new Date(at as any).getTime() : NaN
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null
}
const ago = (at: unknown): string | null => {
  const d = daysSince(at)
  return d === null ? null : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"} ago`
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A sub-board's cohort, as rows: each of its nodes becomes one member. */
const fromQueue = async (
  ctx: SpineContext,
  resolve: (c: SpineContext) => Promise<Graph>
): Promise<BucketResult> => {
  const g = await resolve(ctx)
  return {
    count: Number(g.spine.count) || 0,
    summary: g.spine.sublabel,
    items: g.nodes.map((n) => ({
      id: n.key,
      label: n.label,
      sublabel: n.sublabel,
      status: n.status,
      href: n.href,
      props: n.props,
      remove: null,
    })),
  }
}

// ---------------------------------------------------------------- PURE RULES

/** A leaf run handed to a partner and not yet closed. */
export const isWithPartner = (r: any): boolean =>
  Boolean(r?.partner_id) && ["sent_to_partner", "in_progress"].includes(String(r?.status))

/** A finished partner run nobody has priced — its payout cannot be billed. */
export const isClosedWithoutPrice = (r: any, now = Date.now(), withinDays = 90): boolean => {
  if (!r?.partner_id || String(r?.status) !== "completed") return false
  const cost = r?.partner_cost_estimate
  if (cost !== null && cost !== undefined && Number(cost) > 0) return false
  const d = daysSince(r?.completed_at, now)
  return d !== null && d <= withinDays
}

/** Deposit taken, balance not yet collected. */
export const isBalanceOpen = (s: any): boolean =>
  String(s?.deposit_status) === "paid" &&
  ["not_due", "due", "failed"].includes(String(s?.balance_status)) &&
  Boolean(s?.order_id)

/** A design order a buyer has been sent and has not paid (or that never got a buyer). */
export const isDesignOrderAwaitingBuyer = (cart: any): boolean =>
  Boolean(cart) && !cart.completed_at && !cart?.metadata?.cancelled_at

// --------------------------------------------------------------- THE BUCKETS

const runsWithPartner = async ({ scope }: SpineContext): Promise<BucketResult> => {
  const query = scope.resolve("query")
  const { data } = await query.graph({
    entity: "production_runs",
    fields: ["id", "status", "partner_id", "design_id", "quantity", "updated_at", "accepted_at", "created_at"],
    filters: { status: ["sent_to_partner", "in_progress"] },
  })
  const runs = asArray<any>(data).filter(isWithPartner)
  const names = await nameMaps(scope, runs)
  runs.sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
  return {
    count: runs.length,
    summary: `${plural(runs.length, "run")} with ${plural(new Set(runs.map((r) => r.partner_id)).size, "partner")}`,
    items: runs.map((r) => ({
      id: r.id,
      label: names.design.get(r.design_id) || r.id,
      sublabel: [names.partner.get(r.partner_id), r.status === "in_progress" ? "started" : "sent", ago(r.accepted_at || r.created_at)]
        .filter(Boolean)
        .join(" · "),
      status: r.status,
      href: `/production-runs/${r.id}`,
      props: [
        { key: "quantity", value: String(r.quantity ?? "—") },
        { key: "last change", value: ago(r.updated_at) ?? "—" },
      ],
      remove: null,
    })),
  }
}

const runsWithoutPrice = async ({ scope }: SpineContext): Promise<BucketResult> => {
  const query = scope.resolve("query")
  const { data } = await query.graph({
    entity: "production_runs",
    fields: ["id", "status", "partner_id", "design_id", "produced_quantity", "partner_cost_estimate", "completed_at"],
    filters: { status: ["completed"] },
  })
  const now = Date.now()
  const runs = asArray<any>(data).filter((r) => isClosedWithoutPrice(r, now))
  const names = await nameMaps(scope, runs)
  return {
    count: runs.length,
    summary: `closed in the last 90 days with no rate`,
    items: runs.map((r) => ({
      id: r.id,
      label: names.design.get(r.design_id) || r.id,
      sublabel: [names.partner.get(r.partner_id), `${r.produced_quantity ?? "?"} made`, ago(r.completed_at)]
        .filter(Boolean)
        .join(" · "),
      status: "completed",
      href: `/production-runs/${r.id}`,
      props: [{ key: "why", value: "no partner rate, so its payout cannot be billed" }],
      remove: null,
    })),
  }
}

const partnersToPay = async ({ scope }: SpineContext): Promise<BucketResult> => {
  const subs: any = scope.resolve(PAYMENT_SUBMISSIONS_MODULE)
  const open = asArray<any>(
    await subs.listPaymentSubmissions({ status: ["Draft", "Pending", "Approved"] }, { select: ["id", "partner_id"] })
  )
  const partnerIds = [...new Set(open.map((s) => s.partner_id).filter(Boolean))] as string[]
  const names = await partnerNames(scope, partnerIds)

  // The ledger FOLD, not the payout rows: a payout paid outside the system and
  // linked to its payment is settled there even while its status says Draft.
  const rows: Array<NodeItem & { _outstanding: number }> = []
  let total = 0
  let currency: string | null = null
  for (let i = 0; i < partnerIds.length; i += 3) {
    const batch = partnerIds.slice(i, i + 3)
    const ledgers = await Promise.all(batch.map((id) => readPartnerLedger(scope, id).catch(() => null)))
    batch.forEach((id, j) => {
      const t: any = ledgers[j]?.totals
      const outstanding = Number(t?.outstanding)
      if (!Number.isFinite(outstanding) || outstanding < 1) return
      total += outstanding
      currency = currency ?? t?.currency ?? "inr"
      rows.push({
        _outstanding: outstanding,
        id,
        label: names.get(id) || id,
        sublabel: `${money(outstanding, t?.currency) ?? outstanding} outstanding of ${money(Number(t?.billed), t?.currency) ?? t?.billed} billed`,
        status: null,
        href: `/partners/${id}`,
        props: [
          { key: "billed", value: String(money(Number(t?.billed), t?.currency) ?? t?.billed) },
          { key: "paid", value: String(money(Number(t?.paid), t?.currency) ?? t?.paid) },
        ],
        remove: null,
      })
    })
  }
  rows.sort((a, b) => b._outstanding - a._outstanding)
  return {
    count: rows.length,
    summary: rows.length ? `${money(total, currency) ?? total} outstanding` : "nobody is owed",
    items: rows.map(({ _outstanding, ...row }) => row),
  }
}

const balancesDue = async ({ scope }: SpineContext): Promise<BucketResult> => {
  const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
  const rows = asArray<any>(await schedules.listPaymentSchedules({ deposit_status: "paid" })).filter(isBalanceOpen)
  const query = scope.resolve("query")
  const orderIds = rows.map((r) => r.order_id)
  const { data: orders } = orderIds.length
    ? await query.graph({ entity: "order", fields: ["id", "display_id", "email"], filters: { id: orderIds } })
    : { data: [] }
  const byId = new Map(asArray<any>(orders).map((o) => [o.id, o]))
  return {
    count: rows.length,
    summary: `deposit paid, balance not yet collected`,
    items: rows.map((r) => {
      const o = byId.get(r.order_id)
      return {
        id: r.order_id,
        label: o?.display_id ? `Order #${o.display_id}` : r.order_id,
        sublabel: [o?.email, `${money(Number(r.balance_amount), r.currency_code) ?? r.balance_amount} balance`, String(r.balance_status).replace("_", " ")]
          .filter(Boolean)
          .join(" · "),
        status: r.balance_status,
        href: `/orders/${r.order_id}`,
        props: [
          { key: "total", value: String(money(Number(r.total_due), r.currency_code) ?? r.total_due) },
          { key: "deposit paid", value: ago(r.deposit_paid_at) ?? "—" },
        ],
        remove: null,
      }
    }),
  }
}

const goodsToCount = async ({ scope }: SpineContext): Promise<BucketResult> => {
  const orders = await listOrdersAwaitingCount(scope)
  return {
    count: orders.length,
    summary: `dispatched, not yet counted in`,
    items: orders.map((o: any) => ({
      id: o.id,
      label: [o.partner_name, "→", o.destination_name].filter(Boolean).join(" "),
      sublabel: [`${o.awaiting_quantity} to count`, o.days_since_dispatch != null ? `sent ${o.days_since_dispatch} days ago` : null, o.carrier_delivered ? "carrier says delivered" : null]
        .filter(Boolean)
        .join(" · "),
      status: o.status ?? null,
      href: `/orders/inventory/${o.id}`,
      props: [],
      remove: null,
    })),
  }
}

const designOrdersAwaitingBuyer = async ({ scope }: SpineContext): Promise<BucketResult> => {
  const query = scope.resolve("query")
  const { data: links } = await query.graph({ entity: designLineItemLink.entryPoint, fields: ["design_id", "line_item_id"] })
  const lineIds = asArray<any>(links).map((l) => l.line_item_id)
  if (!lineIds.length) return { count: 0, items: [] }
  const cartService: any = scope.resolve(Modules.CART)
  const lines = asArray<any>(await cartService.listLineItems({ id: lineIds }, { select: ["id", "cart_id", "title"] }))
  const firstLineByCart = new Map<string, any>()
  for (const li of lines) if (li.cart_id && !firstLineByCart.has(li.cart_id)) firstLineByCart.set(li.cart_id, li)
  const cartIds = [...firstLineByCart.keys()]
  if (!cartIds.length) return { count: 0, items: [] }
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "email", "currency_code", "total", "metadata", "created_at", "completed_at"],
    filters: { id: cartIds },
  })
  const open = asArray<any>(carts).filter(isDesignOrderAwaitingBuyer)
  open.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  return {
    count: open.length,
    summary: `sent or drafted, not paid`,
    items: open.map((c) => ({
      id: c.id,
      label: c.email || "No buyer attached",
      sublabel: [firstLineByCart.get(c.id)?.title, money(Number(c.total), c.currency_code), ago(c.created_at)].filter(Boolean).join(" · "),
      status: c.email ? "awaiting payment" : "no buyer",
      href: `/design-orders/${firstLineByCart.get(c.id)?.id}`,
      props: [{ key: "cart", value: c.id }],
      remove: null,
    })),
  }
}

const quotesAwaitingBuyer = async ({ scope }: SpineContext): Promise<BucketResult> => {
  const svc: any = scope.resolve(PARTNER_QUOTE_MODULE)
  const now = new Date()
  const [quotes] = await svc.listAndCountPartnerQuotes({ status: "active" }, { take: 200 })
  const waitingQuotes = asArray<any>(quotes).filter((q) => effectiveQuoteStatus(q, now) === "active")
  const [briefs] = await svc.listAndCountPartnerQuoteBriefs({ status: ["open", "submitted", "sampling"] }, { take: 200 })
  const items: NodeItem[] = [
    ...waitingQuotes.map((q) => ({
      id: q.id,
      label: q.buyer_email || q.title || q.id,
      sublabel: ["quote", q.view_count ? `viewed ${q.view_count}×` : "not opened yet", q.expires_at ? `expires ${new Date(q.expires_at).toDateString()}` : null]
        .filter(Boolean)
        .join(" · "),
      status: "active",
      href: `/quotes/${q.id}`,
      props: [],
      remove: null,
    })),
    ...asArray<any>(briefs).map((b) => ({
      id: b.id,
      label: b.buyer_email || b.title || b.id,
      sublabel: ["brief", b.status, b.view_count ? `viewed ${b.view_count}×` : null].filter(Boolean).join(" · "),
      status: b.status,
      href: `/quotes/briefs/${b.id}`,
      props: [],
      remove: null,
    })),
  ]
  return { count: items.length, summary: `${plural(waitingQuotes.length, "quote")}, ${plural(asArray(briefs).length, "brief")}`, items }
}

// ----------------------------------------------------------------- HELPERS

const partnerNames = async (scope: any, ids: string[]): Promise<Map<string, string>> => {
  if (!ids.length) return new Map()
  const { data } = await scope.resolve("query").graph({ entity: "partners", fields: ["id", "name"], filters: { id: ids } })
  return new Map(asArray<any>(data).map((p) => [p.id, p.name]))
}

const nameMaps = async (scope: any, runs: any[]) => {
  const designIds = [...new Set(runs.map((r) => r.design_id).filter(Boolean))] as string[]
  const { data: designs } = designIds.length
    ? await scope.resolve("query").graph({ entity: "design", fields: ["id", "name"], filters: { id: designIds } })
    : { data: [] }
  return {
    design: new Map(asArray<any>(designs).map((d) => [d.id, d.name])),
    partner: await partnerNames(scope, [...new Set(runs.map((r) => r.partner_id).filter(Boolean))] as string[]),
  }
}

// ------------------------------------------------------------ REGISTRATION

export const PENDING_WORK_BUCKETS: Bucket[] = [
  { key: "partners-to-pay", label: "Partners to pay", side: "us", href: "/payments", load: partnersToPay },
  { key: "runs-without-price", label: "Runs closed with no price", side: "us", href: null, load: runsWithoutPrice },
  { key: "products-awaiting", label: "Products awaiting creation", side: "us", href: "/queues/products-awaiting", load: (c) => fromQueue(c, resolveProductsAwaiting) },
  { key: "runs-awaiting-dispatch", label: "Runs awaiting dispatch", side: "us", href: "/queues/runs-awaiting-dispatch", load: (c) => fromQueue(c, resolveRunsAwaitingDispatch) },
  { key: "runs-rejected", label: "Rejected production runs", side: "us", href: "/queues/runs-rejected", load: (c) => fromQueue(c, resolveRunsRejected) },
  { key: "goods-to-count", label: "Goods waiting to be counted", side: "us", href: null, load: goodsToCount },
  { key: "runs-with-partner", label: "Runs with a partner", side: "partner", href: "/production-runs", load: runsWithPartner },
  { key: "design-orders-unpaid", label: "Design orders not paid", side: "customer", href: "/design-orders", load: designOrdersAwaitingBuyer },
  { key: "quotes-waiting", label: "Quotes & briefs with buyers", side: "customer", href: "/quotes", load: quotesAwaitingBuyer },
  { key: "balances-due", label: "Balances to collect", side: "customer", href: null, load: balancesDue },
]

const SIDE_LABEL = { us: "on us", partner: "on a partner", customer: "on a customer" } as const

/** PURE: the board from each bucket's outcome. Exported for the unit spec. */
export const buildPendingWorkGraph = (
  outcomes: Array<{ bucket: Pick<Bucket, "key" | "label" | "side" | "href">; result?: BucketResult; error?: string }>
): Graph => {
  const builder = new GraphBuilder("queue")
  let waiting = 0
  let failed = 0
  for (const { bucket, result, error } of outcomes) {
    const node: GraphNode = error
      ? {
          key: bucket.key,
          type: "pending_bucket",
          label: bucket.label,
          // The count is unknown, so the sublabel must say so — it is what the
          // canvas draws in place of the number.
          sublabel: `could not be read: ${error.slice(0, 80)}`,
          state: "absent",
          count: 0,
          status: "error",
          href: bucket.href,
          props: [{ key: "waiting", value: SIDE_LABEL[bucket.side] }],
          action: null,
        }
      : {
          key: bucket.key,
          type: "pending_bucket",
          label: bucket.label,
          // 🔑 sublabel HIDES the count on the canvas — so it carries the count.
          sublabel: `${result!.count}${result!.summary ? ` · ${result!.summary}` : ""}`,
          state: result!.count > 0 ? "present" : "derived",
          count: result!.count,
          status: SIDE_LABEL[bucket.side],
          href: bucket.href,
          props: [
            { key: "waiting", value: SIDE_LABEL[bucket.side] },
            { key: "count", value: String(result!.count) },
          ],
          action: null,
        }
    if (error) failed++
    else waiting += result!.count
    builder.push(node, {
      label: SIDE_LABEL[bucket.side],
      state: node.state,
      reason: error ? "the reader for this box failed" : result!.count ? null : "nothing waiting",
    })
  }
  return builder.build({
    key: "queue",
    type: "queue",
    label: "Pending work",
    sublabel: `${waiting} waiting across ${outcomes.length - failed} boxes${failed ? `, ${failed} could not be read` : ""}`,
    state: "present",
    count: waiting,
    status: null,
    href: null,
    props: [
      { key: "waiting", value: String(waiting) },
      ...(failed ? [{ key: "unreadable boxes", value: String(failed) }] : []),
    ],
    action: null,
  })
}

const settle = async (bucket: Bucket, ctx: SpineContext) => {
  try {
    return { bucket, result: await bucket.load(ctx) }
  } catch (e: any) {
    return { bucket, error: String(e?.message ?? e) }
  }
}

export const resolvePendingWork = async (ctx: SpineContext): Promise<Graph> =>
  buildPendingWorkGraph(await Promise.all(PENDING_WORK_BUCKETS.map((b) => settle(b, ctx))))

/** The drawer for one box: that bucket's records, read fresh. */
export const pendingWorkItems = async (ctx: SpineContext, nodeKey: string): Promise<NodeItem[]> => {
  const bucket = PENDING_WORK_BUCKETS.find((b) => b.key === nodeKey)
  if (!bucket) return []
  return (await bucket.load(ctx)).items
}
