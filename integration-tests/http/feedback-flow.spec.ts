import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const TEST_PARTNER_EMAIL = "feedback-test-partner@medusa-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(30000)

setupSharedTestSuite(() => {
  let adminHeaders: any
  let partnerHeaders: any
  let partnerId: string
  let taskId: string
  let feedbackId: string
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

    partnerHeaders = {
      Authorization: `Bearer ${authResponse.data.token}`,
    }

    // Create a partner
    const partnerResponse = await api.post(
      "/partners",
      {
        name: "Feedback Test Partner",
        handle: "feedback-test-partner",
        admin: {
          email: TEST_PARTNER_EMAIL,
          first_name: "Feedback",
          last_name: "Tester"
        }
      },
      { headers: partnerHeaders }
    )

    partnerId = partnerResponse.data.partner.id
    console.log("Created partner with ID:", partnerId)

    // Get fresh token after partner creation
    const newAuthResponse = await api.post("/auth/partner/emailpass", {
      email: TEST_PARTNER_EMAIL,
      password: TEST_PARTNER_PASSWORD,
    })

    partnerHeaders = {
      Authorization: `Bearer ${newAuthResponse.data.token}`,
    }

    // Create a task for testing
    const taskResponse = await api.post(
      `/admin/partners/${partnerId}/tasks`,
      {
        title: "Test Task for Feedback",
        description: "A task to test feedback functionality",
        priority: "medium",
      },
      adminHeaders
    )

    taskId = taskResponse.data.task.id
    console.log("Created task with ID:", taskId)
  })

  describe("Feedback Module Flow", () => {
    test("should create feedback via admin API", async () => {
      console.log("\n1. Creating feedback via admin API...")
      
      const feedbackResponse = await api.post(
        "/admin/feedbacks",
        {
          rating: "four",
          comment: "Great work on this task!",
          status: "pending",
          submitted_by: "admin@test.com",
          submitted_at: new Date().toISOString(),
        },
        adminHeaders
      )

      console.log("Feedback created:", feedbackResponse.data)
      expect(feedbackResponse.status).toBe(201)
      expect(feedbackResponse.data.feedback).toBeDefined()
      expect(feedbackResponse.data.feedback.rating).toBe("four")
      expect(feedbackResponse.data.feedback.comment).toBe("Great work on this task!")
      
      feedbackId = feedbackResponse.data.feedback.id
    })

    test("should list all feedbacks", async () => {
      console.log("\n2. Listing all feedbacks...")
      
      const listResponse = await api.get(
        "/admin/feedbacks",
        adminHeaders
      )

      console.log("Feedbacks list:", listResponse.data)
      expect(listResponse.status).toBe(200)
      expect(listResponse.data.feedbacks).toBeDefined()
      expect(listResponse.data.feedbacks.length).toBeGreaterThan(0)
      expect(listResponse.data.count).toBeGreaterThan(0)
    })

    test("should get a specific feedback by ID", async () => {
      console.log("\n3. Getting feedback by ID...")
      
      const getResponse = await api.get(
        `/admin/feedbacks/${feedbackId}`,
        adminHeaders
      )

      console.log("Feedback details:", getResponse.data)
      expect(getResponse.status).toBe(200)
      expect(getResponse.data.feedback).toBeDefined()
      expect(getResponse.data.feedback.id).toBe(feedbackId)
      expect(getResponse.data.feedback.rating).toBe("four")
    })

    test("should update feedback status", async () => {
      console.log("\n4. Updating feedback status...")
      
      const updateResponse = await api.post(
        `/admin/feedbacks/${feedbackId}`,
        {
          status: "reviewed",
          reviewed_by: "admin@test.com",
          reviewed_at: new Date().toISOString(),
        },
        adminHeaders
      )

      console.log("Updated feedback:", updateResponse.data)
      expect(updateResponse.status).toBe(200)
      expect(updateResponse.data.feedback).toBeDefined()
      expect(updateResponse.data.feedback.status).toBe("reviewed")
      expect(updateResponse.data.feedback.reviewed_by).toBe("admin@test.com")
    })

    test("should delete feedback", async () => {
      console.log("\n5. Deleting feedback...")
      
      const deleteResponse = await api.delete(
        `/admin/feedbacks/${feedbackId}`,
        adminHeaders
      )

      console.log("Delete response:", deleteResponse.data)
      expect(deleteResponse.status).toBe(200)
      expect(deleteResponse.data.deleted).toBe(true)
      expect(deleteResponse.data.id).toBe(feedbackId)
    })

    test("should create feedback with partner link", async () => {
      console.log("\n6. Creating feedback with partner link...")
      
      // Note: This would require a custom API endpoint that uses the
      // createFeedbackWithLinkWorkflow. For now, we test basic creation.
      const feedbackResponse = await api.post(
        "/admin/feedbacks",
        {
          rating: "five",
          comment: "Excellent partner collaboration!",
          status: "pending",
          submitted_by: partnerId,
          submitted_at: new Date().toISOString(),
          metadata: {
            partner_id: partnerId,
            context: "partner_evaluation"
          }
        },
        adminHeaders
      )

      console.log("Feedback with metadata:", feedbackResponse.data)
      expect(feedbackResponse.status).toBe(201)
      expect(feedbackResponse.data.feedback).toBeDefined()
      expect(feedbackResponse.data.feedback.metadata).toBeDefined()
      expect(feedbackResponse.data.feedback.metadata.partner_id).toBe(partnerId)
    })
  })
})
