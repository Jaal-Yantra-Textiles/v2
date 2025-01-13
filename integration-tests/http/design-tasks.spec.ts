import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { resolve } from "path"

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
  category: {
    name: "Pattern Development",
    description: "Tasks related to pattern creation and grading"
  }
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
        {
          template_names: [patternMakingTemplate.name]
        },
        headers
      )
      expect(taskResponse.status).toBe(200)
      taskIds = taskResponse.data.taskLinks.list.map(task => task.id)
      
    })

    describe("GET /admin/designs/:id/tasks", () => {
      it("should list all tasks for a design", async () => {
        const response = await api.get(
          `/admin/designs/${designId}/tasks`,
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data.tasks).toBeDefined()
        expect(response.data.tasks).toHaveLength(1)

        const task = response.data.tasks[0]
        expect(task).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            title: patternMakingTemplate.name,
            description: patternMakingTemplate.description,
            priority: patternMakingTemplate.priority,
            eventable: patternMakingTemplate.eventable,
            notifiable: patternMakingTemplate.notifiable,
            metadata: expect.objectContaining({
              type: patternMakingTemplate.metadata.type,
              department: patternMakingTemplate.metadata.department
            })
          })
        )
      })

      it("should return empty array for design with no tasks", async () => {
        // Create a new design without tasks
        const newDesignResponse = await api.post("/admin/designs", {
          ...testDesign,
          name: "Design without tasks"
        }, headers)
        const newDesignId = newDesignResponse.data.design.id

        const response = await api.get(
          `/admin/designs/${newDesignId}/tasks`,
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data.tasks).toBeDefined()
        expect(response.data.tasks).toHaveLength(0)
      })

      it("should handle non-existent design id", async () => {
        const response = await api.get(
          `/admin/designs/non-existent-id/tasks`,
          headers
        ).catch(err => err.response)

        expect(response.status).toBe(404)
        expect(response.data.message).toBe("Design with id non-existent-id was not found")
      })
    })

    describe("GET /admin/designs/:id/tasks/:taskId", () => {
      it("should get a single task", async () => {
        const response = await api.get(
          `/admin/designs/${designId}/tasks/${taskIds[0]}`,
          headers
        )
        
        expect(response.status).toBe(200)
        expect(response.data.task).toBeDefined()
        expect(response.data.task).toEqual(
          expect.objectContaining({
            id: taskIds[0],
            title: patternMakingTemplate.name,
            description: patternMakingTemplate.description,
            priority: patternMakingTemplate.priority,
            eventable: patternMakingTemplate.eventable,
            notifiable: patternMakingTemplate.notifiable,
            metadata: expect.objectContaining({
              type: patternMakingTemplate.metadata.type,
              department: patternMakingTemplate.metadata.department
            })
          })
        )
      })

      it("should handle non-existent task id", async () => {
        const response = await api.get(
          `/admin/designs/${designId}/tasks/non-existent-id`,
          headers
        ).catch(err => err.response)

        expect(response.status).toBe(404)
        expect(response.data.message).toBe(`Task with id non-existent-id not found in design ${designId}`)
      })
    })

    describe("POST /admin/designs/:id/tasks/:taskId", () => {
      it("should update a task", async () => {
        const updateData = {
          title: "Updated Pattern Task",
          description: "Updated task description",
          priority: "low",
          status: "in_progress",
          eventable: false,
          notifiable: false,
          metadata: {
            type: "updated",
            department: "design"
          }
        }

        const response = await api.post(
          `/admin/designs/${designId}/tasks/${taskIds[0]}`,
          updateData,
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data.task).toBeDefined()
        expect(response.data.task).toEqual(
          expect.objectContaining({
            id: taskIds[0],
            ...updateData,
            metadata: expect.objectContaining(updateData.metadata)
          })
        )

        // Verify changes persisted
        const getResponse = await api.get(
          `/admin/designs/${designId}/tasks/${taskIds[0]}`,
          headers
        )
        expect(getResponse.data.task).toEqual(
          expect.objectContaining({
            id: taskIds[0],
            ...updateData,
            metadata: expect.objectContaining(updateData.metadata)
          })
        )
      })

      it("should partially update a task", async () => {
        const partialUpdate = {
          title: "Partially Updated Task",
          priority: "medium"
        }

        const response = await api.post(
          `/admin/designs/${designId}/tasks/${taskIds[0]}`,
          partialUpdate,
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data.task).toBeDefined()
        expect(response.data.task).toEqual(
          expect.objectContaining({
            id: taskIds[0],
            ...partialUpdate
          })
        )
      })

      it("should handle non-existent task id", async () => {
        const response = await api.post(
          `/admin/designs/${designId}/tasks/non-existent-id`,
          { title: "Updated Title" },
          headers
        ).catch(err => err.response)

        expect(response.status).toBe(404)
        expect(response.data.message).toBe(`Task with id non-existent-id not found in design ${designId}`)
      })
    })

    describe("DELETE /admin/designs/:id/tasks/:taskId", () => {
      it("should delete a task", async () => {
        const response = await api.delete(
          `/admin/designs/${designId}/tasks/${taskIds[0]}`,
          headers
        )

        expect(response.status).toBe(200)
        expect(response.data).toEqual({
          id: taskIds[0],
          object: "task",
          deleted: true
        })

        // Verify task is deleted
        const getResponse = await api.get(
          `/admin/designs/${designId}/tasks/${taskIds[0]}`,
          headers
        ).catch(err => err.response)

        expect(getResponse.status).toBe(404)
        expect(getResponse.data.message).toBe(`Task with id ${taskIds[0]} not found in design ${designId}`)
      })

      it("should handle non-existent task id", async () => {
        const response = await api.delete(
          `/admin/designs/${designId}/tasks/non-existent-id`,
          headers
        ).catch(err => err.response)

        expect(response.status).toBe(404)
        expect(response.data.message).toBe(`Task with id non-existent-id not found in design ${designId}`)
      })

      it("should handle non-existent design id", async () => {
        const response = await api.delete(
          `/admin/designs/non-existent-id/tasks/${taskIds[0]}`,
          headers
        ).catch(err => err.response)

        expect(response.status).toBe(404)
        expect(response.data.message).toBe("Design with id non-existent-id was not found")
      })
    })
  }
})
