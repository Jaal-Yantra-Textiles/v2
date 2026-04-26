import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("Task Cost Flow — template → task cost inheritance & admin visibility", () => {
    const { api, getContainer } = getSharedTestEnv()

    async function setupTestData() {
      const container = getContainer()
      const unique = Date.now()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      return { adminHeaders, unique, container }
    }

    async function createDesign(adminHeaders: any, unique: number) {
      const res = await api.post(
        "/admin/designs",
        {
          name: `TaskCost Design ${unique}`,
          description: "Design for task cost test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    // ── Test 1: Template with cost stores estimated_cost ──

    it("should create task template with estimated_cost and cost_currency", async () => {
      const { adminHeaders, unique } = await setupTestData()

      const templateRes = await api.post(
        "/admin/task-templates",
        {
          name: `embroidery-${unique}`,
          description: "Machine embroidery work",
          priority: "medium",
          estimated_duration: 120,
          estimated_cost: 200,
          cost_currency: "inr",
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Task Cost Test",
        },
        adminHeaders
      )
      expect(templateRes.status).toBe(201)
      expect(templateRes.data.task_template.estimated_cost).toBe(200)
      expect(templateRes.data.task_template.cost_currency).toBe("inr")
    })

    // ── Test 2: Template without cost — backward compat ──

    it("should create template without cost fields (backward compatible)", async () => {
      const { adminHeaders, unique } = await setupTestData()

      const templateRes = await api.post(
        "/admin/task-templates",
        {
          name: `plain-${unique}`,
          description: "No cost template",
          priority: "medium",
          estimated_duration: 30,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Task Cost Test",
        },
        adminHeaders
      )
      expect(templateRes.status).toBe(201)
      expect(templateRes.data.task_template.estimated_cost).toBeNull()
      expect(templateRes.data.task_template.cost_currency).toBeNull()
    })

    // ── Test 3: Task inherits cost via createTaskWithTemplates (service-level test) ──

    it("should propagate estimated_cost from template to task via service", async () => {
      const { adminHeaders, unique, container } = await setupTestData()

      // Create template with cost
      const templateRes = await api.post(
        "/admin/task-templates",
        {
          name: `inherit-test-${unique}`,
          description: "Cost inheritance test",
          priority: "high",
          estimated_duration: 60,
          estimated_cost: 500,
          cost_currency: "usd",
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Task Cost Test",
        },
        adminHeaders
      )
      expect(templateRes.status).toBe(201)
      const templateId = templateRes.data.task_template.id

      // Use service directly to create task from template (avoids workflow engine)
      const taskService = container.resolve("tasks") as any
      const createdTasks = await taskService.createTaskWithTemplates({
        template_ids: [templateId],
        metadata: { test: true },
      })

      expect(createdTasks).toBeDefined()
      expect(createdTasks.length).toBe(1)
      expect(createdTasks[0].estimated_cost).toBe(500)
      expect(createdTasks[0].cost_currency).toBe("usd")
      expect(createdTasks[0].title).toBe(`inherit-test-${unique}`)
    })

    // ── Test 4: actual_cost stored on task via service update ──

    it("should store actual_cost on task when updated via service", async () => {
      const { adminHeaders, unique, container } = await setupTestData()

      // Create template
      const templateRes = await api.post(
        "/admin/task-templates",
        {
          name: `actual-cost-${unique}`,
          description: "Test actual cost",
          priority: "medium",
          estimated_duration: 60,
          estimated_cost: 300,
          cost_currency: "inr",
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Task Cost Test",
        },
        adminHeaders
      )
      const templateId = templateRes.data.task_template.id

      // Create task from template
      const taskService = container.resolve("tasks") as any
      const [task] = await taskService.createTaskWithTemplates({
        template_ids: [templateId],
        metadata: { test: true },
      })
      expect(task.estimated_cost).toBe(300)

      // Simulate partner finishing the task with actual_cost
      await taskService.updateTasks({
        id: task.id,
        actual_cost: 275,
        cost_type: "total",
        status: "completed",
        completed_at: new Date(),
      })

      // Verify
      const updated = await taskService.retrieveTask(task.id)
      expect(updated.actual_cost).toBe(275)
      expect(updated.cost_type).toBe("total")
      expect(updated.estimated_cost).toBe(300)
      expect(updated.status).toBe("completed")
    })

    // ── Test 5: Multiple task costs aggregate correctly ──

    it("should aggregate multiple task costs", async () => {
      const { container } = await setupTestData()
      const taskService = container.resolve("tasks") as any

      // Create templates directly via service (avoids HTTP auth issues)
      const t1 = await taskService.createTaskTemplates({
        name: "agg-embroidery",
        description: "Embroidery",
        priority: "medium",
        estimated_duration: 120,
        estimated_cost: 200,
        cost_currency: "inr",
      })
      const t2 = await taskService.createTaskTemplates({
        name: "agg-buttons",
        description: "Button work",
        priority: "low",
        estimated_duration: 30,
        estimated_cost: 50,
        cost_currency: "inr",
      })
      const t3 = await taskService.createTaskTemplates({
        name: "agg-cutting",
        description: "Cutting — no cost",
        priority: "medium",
        estimated_duration: 60,
      })

      const tasks = await taskService.createTaskWithTemplates({
        template_ids: [t1.id, t2.id, t3.id],
        metadata: { production_run_id: "fake_run_test" },
      })

      expect(tasks.length).toBe(3)

      // Simulate completing with actual costs
      await taskService.updateTasks({ id: tasks[0].id, actual_cost: 180, status: "completed" })
      await taskService.updateTasks({ id: tasks[1].id, actual_cost: 55, status: "completed" })
      await taskService.updateTasks({ id: tasks[2].id, status: "completed" })

      // Aggregate: actual_cost where available, estimated where not, 0 for no cost
      const allTasks = await Promise.all(
        tasks.map((t: any) => taskService.retrieveTask(t.id))
      )
      const totalCost = allTasks.reduce((sum: number, t: any) => {
        return sum + (Number(t.actual_cost) || Number(t.estimated_cost) || 0)
      }, 0)

      // 180 (actual) + 55 (actual) + 0 (no cost) = 235
      expect(totalCost).toBe(235)
    })
  })
})
