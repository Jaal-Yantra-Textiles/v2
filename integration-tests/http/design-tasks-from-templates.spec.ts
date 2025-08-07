import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

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
  category: "Material Sourcing"
}

const productionPlanningTemplate = {
  name: "Production Planning Template",
  description: "Master template for production planning",
  priority: "high",
  estimated_duration: 720,
  required_fields: {
    "production_quantity": { type: "number", required: true },
    "target_completion": { type: "date", required: true }
  },
  eventable: true,
  notifiable: true,
  metadata: {
    type: "planning",
    department: "production"
  },
  category: "Production Planning"
};

const qualityControlTemplate = {
  name: "Quality Control Template",
  description: "Template for quality control checks",
  priority: "high",
  estimated_duration: 120,
  required_fields: {
    "quality_standards": { type: "string", required: true },
    "inspection_points": { type: "array", required: true }
  },
  eventable: true,
  notifiable: true,
  metadata: {
    type: "quality",
    department: "quality_control"
  },
  category: "Quality Control"
};

setupSharedTestSuite(() => {
 
    let headers
    let designId
    let templateIds = {
      pattern: "",
      fabric: "",
      production: "",
      quality: ""
    }
    const { api, getContainer } = getSharedTestEnv();
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

      const productionResponse = await api.post("/admin/task-templates", productionPlanningTemplate, headers)
      expect(productionResponse.status).toBe(201)
      templateIds.production = productionResponse.data.task_template.id

      const qualityResponse = await api.post("/admin/task-templates", qualityControlTemplate, headers)
      expect(qualityResponse.status).toBe(201)
      templateIds.quality = qualityResponse.data.task_template.id
    })
  
    describe("POST /admin/designs/:id/tasks", () => {
      it("should create tasks from templates with template values", async () => {
        const response = await api.post(
          `/admin/designs/${designId}/tasks`,
          {
            type: "template",
            template_names: [patternMakingTemplate.name, fabricSourcingTemplate.name]
          },
          headers
        )
      
        expect(response.status).toBe(200)
        expect(response.data.taskLinks.count).toBe(2)
        expect(response.data.message).toContain(`Design ${designId} successfully created 2 tasks from templates`)
  
        // Verify tasks were created with correct properties
        const tasksList = response.data.taskLinks.list
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
            type: "template",
            template_names: [patternMakingTemplate.name, patternMakingTemplate.name]
          },
          headers
        )
  
        expect(response.status).toBe(200)
        expect(response.data.taskLinks.count).toBe(1)
        expect(response.data.message).toContain(`Design ${designId} successfully created 1 tasks from templates`)
      })
  
      it("should handle non-existent template names", async () => {
        await expect(
          api.post(
            `/admin/designs/${designId}/tasks`,
            {
              type: "template",
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
              type: "template",
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
              type: "template",
              template_names: []
            },
            headers
          )
        } catch (error) {
          console.log(error.response.data)
          expect(error.response.data).toEqual({
            message: "Invalid request: Value for field 'template_names' too small, expected at least: '1'"
          })
        }
      })
    })

    describe("Parent-Child Task Creation", () => {
      let designId;
      let productionTemplateId;
      let qualityTemplateId;

      beforeEach(async () => {
        // Create design
        const designResponse = await api.post("/admin/designs", testDesign, headers);
        designId = designResponse.data.design.id;

        // Use existing template IDs
        productionTemplateId = templateIds.production;
        qualityTemplateId = templateIds.quality;
      });

      it("should create multiple parent tasks with child tasks", async () => {
        // First parent-child structure
        const productionTask = {
          type: "template",
          template_names: ["Production Planning Template"],
          child_tasks: [
            { 
              type: "task",
              title: "Material Preparation", 
              priority: "high",
              dependency_type: "subtask" 
            },
            { 
              type: "task",
              title: "Production Schedule", 
              priority: "medium",
              dependency_type: "subtask" 
            }
          ],
          dependency_type: "blocking"
        }

        const productionResponse = await api.post(
          `/admin/designs/${designId}/tasks`,
          productionTask,
          headers
        )

        // Second parent-child structure
        const qualityTask = {
          type: "template",
          template_names: ["Quality Control Template"],
          child_tasks: [
            { 
              type: "task",
              title: "Initial Inspection", 
              priority: "high",
              dependency_type: "subtask" 
            },
            { 
              type: "task",
              title: "Mid-Production Check", 
              priority: "medium",
              dependency_type: "subtask" 
            },
            { 
              type: "task",
              title: "Final Quality Check", 
              priority: "high",
              dependency_type: "subtask" 
            }
          ],
          dependency_type: "blocking"
        }

        const qualityResponse = await api.post(
          `/admin/designs/${designId}/tasks`,
          qualityTask,
          headers
        )

        // Verify both responses have correct structure
        for (const response of [productionResponse, qualityResponse]) {
          expect(response.status).toBe(200);
          expect(response.data.taskLinks).toEqual(
            expect.objectContaining({
              list: expect.arrayContaining([
                expect.objectContaining({
                  id: expect.any(String),
                  title: expect.any(String),
                  start_date: expect.any(String),
                  status: expect.any(String),
                  subtasks: expect.arrayContaining([
                    expect.objectContaining({
                      id: expect.any(String),
                      title: expect.any(String),
                      parent_task_id: expect.any(String),
                      priority: expect.any(String)
                    })
                  ])
                })
              ]),
              count: expect.any(Number)
            })
          );
        }

        // Verify specific counts
        expect(productionResponse.data.taskLinks.list[0].subtasks).toHaveLength(2);
        expect(qualityResponse.data.taskLinks.list[0].subtasks).toHaveLength(3);

        // Verify parent-child relationships
        const verifyParentChild = (response: any) => {
          const parent = response.data.taskLinks.list[0];
          const children = parent.subtasks;
          
          children.forEach((child: any) => {
            expect(child.parent_task_id).toBe(parent.id);
          });
        };

        verifyParentChild(productionResponse);
        verifyParentChild(qualityResponse);
      });

      it("should create parent and child tasks both from templates", async () => {
        const taskData = {
          type: "template",
          template_names: [productionPlanningTemplate.name],
          metadata: {
            production_quantity: 1000,
            target_completion: "2025-07-30"
          },
          child_tasks: [
            {
              type: "template",
              template_names: [qualityControlTemplate.name],
              metadata: {
                quality_standards: "ISO 9001",
                inspection_points: ["stitching", "fabric", "finish"]
              },
              dependency_type: "subtask"
            }
          ]
        };

        const response = await api.post(
          `/admin/designs/${designId}/tasks`,
          taskData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.taskLinks.count).toBe(1);
        
        const parentTask = response.data.taskLinks.list[0];
        
        // Verify parent task properties
        expect(parentTask).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            title: productionPlanningTemplate.name,
            description: productionPlanningTemplate.description,
            status: "pending",
            priority: "high",
            eventable: true,
            notifiable: true,
            parent_task_id: null,
            metadata: expect.objectContaining({
              department: "production",
              type: "planning",
              production_quantity: 1000,
              target_completion: "2025-07-30",
              template_id: expect.any(String),
              template_name: productionPlanningTemplate.name
            }),
            start_date: expect.any(String),
            end_date: expect.any(String),
            created_at: expect.any(String),
            updated_at: expect.any(String),
            completed_at: null,
            deleted_at: null,
            assigned_by: null,
            assigned_to: null,
            message: null
          })
        );

        // Verify child task properties
        expect(parentTask.subtasks).toHaveLength(1);
        const childTask = parentTask.subtasks[0];
        expect(childTask).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            parent_task_id: parentTask.id,
            status: "pending",
            priority: "high",
            title: expect.any(String),
            created_at: expect.any(String),
            updated_at: expect.any(String),
            start_date: expect.any(String),
            completed_at: null,
            deleted_at: null,
            assigned_by: null,
            assigned_to: null,
            message: null,
            eventable: false,
            notifiable: false
          })
        );
      });
    }); 
})
