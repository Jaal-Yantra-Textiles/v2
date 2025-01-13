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
  category: {
    name: "Pattern Development",
    description: "Tasks related to pattern creation and grading"
  }
}

const fabricSourcingTemplate = {
  name: "Fabric Sourcing Template",
  description: "Template for sourcing fabric materials",
  priority: "medium",
  estimated_duration: 480,
  required_fields: {
    "fabric_requirements": { type: "string", required: true },
    "quantity_needed": { type: "number", required: true },
    "supplier_preferences": { type: "text", required: false }
  },
  eventable: true,
  notifiable: true,
  metadata: {
    type: "sourcing",
    department: "materials"
  },
  category: {
    name: "Material Sourcing",
    description: "Tasks related to fabric and material sourcing"
  }
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers
    let designId
    let templateIds = {
      pattern: "",
      fabric: ""
    }
  
    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container)
      headers = await getAuthHeaders(api)
  
      // Create design
      const designResponse = await api.post("/admin/designs", testDesign, headers)
      expect(designResponse.status).toBe(201)
      designId = designResponse.data.design.id

      // Create task templates
      const patternResponse = await api.post("/admin/task-templates", patternMakingTemplate, headers)
      expect(patternResponse.status).toBe(201)
      templateIds.pattern = patternResponse.data.task_template.id
  
      const fabricResponse = await api.post("/admin/task-templates", fabricSourcingTemplate, headers)
      expect(fabricResponse.status).toBe(201)
      templateIds.fabric = fabricResponse.data.task_template.id
    })
  
    describe("POST /admin/designs/:id/tasks", () => {
      it("should create tasks from templates with template values", async () => {
        const response = await api.post(
          `/admin/designs/${designId}/tasks`,
          {
            template_names: [patternMakingTemplate.name, fabricSourcingTemplate.name]
          },
          headers
        )
  
        expect(response.status).toBe(200)
        expect(response.data.taskLinks.count).toBe(2)
        expect(response.data.message).toContain(`Design ${designId} successfully created 2 tasks from templates`)
  
        // Verify tasks were created with correct properties
        const tasksList = response.data.taskLinks.list[1]
        expect(tasksList).toHaveLength(2)
  
        const tasks = tasksList.map(task => ({
          title: task.title,
          priority: task.priority,
          estimated_duration: task.estimated_duration,
          eventable: task.eventable,
          notifiable: task.notifiable,
          metadata: task.metadata
        }))

        // Verify template-specific values
        const patternTask = tasks.find(t => t.title === patternMakingTemplate.name)
        expect(patternTask.priority).toBe(patternMakingTemplate.priority)
        expect(patternTask.eventable).toBe(patternMakingTemplate.eventable)
        expect(patternTask.notifiable).toBe(patternMakingTemplate.notifiable)
        expect(patternTask.metadata.type).toBe("technical")
        expect(patternTask.metadata.department).toBe("pattern_making")

        const fabricTask = tasks.find(t => t.title === fabricSourcingTemplate.name)
        expect(fabricTask.priority).toBe(fabricSourcingTemplate.priority)
        expect(fabricTask.eventable).toBe(fabricSourcingTemplate.eventable)
        expect(fabricTask.notifiable).toBe(fabricSourcingTemplate.notifiable)
        expect(fabricTask.metadata.type).toBe("sourcing")
        expect(fabricTask.metadata.department).toBe("materials")
      })
  
      it("should handle duplicate template names", async () => {
        const response = await api.post(
          `/admin/designs/${designId}/tasks`,
          {
            template_names: [patternMakingTemplate.name, patternMakingTemplate.name]
          },
          headers
        )
  
        expect(response.status).toBe(200)
        expect(response.data.taskLinks.count).toBe(1)
        expect(response.data.message).toContain("duplicate template names were removed")
        expect(response.data.originalCount).toBe(2)
        expect(response.data.processedCount).toBe(1)
      })
  
      it("should handle non-existent template names", async () => {
        await expect(
          api.post(
            `/admin/designs/${designId}/tasks`,
            {
              template_names: ["Non-existent Template"]
            },
            headers
          )
        ).rejects.toThrow()
      })
  
      it("should handle non-existent design id", async () => {
        await expect(
          api.post(
            `/admin/designs/non-existent-id/tasks`,
            {
              template_names: [patternMakingTemplate.name]
            },
            headers
          )
        ).rejects.toThrow()
      })

      it("should require at least one template name", async () => {
        try {
          await api.post(
            `/admin/designs/${designId}/tasks`,
            {
              template_names: []
            },
            headers
          )
        } catch (error) {
          
          expect(error.response.data.issues[0]).toEqual({
            code: "too_small",
            message: "At least one template name is required",
            path: "template_names"
          })
        }
      })
    })
  }
})
