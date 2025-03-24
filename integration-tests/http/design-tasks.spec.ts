import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"


jest.setTimeout(30000)

const testDesign = {
  name: "Summer Collection 2025",
  description: "Lightweight summer wear collection",
  design_type: "Original",
  status: "Conceptual",
  priority: "High",
  target_completion_date: new Date("2025-06-30"),
  tags: ["summer", "casual", "lightweight"],
  metadata: {
    season: "Summer 2025",
    collection: "Coastal Breeze"
  }
}

const patternMakingTemplate = {
  name: "Pattern Making Template",
  description: "Template for creating garment patterns",
  priority: "high",
  estimated_duration: 240,
  required_fields: {
    "size_range": { type: "string", required: true },
    "fabric_type": { type: "string", required: true },
    "pattern_complexity": { type: "enum", options: ["low", "medium", "high"], required: true }
  },
  eventable: true,
  notifiable: true,
  metadata: {
    type: "technical",
    department: "pattern_making"
  },
  category: "Pattern Development"
}

const sampleTaskPayload = {
  type: "template" as const,
  template_names: ["Pattern Making Template"],
  child_tasks: [
    {
      title: "Size Grading",
      description: "Grade pattern for all sizes",
      priority: "medium" as const,
      status: "pending" as const,
      dependency_type: "subtask" as const
    }
  ]
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers
    let designId
    let templateIds: any = []
    let taskIds = []

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)

      // Create design
      const designResponse = await api.post("/admin/designs", testDesign, headers)
      expect(designResponse.status).toBe(201)
      designId = designResponse.data.design.id

      // Create task template
      const templateResponse = await api.post("/admin/task-templates", patternMakingTemplate, headers)
      expect(templateResponse.status).toBe(201)
      templateIds.push(templateResponse.data.task_template.id)

      // Create tasks from template
      const taskResponse = await api.post(
        `/admin/designs/${designId}/tasks`,
        sampleTaskPayload,
        headers
      )
      expect(taskResponse.status).toBe(200)
      taskIds = taskResponse.data.taskLinks.list.map(task => task.id)
    })

    describe("POST /admin/designs/:id/tasks", () => {
      it("should create tasks with child tasks", async () => {
        const payload = {
          type: "template" as const,
          template_names: ["Pattern Making Template"],
          child_tasks: [
            {
              title: "Size Grading",
              description: "Grade pattern for all sizes",
              priority: "medium" as const,
              status: "pending" as const,
              dependency_type: "subtask" as const
            },
            {
              title: "Pattern Testing",
              description: "Test pattern fit",
              priority: "high" as const,
              status: "pending" as const,
              dependency_type: "subtask" as const
            }
          ]
        }

        const response = await api.post(
          `/admin/designs/${designId}/tasks`,
          payload,
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data.taskLinks).toBeDefined()
        expect(Array.isArray(response.data.taskLinks.list)).toBe(true)
        expect(response.data.taskLinks.list).toHaveLength(1)

        const mainTask = response.data.taskLinks.list[0]
        expect(mainTask).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            title: patternMakingTemplate.name,
            description: patternMakingTemplate.description,
            status: "pending",
            priority: "high",
            eventable: true,
            notifiable: true,
            metadata: expect.objectContaining({
              type: "technical",
              department: "pattern_making",
              template_id: expect.any(String),
              template_name: "Pattern Making Template"
            }),
            parent_task_id: null,
            subtasks: expect.arrayContaining([
              expect.any(Object),
              expect.any(Object)
            ])
          })
        )

        // Verify dates
        expect(mainTask.start_date).toBeDefined()
        expect(mainTask.end_date).toBeDefined()
        expect(mainTask.created_at).toBeDefined()
        expect(mainTask.updated_at).toBeDefined()
        expect(mainTask.completed_at).toBeNull()
        expect(mainTask.deleted_at).toBeNull()
      })

      it("should fail when template_names is empty", async () => {
        const payload = {
          type: "template" as const,
          template_names: []
        }

        const response = await api.post(
          `/admin/designs/${designId}/tasks`,
          payload,
          headers
        ).catch(err => err.response)

        expect(response.status).toBe(400)
        expect(response.data).toEqual({
           message: "too_small At least one template name is required (at path: template_names)"
        })
      })

      it("should fail with invalid dependency_type", async () => {
        const payload = {
          type: "template" as const,
          template_names: ["Pattern Making Template"],
          child_tasks: [
            {
              title: "Invalid Child Task",
              dependency_type: "invalid_type"
            }
          ]
        }

        const response = await api.post(
          `/admin/designs/${designId}/tasks`,
          payload,
          headers
        ).catch(err => err.response)

        expect(response.status).toBe(400)
        const error = response.data
        expect(error.message).toBe("invalid_enum_value Invalid enum value. Expected 'blocking' | 'non_blocking' | 'subtask' | 'related', received 'invalid_type' (at path: child_tasks.0.dependency_type)")
      
      })
    })

    describe("GET /admin/designs/:id/tasks", () => {
      it("should list all tasks for a design", async () => {
        const response = await api.get(
          `/admin/designs/${designId}/tasks`,
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data.tasks).toBeDefined()
        expect(response.data.tasks.length).toBeGreaterThan(0)

        const task = response.data.tasks[0]
        expect(task).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            title: patternMakingTemplate.name,
            description: patternMakingTemplate.description,
            status: "pending",
            priority: "high",
            eventable: true,
            notifiable: true,
            metadata: expect.objectContaining({
              type: "technical",
              department: "pattern_making"
            })
          })
        )
      })
    })
  }
})
