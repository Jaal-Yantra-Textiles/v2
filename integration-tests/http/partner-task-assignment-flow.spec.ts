import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const TEST_PARTNER_EMAIL = "partner-task-test@medusa-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(30000)

const testTasks = [
  {
    title: "Create Product Catalog",
    description: "Design and create a comprehensive product catalog for the new collection",
    priority: "high",
    status: "pending",
    due_date: new Date("2025-07-15"),
    metadata: {
      category: "Marketing",
      deliverable: "PDF Catalog"
    }
  },
  {
    title: "Quality Inspection",
    description: "Perform quality inspection on received fabric samples",
    priority: "medium",
    status: "pending",
    due_date: new Date("2025-06-30"),
    metadata: {
      category: "Quality Control",
      samples_count: 25
    }
  }
]

setupSharedTestSuite(() => {
  let adminHeaders: any
  let partnerHeaders: any
  let partnerId: string
  let createdTasks: any[] = []
  const { api, getContainer } = getSharedTestEnv()

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

    // Create a partner with the authenticated user
    const partnerResponse = await api.post(
      "/partners",
      {
        name: "Test Partner Company",
        handle: "test-partner-tasks",
        admin: {
          email: TEST_PARTNER_EMAIL,
          first_name: "Test",
          last_name: "Partner"
        }
      },
      { headers: partnerHeaders }
    )

    // IMPORTANT: Use the partner ID from the response
    // This is the actual partner entity that was created
    partnerId = partnerResponse.data.partner.id
    console.log("Created partner with ID:", partnerId)

    // Get fresh token after partner creation
    // The auth context should now be linked to this partner
    const newAuthResponse = await api.post("/auth/partner/emailpass", {
      email: TEST_PARTNER_EMAIL,
      password: TEST_PARTNER_PASSWORD,
    })

    // Update headers with new token
    partnerHeaders = {
      Authorization: `Bearer ${newAuthResponse.data.token}`,
    }
    
    console.log("Partner auth setup complete. Partner ID:", partnerId)
  })

  describe("Partner Task Assignment Flow", () => {
    test("should complete full standalone partner task flow", async () => {
      console.log("Starting standalone partner task assignment flow test...")

      // 1. Admin creates tasks for the partner
      console.log("\n1. Creating tasks for partner...")
      for (const taskData of testTasks) {
        const taskResponse = await api.post(
          `/admin/partners/${partnerId}/tasks`,
          taskData,
          adminHeaders
        )
        console.log("Task created:", taskResponse.data)
        expect(taskResponse.status).toBe(200)
        expect(taskResponse.data.task).toBeDefined()
        expect(taskResponse.data.task.title).toBe(taskData.title)
        createdTasks.push(taskResponse.data.task)
      }

      // 2. Admin lists tasks for the partner
      console.log("\n2. Admin listing tasks for partner...")
      const adminListResponse = await api.get(
        `/admin/partners/${partnerId}/tasks`,
        adminHeaders
      )
      console.log("Admin list response:", adminListResponse.data)
      expect(adminListResponse.status).toBe(200)
      expect(adminListResponse.data.tasks).toBeDefined()
      expect(adminListResponse.data.tasks.length).toBeGreaterThanOrEqual(testTasks.length)
      console.log(`Found ${adminListResponse.data.tasks.length} tasks for partner`)

      // 3. Partner lists their assigned tasks
      console.log("\n3. Partner listing assigned tasks...")
      const partnerListResponse = await api.get(
        "/partners/assigned-tasks",
        { headers: partnerHeaders }
      )
      console.log("Partner list response:", partnerListResponse.data)
      expect(partnerListResponse.status).toBe(200)
      expect(partnerListResponse.data.tasks).toBeDefined()
      expect(partnerListResponse.data.tasks.length).toBeGreaterThanOrEqual(testTasks.length)
      console.log(`Partner sees ${partnerListResponse.data.tasks.length} assigned tasks`)

      // 4. Partner accepts tasks
      console.log("\n4. Partner accepting tasks...")
      for (const task of createdTasks) {
        console.log(`Accepting task ${task.id}...`)
        
        try {
          const acceptResponse = await api.post(
            `/partners/assigned-tasks/${task.id}/accept`,
            {},
            { headers: partnerHeaders }
          )
          
          expect(acceptResponse.status).toBe(200)
          expect(acceptResponse.data.task).toBeDefined()
          expect(acceptResponse.data.task.status).toBe("accepted")
          expect(acceptResponse.data.message).toBe("Task accepted successfully")
          console.log(`Task ${task.id} accepted successfully`)
        } catch (error) {
          console.error(`Error accepting task ${task.id}:`, {
            status: error.response?.status,
            data: error.response?.data,
          });
          throw error;
        }
      }

      // 5. Partner completes tasks
      console.log("\n5. Partner completing tasks...")
      for (const task of createdTasks) {
        console.log(`Completing task ${task.id}...`)
        
        try {
          const finishResponse = await api.post(
            `/partners/assigned-tasks/${task.id}/finish`,
            {},
            { headers: partnerHeaders }
          )
          
          expect(finishResponse.status).toBe(200)
          expect(finishResponse.data.task).toBeDefined()
          expect(finishResponse.data.task.status).toBe("completed")
          expect(finishResponse.data.message).toBe("Task completed successfully")
          console.log(`Task ${task.id} completed successfully`)
        } catch (error) {
          console.error(`Error completing task ${task.id}:`, {
            status: error.response?.status,
            data: error.response?.data,
          });
          throw error;
        }
      }

      // 6. Verify final state
      console.log("\n6. Verifying final state...")
      const finalListResponse = await api.get(
        "/partners/assigned-tasks",
        { headers: partnerHeaders }
      )
      expect(finalListResponse.status).toBe(200)
      
      const completedTasks = finalListResponse.data.tasks.filter(
        (t: any) => t.status === "completed"
      )
      expect(completedTasks.length).toBeGreaterThanOrEqual(testTasks.length)
      console.log(`Verified ${completedTasks.length} completed tasks`)
    })

    test("should prevent unauthorized partner from accessing other partner's tasks", async () => {
      console.log("\nTesting task access control...")

      // Create another partner
      const otherPartnerEmail = "other-partner@medusa-test.com"
      await api.post("/auth/partner/emailpass/register", {
        email: otherPartnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const otherAuthResponse = await api.post("/auth/partner/emailpass", {
        email: otherPartnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const otherPartnerHeaders = {
        Authorization: `Bearer ${otherAuthResponse.data.token}`,
      }

      const otherPartnerResponse = await api.post(
        "/partners",
        {
          name: "Other Partner Company",
          handle: "other-partner-tasks",
          admin: {
            email: otherPartnerEmail,
            first_name: "Other",
            last_name: "Partner"
          }
        },
        { headers: otherPartnerHeaders }
      )

      // Get fresh token
      const newOtherAuthResponse = await api.post("/auth/partner/emailpass", {
        email: otherPartnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const newOtherPartnerHeaders = {
        Authorization: `Bearer ${newOtherAuthResponse.data.token}`,
      }

      // Try to accept a task that belongs to the first partner
      if (createdTasks.length > 0) {
        const taskId = createdTasks[0].id
        
        try {
          await api.post(
            `/partners/assigned-tasks/${taskId}/accept`,
            {},
            { headers: newOtherPartnerHeaders }
          )
          // Should not reach here
          fail("Should have thrown an error")
        } catch (error) {
          expect(error.response?.status).toBe(403)
          expect(error.response?.data.message).toContain("not assigned to this partner")
          console.log("Access control working: unauthorized partner cannot access task")
        }
      }
    })

    test("should handle task assignment workflow", async () => {
      console.log("\nTesting task assignment workflow...")

      // Create a dedicated partner for this test
      const workflowTestEmail = "workflow-test-partner@medusa-test.com"
      await api.post("/auth/partner/emailpass/register", {
        email: workflowTestEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const workflowAuthResponse = await api.post("/auth/partner/emailpass", {
        email: workflowTestEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const workflowPartnerHeaders = {
        Authorization: `Bearer ${workflowAuthResponse.data.token}`,
      }

      const workflowPartnerResponse = await api.post(
        "/partners",
        {
          name: "Workflow Test Partner",
          handle: "workflow-test-partner",
          admin: {
            email: workflowTestEmail,
            first_name: "Workflow",
            last_name: "Test"
          }
        },
        { headers: workflowPartnerHeaders }
      )

      const workflowPartnerId = workflowPartnerResponse.data.partner.id
      console.log("Created workflow test partner:", workflowPartnerId)

      // Get fresh token after partner creation (following design flow pattern)
      const newWorkflowAuthResponse = await api.post("/auth/partner/emailpass", {
        email: workflowTestEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const newWorkflowPartnerHeaders = {
        Authorization: `Bearer ${newWorkflowAuthResponse.data.token}`,
      }

      // 1. Create a task (without workflow)
      console.log("\n1. Creating task...")
      const taskResponse = await api.post(
        `/admin/partners/${workflowPartnerId}/tasks`,
        {
          title: "Workflow Test Task",
          description: "Testing the assignment workflow",
          priority: "low",
        },
        adminHeaders
      )

      expect(taskResponse.status).toBe(200)
      expect(taskResponse.data.task).toBeDefined()
      const taskId = taskResponse.data.task.id
      console.log("Task created:", taskId)

      // 2. Assign the task to trigger the workflow
      console.log("\n2. Assigning task to partner (triggers workflow)...")
      const assignResponse = await api.post(
        `/admin/partners/${workflowPartnerId}/tasks/${taskId}/assign`,
        {},
        adminHeaders
      )

      expect(assignResponse.status).toBe(200)
      expect(assignResponse.data.task).toBeDefined()
      console.log("Task assigned with workflow")

      // 3. Partner accepts the task
      console.log("\n3. Partner accepting task...")
      const acceptResponse = await api.post(
        `/partners/assigned-tasks/${taskId}/accept`,
        {},
        { headers: newWorkflowPartnerHeaders }
      )

      expect(acceptResponse.status).toBe(200)
      expect(acceptResponse.data.task).toBeDefined()
      expect(acceptResponse.data.task.status).toBe("accepted")
      console.log("Task accepted successfully")

      // 4. Partner completes the task
      console.log("\n4. Partner completing task...")
      const finishResponse = await api.post(
        `/partners/assigned-tasks/${taskId}/finish`,
        {},
        { headers: newWorkflowPartnerHeaders }
      )

      expect(finishResponse.status).toBe(200)
      expect(finishResponse.data.task).toBeDefined()
      expect(finishResponse.data.task.status).toBe("completed")
      console.log("Task completed successfully")
      
      console.log("\n✓ Task assignment workflow completed successfully")
    })
  })
})
