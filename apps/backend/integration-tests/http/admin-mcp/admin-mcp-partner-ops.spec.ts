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

setupSharedTestSuite(() => {
  describe("Admin MCP — partner ops tools (#843: inspect + act on a partner via chat)", () => {
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
        name: `Partner Ops MCP ${unique}`,
        handle: `partner-ops-mcp-${unique}`,
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

    it("tools/list exposes the partner ops reads and writes", async () => {
      const res = await mcp(rpc("tools/list", {}))
      expect(res.status).toBe(200)
      const names = (res.data?.result?.tools ?? []).map((t: any) => t.name)

      for (const name of [
        "list_partner_tasks",
        "get_partner_task",
        "list_partner_feedbacks",
        "list_partner_people",
        "get_partner_fees",
        "get_partner_subscription",
        "create_partner_task",
        "update_partner_task",
        "create_partner_feedback",
        "link_partner_people",
        "create_partner_subscription",
      ]) {
        expect(names).toContain(name)
      }
    })

    it("list_partner_tasks reads back a task created via create_partner_task (confirm required)", async () => {
      const empty = await callTool("list_partner_tasks", { id: partnerId })
      expect(parse(empty).data.tasks).toEqual([])

      // Without confirm: sensitive write is only planned, never executed.
      const unconfirmed = await callTool("create_partner_task", {
        id: partnerId,
        title: "Inspect via chat",
      })
      const unconfirmedPayload = parse(unconfirmed)
      expect(unconfirmedPayload.requires_confirmation).toBe(true)
      expect(unconfirmedPayload.plan.method).toBe("POST")
      expect(unconfirmedPayload.plan.path).toBe(`/admin/partners/${partnerId}/tasks`)

      const stillEmpty = await callTool("list_partner_tasks", { id: partnerId })
      expect(parse(stillEmpty).data.tasks).toEqual([])

      // With confirm: executes for real against the wrapped route.
      const created = await callTool("create_partner_task", {
        id: partnerId,
        title: "Inspect via chat",
        priority: "high",
        confirm: true,
      })
      const createdPayload = parse(created)
      expect(createdPayload.ok).toBe(true)
      const taskId = createdPayload.data.task.id
      expect(taskId).toBeTruthy()

      const listed = await callTool("list_partner_tasks", { id: partnerId })
      const tasks = parse(listed).data.tasks
      expect(tasks).toHaveLength(1)
      expect(tasks[0].id).toBe(taskId)
      expect(tasks[0].title).toBe("Inspect via chat")

      const got = await callTool("get_partner_task", { id: partnerId, taskId })
      expect(parse(got).data.task.id).toBe(taskId)
    })

    it("update_partner_task dry_run previews the current task without mutating it", async () => {
      const created = await callTool("create_partner_task", {
        id: partnerId,
        title: "Original title",
        confirm: true,
      })
      const taskId = parse(created).data.task.id

      const preview = await callTool("update_partner_task", {
        id: partnerId,
        taskId,
        title: "New title",
        dry_run: true,
      })
      const previewPayload = parse(preview)
      expect(previewPayload.dry_run).toBe(true)
      expect(previewPayload.plan.path).toBe(`/admin/partners/${partnerId}/tasks/${taskId}`)
      expect(previewPayload.current.task.title).toBe("Original title")

      const stillOriginal = await callTool("get_partner_task", { id: partnerId, taskId })
      expect(parse(stillOriginal).data.task.title).toBe("Original title")

      const updated = await callTool("update_partner_task", {
        id: partnerId,
        taskId,
        title: "New title",
        confirm: true,
      })
      expect(parse(updated).ok).toBe(true)

      const refetched = await callTool("get_partner_task", { id: partnerId, taskId })
      expect(parse(refetched).data.task.title).toBe("New title")
    })

    it("create_partner_feedback writes a feedback entry visible via list_partner_feedbacks", async () => {
      const before = await callTool("list_partner_feedbacks", { id: partnerId })
      expect(parse(before).data.feedbacks).toEqual([])

      const res = await callTool("create_partner_feedback", {
        id: partnerId,
        rating: "five",
        comment: "Great work",
        status: "pending",
        submitted_by: "admin_test",
        submitted_at: new Date().toISOString(),
        confirm: true,
      })
      expect(parse(res).ok).toBe(true)

      const after = await callTool("list_partner_feedbacks", { id: partnerId })
      const feedbacks = parse(after).data.feedbacks
      expect(feedbacks).toHaveLength(1)
      expect(feedbacks[0].comment).toBe("Great work")
    })

    it("link_partner_people links a real person and shows up via list_partner_people", async () => {
      const container = getContainer()
      const personService: any = container.resolve("person")
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const person = await personService.createPeople({
        first_name: "Test",
        last_name: "Contact",
        email: `contact-${unique}@example.com`,
      })

      const before = await callTool("list_partner_people", { id: partnerId })
      expect(parse(before).data.people).toEqual([])

      const linked = await callTool("link_partner_people", {
        id: partnerId,
        person_ids: [person.id],
        confirm: true,
      })
      expect(parse(linked).ok).toBe(true)

      const after = await callTool("list_partner_people", { id: partnerId })
      const people = parse(after).data.people
      expect(people).toHaveLength(1)
      expect(people[0].id).toBe(person.id)
    })

    it("create_partner_subscription assigns a plan, readable via get_partner_subscription", async () => {
      const container = getContainer()
      const partnerPlanService: any = container.resolve("partnerPlan")
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const plan = await partnerPlanService.createPartnerPlans({
        name: `Free Plan ${unique}`,
        slug: `free-plan-${unique}`,
        price: 0,
        is_active: true,
      })

      const before = await callTool("get_partner_subscription", { id: partnerId })
      expect(parse(before).data.subscriptions).toEqual([])

      const assigned = await callTool("create_partner_subscription", {
        id: partnerId,
        plan_id: plan.id,
        confirm: true,
      })
      expect(parse(assigned).ok).toBe(true)

      const after = await callTool("get_partner_subscription", { id: partnerId })
      const subscriptions = parse(after).data.subscriptions
      expect(subscriptions).toHaveLength(1)
      expect(subscriptions[0].plan_id).toBe(plan.id)
    })

    it("get_partner_fees returns the (empty) fee ledger + summary roll-up for a fresh partner", async () => {
      const res = await callTool("get_partner_fees", { id: partnerId })
      const payload = parse(res)
      expect(payload.ok).toBe(true)
      expect(payload.data.fees).toEqual([])
      expect(payload.data.summary).toBeDefined()
    })
  })
})
