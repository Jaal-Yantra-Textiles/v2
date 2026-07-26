import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"

jest.setTimeout(120000)

// Streamable HTTP requires the client to accept BOTH json and the SSE stream;
// our transport runs with enableJsonResponse so the body comes back as JSON.
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
 * Coverage for the three operational tiers added on top of partner ops:
 * orders/fulfillment + order edits (#1165), the production-run lifecycle
 * (#1167) and the design -> production pipeline (#1166).
 *
 * The design pipeline is exercised end-to-end for real, because it needs
 * nothing but the DB. Order fulfillment and shipping-label tools are asserted
 * at the rail level (exposure + confirm/dangerous gating) rather than executed:
 * they need a paid, stock-backed order and — for labels — a live carrier API.
 */
setupSharedTestSuite(() => {
  describe("Admin MCP — orders / production-runs / designs ops tools", () => {
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
        name: `Ops MCP Partner ${unique}`,
        handle: `ops-mcp-partner-${unique}`,
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

    const createDesign = async (name: string) => {
      const res = await callTool("create_design", {
        name,
        description: `Fixture design for ${name}`,
        confirm: true,
      })
      const payload = parse(res)
      // Surface the proxied route's error text rather than a bare `false`.
      expect(payload.error ?? "ok").toBe("ok")
      return payload.data.design.id as string
    }

    it("tools/list exposes the new ops tools and HIDES the dangerous ones by default", async () => {
      const res = await mcp(rpc("tools/list", {}))
      expect(res.status).toBe(200)
      const names = (res.data?.result?.tools ?? []).map((t: any) => t.name)

      for (const name of [
        // #1165 orders
        "list_order_changes",
        "list_order_designs",
        "create_order_fulfillment",
        "create_order_shipment",
        "mark_order_fulfillment_delivered",
        "create_order_edit",
        "add_order_edit_items",
        "request_order_edit",
        // #1167 production runs
        "get_production_run",
        "create_production_run",
        "approve_production_run",
        "send_production_run_to_production",
        "start_production_run_dispatch",
        "resume_production_run_dispatch",
        "get_production_run_cost_summary",
        // #1166 designs
        "list_design_work_orders",
        "create_design",
        "update_design",
        "produce_designs",
        "link_design_partners",
        "cancel_design_partner_assignment",
      ]) {
        expect(names).toContain(name)
      }

      // ADMIN_MCP_ENABLE_DANGEROUS is off in test, so the irreversible actions
      // must not even be advertised to the model.
      for (const name of [
        "cancel_order",
        "cancel_order_fulfillment",
        "confirm_order_edit",
        "cancel_production_run",
      ]) {
        expect(names).not.toContain(name)
      }
    })

    it("refuses a dangerous order action outright when dangerous tools are disabled", async () => {
      const res = await callTool("cancel_order", {
        id: "order_does_not_matter",
        reason: "customer asked",
        confirm: true,
      })
      const payload = parse(res)
      expect(payload.ok).toBe(false)
      expect(payload.error).toMatch(/dangerous/i)
    })

    it("runs the design -> production pipeline: create_design, produce_designs, read it back", async () => {
      const designId = await createDesign(`Pipeline Design ${Date.now()}`)

      // Nothing in production yet for this design.
      const before = await callTool("list_production_runs", { design_id: designId })
      expect(parse(before).data.production_runs).toEqual([])

      // Sensitive write: planned but NOT executed without confirm.
      const unconfirmed = await callTool("produce_designs", {
        design_ids: [designId],
        partner_id: partnerId,
      })
      const unconfirmedPayload = parse(unconfirmed)
      expect(unconfirmedPayload.requires_confirmation).toBe(true)
      expect(unconfirmedPayload.plan.path).toBe("/admin/designs/produce")

      const stillEmpty = await callTool("list_production_runs", { design_id: designId })
      expect(parse(stillEmpty).data.production_runs).toEqual([])

      // With confirm it executes against the real route.
      const produced = await callTool("produce_designs", {
        design_ids: [designId],
        partner_id: partnerId,
        confirm: true,
      })
      expect(parse(produced).ok).toBe(true)

      const after = await callTool("list_production_runs", { design_id: designId })
      const runs = parse(after).data.production_runs
      expect(runs.length).toBeGreaterThan(0)

      // The collated work-order read surfaces it too.
      const workOrders = await callTool("list_design_work_orders", {})
      expect(parse(workOrders).ok).toBe(true)
    })

    it("update_design dry_run shows the current design and does not mutate it", async () => {
      const designId = await createDesign("Original Design Name")

      const preview = await callTool("update_design", {
        id: designId,
        name: "Renamed Design",
        priority: "Urgent",
        dry_run: true,
      })
      const previewPayload = parse(preview)
      expect(previewPayload.dry_run).toBe(true)
      expect(previewPayload.plan.method).toBe("PUT")
      expect(previewPayload.plan.path).toBe(`/admin/designs/${designId}`)
      expect(previewPayload.current.design.name).toBe("Original Design Name")

      const unchanged = await callTool("get_design", { id: designId })
      expect(parse(unchanged).data.design.name).toBe("Original Design Name")

      const updated = await callTool("update_design", {
        id: designId,
        name: "Renamed Design",
        priority: "Urgent",
        confirm: true,
      })
      expect(parse(updated).ok).toBe(true)

      const refetched = await callTool("get_design", { id: designId })
      expect(parse(refetched).data.design.name).toBe("Renamed Design")
    })

    it("update_design writes size_sets — the field no other tool can set", async () => {
      const designId = await createDesign(`Sized Design ${Date.now()}`)

      const res = await callTool("update_design", {
        id: designId,
        size_sets: [
          { size_label: "M", measurements: { chest: 100, length: 70 } },
          { size_label: "L", measurements: { chest: 108, length: 72 } },
        ],
        confirm: true,
      })
      expect(parse(res).ok).toBe(true)

      const refetched = await callTool("get_design", { id: designId })
      const sizeSets = parse(refetched).data.design.size_sets
      expect(sizeSets).toHaveLength(2)
      expect(sizeSets.map((s: any) => s.size_label).sort()).toEqual(["L", "M"])
    })

    it("create_production_run + get_production_run round-trips through the MCP surface", async () => {
      const designId = await createDesign(`Run Design ${Date.now()}`)

      const created = await callTool("create_production_run", {
        design_id: designId,
        quantity: 5,
        run_type: "sample",
        confirm: true,
      })
      const createdPayload = parse(created)
      expect(createdPayload.ok).toBe(true)
      const runId =
        createdPayload.data.production_run.id
      expect(runId).toBeTruthy()

      const got = await callTool("get_production_run", { id: runId })
      const run = parse(got).data.production_run
      expect(run.id).toBe(runId)
      expect(Number(run.quantity)).toBe(5)
      expect(run.run_type).toBe("sample")

      // The list filters we declared actually work against the route.
      const filtered = await callTool("list_production_runs", {
        design_id: designId,
        run_type: "sample",
      })
      const ids = parse(filtered).data.production_runs.map((r: any) => r.id)
      expect(ids).toContain(runId)
    })

    it("update_production_run is gated on confirm and previews the current run", async () => {
      const designId = await createDesign(`Editable Run Design ${Date.now()}`)
      const created = await callTool("create_production_run", {
        design_id: designId,
        quantity: 3,
        confirm: true,
      })
      const runId =
        parse(created).data.production_run?.id

      const preview = await callTool("update_production_run", {
        id: runId,
        quantity: 9,
        dry_run: true,
      })
      const previewPayload = parse(preview)
      expect(previewPayload.dry_run).toBe(true)
      expect(previewPayload.plan.path).toBe(`/admin/production-runs/${runId}`)
      const currentRun =
        previewPayload.current.production_run
      expect(Number(currentRun.quantity)).toBe(3)

      const updated = await callTool("update_production_run", {
        id: runId,
        quantity: 9,
        confirm: true,
      })
      expect(parse(updated).ok).toBe(true)

      const refetched = await callTool("get_production_run", { id: runId })
      const run = parse(refetched).data.production_run
      expect(Number(run.quantity)).toBe(9)
    })

    it("get_production_run_policy reads the lifecycle transition policy", async () => {
      const res = await callTool("get_production_run_policy", {})
      const payload = parse(res)
      expect(payload.ok).toBe(true)
      expect(payload.data).toBeDefined()
    })

    it("order fulfillment tools plan a correct request without executing (dry_run)", async () => {
      const res = await callTool("create_order_fulfillment", {
        id: "order_01TEST",
        items: [{ id: "ordli_01TEST", quantity: 1 }],
        location_id: "sloc_01TEST",
        dry_run: true,
      })
      const payload = parse(res)
      expect(payload.dry_run).toBe(true)
      expect(payload.plan.method).toBe("POST")
      expect(payload.plan.path).toBe("/admin/orders/order_01TEST/fulfillments")
      expect(payload.plan.body.items).toHaveLength(1)
      expect(payload.plan.body.location_id).toBe("sloc_01TEST")
      expect(payload.warning).toMatch(/sensitive/i)
    })

    it("the staged order-edit loop requires confirmation at every step", async () => {
      for (const [name, args] of [
        ["create_order_edit", { order_id: "order_01TEST" }],
        ["add_order_edit_items", { id: "ordch_01TEST", items: [{ variant_id: "v", quantity: 1 }] }],
        ["request_order_edit", { id: "ordch_01TEST" }],
      ] as const) {
        const payload = parse(await callTool(name, args as Record<string, unknown>))
        expect(payload.requires_confirmation).toBe(true)
      }
    })
  })
})
