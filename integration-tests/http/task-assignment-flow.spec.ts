import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_EMAIL = "admin@medusa-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

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

const taskTemplates = [
  {
    name: "Pattern Making",
    description: "Create garment patterns",
    priority: "high",
    estimated_duration: 240,
    required_fields: {
      "size_range": { type: "string", required: true },
      "fabric_type": { type: "string", required: true }
    },
    eventable: true
  },
  {
    name: "Sample Stitching",
    description: "Stitch sample garment",
    priority: "medium",
    estimated_duration: 480,
    required_fields: {
      "size": { type: "string", required: true },
      "fabric_provided": { type: "boolean", required: true }
    },
    eventable: true
  }
]

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: any
    let partnerHeaders: any
    let designId: string
    let tasks: any[]
    let partnerId: string

    beforeAll(async () => {
      // Create and login as admin
      const container = getContainer();
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Register partner admin
      await api.post("/auth/partner/emailpass/register", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })

      // Login to get initial token
      const authResponse = await api.post("/auth/partner/emailpass", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })

      // Set up headers with the token
      partnerHeaders = {
        Authorization: `Bearer ${authResponse.data.token}`,
      }

      // Create a partner with the authenticated admin
      const partnerResponse = await api.post(
        "/partners",
        {
          name: "Test Partner Company",
          handle: "test-partner",
          admin: {
            email: TEST_PARTNER_EMAIL,
            first_name: "Test",
            last_name: "Partner"
          }
        },
        { headers: partnerHeaders }
      )

      
      partnerId = partnerResponse.data.partner.id

      // Get fresh token after partner creation
      const newAuthResponse = await api.post("/auth/partner/emailpass", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })

      // Update headers with new token
      partnerHeaders = {
        Authorization: `Bearer ${newAuthResponse.data.token}`,
      }
    })

    describe("Task Assignment Flow", () => {
      test("should complete full task assignment flow", async () => {
        console.log("Starting task assignment flow test...")

        // 1. Create a design
        console.log("Creating design...")
        const designResponse = await api.post(
          "/admin/designs",
          testDesign,
          adminHeaders
        )
        console.log("Design response:", designResponse.data)
        expect(designResponse.status).toBe(201)
        designId = designResponse.data.design.id

        // 2. Create task templates
        console.log("\nCreating task templates...")
        const templateIds: string[] = []
        for (const template of taskTemplates) {
          const templateResponse = await api.post(
            "/admin/task-templates",
            template,
            adminHeaders
          )
          expect(templateResponse.status).toBe(201)
          templateIds.push(templateResponse.data.task_template.id)
        }

        // Create tasks using template names
        console.log("\nCreating tasks from templates...")
        const taskResponse = await api.post(
          `/admin/designs/${designId}/tasks`,
          {
            type: "template",
            template_names: taskTemplates.map((t): string => t.name),
            required_fields: {
              size_range: "S-XL",
              fabric_type: "Cotton",
              size: "M",
              fabric_provided: true
            }
          },
          adminHeaders
        )
        expect(taskResponse.status).toBe(200)
        expect(taskResponse.data.taskLinks).toBeDefined()
        expect(taskResponse.data.taskLinks.list).toHaveLength(taskTemplates.length)
        tasks = taskResponse.data.taskLinks.list

        // 4. Assign tasks to partner
        console.log("\nAssigning tasks to partner...")
        for (const task of tasks) {
          console.log(`Assigning task ${task.id}...`)
          const assignResponse = await api.post(
            `/admin/designs/${designId}/tasks/${task.id}/assign`,
            {
              taskId: task.id,
              partnerId: partnerId // Fixed typo in partnerId
            },
           adminHeaders
          )
          console.log(JSON.stringify(assignResponse.data, null, 2))
          expect(assignResponse.status).toBe(200)
          expect(assignResponse.data.task).toBeDefined()
          expect(assignResponse.data.task.partner.id).toBe(partnerId)
        }

        // 5. Accept tasks as partner
        console.log("\nAccepting tasks as partner...")
        for (const task of tasks) {
          console.log(`Accepting task ${task.id}...`)
          
          try {
            const acceptResponse = await api.post(
              `/partners/tasks/${task.id}/accept`,
              {},
              {headers: partnerHeaders}
            )
            
            expect(acceptResponse.status).toBe(200)
            expect(acceptResponse.data.task).toBeDefined()
            expect(acceptResponse.data.task.status).toBe("accepted")
          } catch (error) {
            console.error(`Error accepting task ${task.id}:`, {
              status: error.response?.status,
              data: error.response?.data,
              headers: error.response?.headers
            });
            throw error;
          }
        }
        console.log("\Finishing tasks as partner...")
        for (const task of tasks) {
          console.log(`Finishing task ${task.id}...`)
          
          try {
            const acceptResponse = await api.post(
              `/partners/tasks/${task.id}/finish`,
              {},
              {headers: partnerHeaders}
            )
            
            expect(acceptResponse.status).toBe(200)
            expect(acceptResponse.data.task).toBeDefined()
            expect(acceptResponse.data.task.status).toBe("completed")
          } catch (error) {
            console.error(`Error accepting task ${task.id}:`, {
              status: error.response?.status,
              data: error.response?.data,
              headers: error.response?.headers
            });
            throw error;
          }
        }
      })
    })
  }
})
