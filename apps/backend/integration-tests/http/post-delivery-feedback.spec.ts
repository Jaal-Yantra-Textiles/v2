import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { FEEDBACK_MODULE } from "../../src/modules/feedback"
import { selectExistingFeedbackRequest } from "../../src/workflows/feedback/lib/post-delivery-feedback"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("post-delivery feedback request (#452)", () => {
    it("persists the durable order_id column and reuses the live request idempotently", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const service: any = container.resolve(FEEDBACK_MODULE)

      const orderId = `order_${Date.now()}`

      // 1) The new typed order_id column persists and is queryable.
      const created = await service.createFeedbacks({
        order_id: orderId,
        submitted_by: "c@example.com",
        submitted_at: new Date(),
        status: "pending",
        metadata: { source: "post_delivery_request" },
      })

      expect(created.id).toBeTruthy()
      expect(created.order_id).toBe(orderId)
      expect(created.status).toBe("pending")

      const rows = await service.listFeedbacks({ order_id: orderId })
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(created.id)

      // 2) Idempotency: a re-fired event reuses the existing live request.
      const reuse = selectExistingFeedbackRequest(rows as any)
      expect(reuse?.id).toBe(created.id)

      const after = await service.listFeedbacks({ order_id: orderId })
      expect(after).toHaveLength(1)
    })
  })
})
