import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"

jest.setTimeout(120000)

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
}

const rpc = (method: string, params: Record<string, unknown>, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
})

/**
 * The partner-money MCP surface, end to end (#1712).
 *
 * ## Why this runs against real routes rather than a dry_run plan
 *
 * `partner-money-tools.unit.spec.ts` proves each row plans the right request.
 * It cannot prove the request WORKS — and that is the gap this whole issue was
 * born in: `payment_submission ↔ internal_payments` was written correctly and
 * read back empty for two months, because the read used the wrong query shape.
 * A fold test, a plan test and a green suite were all silent about it.
 *
 * So the assertion that matters here is the round trip: link a payment to a
 * payout through the tool, and watch `paid` MOVE on the ledger the tool reads.
 * Then unlink, and watch it move back — which is also the only thing that can
 * prove the DELETE tool sends `payment_submission_id` where the route looks for
 * it, since a DELETE that finds no id 400s in a way a `dry_run` never shows.
 */
setupSharedTestSuite(() => {
  describe("Admin MCP — partner money tools (#1710/#1712)", () => {
    const { api, getContainer } = getSharedTestEnv()

    let auth: { headers: Record<string, string> }
    let partnerId: string

    beforeEach(async () => {
      await createAdminUser(getContainer())
      auth = await getAuthHeaders(api)

      const container = getContainer()
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const partnerService: any = container.resolve("partner")
      const partner = await partnerService.createPartners({
        name: `Money MCP ${unique}`,
        handle: `money-mcp-${unique}`,
      })
      partnerId = partner.id
    })

    const mcp = (body: any) =>
      api.post("/admin/mcp", body, {
        headers: { ...MCP_HEADERS, ...auth.headers },
      })

    const parse = (res: any) => JSON.parse(res.data.result.content[0].text)

    const callTool = (name: string, args: Record<string, unknown>) =>
      mcp(rpc("tools/call", { name, arguments: args }))

    const ledger = async () => {
      const res = await callTool("get_partner_ledger", { id: partnerId })
      const payload = parse(res)
      expect(payload.ok).toBe(true)
      return payload.data.totals
    }

    it("tools/list exposes the four reads and both link writes", async () => {
      const res = await mcp(rpc("tools/list", {}))
      expect(res.status).toBe(200)
      const names = (res.data?.result?.tools ?? []).map((t: any) => t.name)

      for (const name of [
        "get_partner_ledger",
        "list_payable_runs",
        "list_payable_inventory_orders",
        "get_partner_credits",
        "link_payment_to_payout",
        "unlink_payment_from_payout",
      ]) {
        expect(names).toContain(name)
      }
    })

    it("reads a fresh partner as owed nothing rather than erroring", async () => {
      /**
       * ⚠️ The figures are nested under `.totals`. A reader that took
       * `data.billed` would get `undefined` here and report it as "nothing
       * billed" — a wrong response key is a confident nothing.
       */
      const totals = await ledger()
      expect(totals).toBeDefined()
      expect(Number(totals.billed)).toBe(0)
      expect(Number(totals.paid)).toBe(0)
      expect(Number(totals.outstanding)).toBe(0)

      const credits = parse(
        await callTool("get_partner_credits", { id: partnerId })
      )
      expect(credits.ok).toBe(true)
      expect(credits.data.open_total).toBe(0)

      const orders = parse(
        await callTool("list_payable_inventory_orders", {
          partner_id: partnerId,
        })
      )
      expect(orders.ok).toBe(true)
      expect(orders.data.count).toBe(0)
    })

    /**
     * The tenancy rail. Without `partner_id` the route answers "every completed
     * run on the platform", so the tool must refuse BEFORE the call — and it
     * must refuse rather than quietly send an empty filter.
     */
    it("refuses payable-runs without a partner_id instead of asking about everyone", async () => {
      const res = parse(await callTool("list_payable_runs", {}))
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/partner_id/)

      const scoped = parse(
        await callTool("list_payable_runs", { partner_id: partnerId })
      )
      expect(scoped.ok).toBe(true)
      expect(scoped.data.payable_runs).toEqual([])
    })

    it("links a payment to a payout, moves `paid`, and unlinks it back", async () => {
      const container = getContainer()
      const submissionService: any = container.resolve("payment_submissions")
      const paymentService: any = container.resolve("internal_payments")

      const submission = await submissionService.createPaymentSubmissions({
        partner_id: partnerId,
        status: "Approved",
        total_amount: 1000,
        currency: "inr",
        submitted_at: new Date(),
      })

      /**
       * `Completed`, deliberately. Only money that actually moved settles a
       * payout — two production rows are COMMITMENT rows (the exact ordered
       * total, filed the day the order was created) and must never advance a
       * payout's `paid`.
       */
      const payment = await paymentService.createPayments({
        amount: 1000,
        status: "Completed",
        payment_type: "Bank",
        payment_date: new Date(),
      })

      const before = await ledger()
      expect(Number(before.billed)).toBe(1000)
      expect(Number(before.paid)).toBe(0)
      expect(Number(before.outstanding)).toBe(1000)

      // Without confirm: planned, never executed.
      const unconfirmed = parse(
        await callTool("link_payment_to_payout", {
          id: payment.id,
          payment_submission_id: submission.id,
        })
      )
      expect(unconfirmed.requires_confirmation).toBe(true)
      expect(unconfirmed.plan.body).toEqual({
        payment_submission_id: submission.id,
      })

      const stillUnpaid = await ledger()
      expect(Number(stillUnpaid.paid)).toBe(0)

      // With confirm: the fact is recorded, and the ledger reflects it.
      const linked = parse(
        await callTool("link_payment_to_payout", {
          id: payment.id,
          payment_submission_id: submission.id,
          confirm: true,
        })
      )
      expect(linked.ok).toBe(true)
      expect(linked.data.settles).toBe(true)

      const settled = await ledger()
      expect(Number(settled.paid)).toBe(1000)
      expect(Number(settled.outstanding)).toBe(0)

      /**
       * 🔑 The unlink is where a wrong forwarding list shows up. The route reads
       * `payment_submission_id` from the QUERY first; a tool that sent it in a
       * body the middleware does not parse would 400, and one that sent it
       * nowhere at all would 400 too — neither is visible from a dry run.
       */
      const unlinked = parse(
        await callTool("unlink_payment_from_payout", {
          id: payment.id,
          payment_submission_id: submission.id,
          confirm: true,
        })
      )
      expect(unlinked.ok).toBe(true)
      expect(unlinked.data.settles).toBe(false)

      const reverted = await ledger()
      expect(Number(reverted.paid)).toBe(0)
      expect(Number(reverted.outstanding)).toBe(1000)
    })

    /**
     * The same-partner guard (#1714) lives on the route, and the tool inherits
     * it — which is the entire argument for the loopback-proxy design. Asserted
     * here because "the tool inherits the route's guards" is a claim about this
     * surface, not about the route.
     */
    it("refuses to settle another partner's payout through the tool", async () => {
      const container = getContainer()
      const partnerService: any = container.resolve("partner")
      const submissionService: any = container.resolve("payment_submissions")
      const paymentService: any = container.resolve("internal_payments")
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const other = await partnerService.createPartners({
        name: `Other Money MCP ${unique}`,
        handle: `other-money-mcp-${unique}`,
      })

      const theirPayout = await submissionService.createPaymentSubmissions({
        partner_id: other.id,
        status: "Approved",
        total_amount: 500,
        currency: "inr",
        submitted_at: new Date(),
      })

      const payment = await paymentService.createPayments({
        amount: 500,
        status: "Completed",
        payment_type: "Bank",
        payment_date: new Date(),
      })

      /**
       * ⚠️ The payment must have a traceable owner for the guard to bite: the
       * route is deliberately permissive for unattributable money, so a payment
       * with no partner link would be ALLOWED and this test would pass while
       * proving nothing.
       */
      await remoteLink.create({
        partner: { partner_id: partnerId },
        internal_payments: { internal_payments_id: payment.id },
        data: {
          partner_id: partnerId,
          payment_id: payment.id,
          linked_with: "partner",
        },
      })

      const res = parse(
        await callTool("link_payment_to_payout", {
          id: payment.id,
          payment_submission_id: theirPayout.id,
          confirm: true,
        })
      )
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/another partner's payout/i)
    })
  })
})
