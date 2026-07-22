import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { EMAIL_SUPPRESSION_MODULE } from "../../src/modules/email_suppression"
import { EMAIL_ENGAGEMENT_MODULE } from "../../src/modules/email_engagement"

// The Kit webhook sink acks 200 then processes async (suppress / record
// engagement). Each Kit rule is registered against a distinct `?event=<kind>`
// target, so the sink reads the kind from the query string. Gated by a shared
// secret set before the suite boots.
const TEST_SECRET = "kit_test_secret"
process.env.KIT_WEBHOOK_SECRET = TEST_SECRET

jest.setTimeout(60 * 1000)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function pollFor<T>(fn: () => Promise<T[]>, tries = 20): Promise<T[]> {
  for (let i = 0; i < tries; i++) {
    const rows = await fn()
    if (rows.length) return rows
    await sleep(250)
  }
  return []
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("POST /webhooks/kit", () => {
    it("rejects a request with a bad/missing token (401)", async () => {
      const res = await api.post(
        "/webhooks/kit?event=bounce",
        { subscriber: { id: 1, email_address: "nope@x.com" } },
        { validateStatus: () => true }
      )
      expect(res.status).toBe(401)
    })

    it("suppresses the recipient on a bounce event", async () => {
      const email = `kit-bounce-${Date.now()}@x.com`
      const res = await api.post(
        `/webhooks/kit?token=${TEST_SECRET}&event=bounce`,
        { subscriber: { id: 4242, email_address: email } },
        { validateStatus: () => true }
      )
      expect(res.status).toBe(200)

      const suppression: any = getContainer().resolve(EMAIL_SUPPRESSION_MODULE)
      const rows = await pollFor(() =>
        suppression.listEmailSuppressions({ email }).catch(() => [])
      )
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0].reason).toBe("hard_bounce")
    })

    it("records engagement on a link_click event", async () => {
      const email = `kit-click-${Date.now()}@x.com`
      const res = await api.post(
        `/webhooks/kit?token=${TEST_SECRET}&event=click`,
        {
          subscriber: { id: 7, email_address: email },
          link: { url: "https://jaalyantra.com/blog/x" },
          broadcast_id: 55,
        },
        { validateStatus: () => true }
      )
      expect(res.status).toBe(200)

      const engagement: any = getContainer().resolve(EMAIL_ENGAGEMENT_MODULE)
      const rows = await pollFor(() =>
        engagement.listEmailEngagementEvents({ email }).catch(() => [])
      )
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0].type).toBe("click")
    })
  })
})
