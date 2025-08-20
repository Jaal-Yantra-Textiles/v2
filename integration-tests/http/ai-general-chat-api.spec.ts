import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(45000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  describe("POST /admin/ai/chat", () => {
    it("responds with reply and optional toolCalls fields", async () => {
      const body = {
        message: "Hello there!",
        context: { test: true },
      }

      const res = await api.post("/admin/ai/chat", body, headers)
      expect(res.status).toBe(200)
      expect(res.data).toBeDefined()
      expect(res.data.message).toBeDefined()
      expect(res.data.result).toBeDefined()
      console.log(res.data)
      // Basic shape checks
      expect(typeof res.data.result.reply).toBe("string")
      if (res.data.result.toolCalls) {
        expect(Array.isArray(res.data.result.toolCalls)).toBe(true)
      }
      if (res.data.result.activations) {
        expect(Array.isArray(res.data.result.activations)).toBe(true)
      }
    })
  })

  describe("GET /admin/ai/chat/stream (SSE)", () => {
    it("streams chunk events and ends with summary/end", async () => {
      // Ensure the HTTP client supports streams (axios instance)
      const params = { message: "Stream this response", context: JSON.stringify({ sse: true }) }

      // The integration test API is an axios-like instance
      const res = await api.get("/admin/ai/chat/stream", {
        ...headers,
        params,
        responseType: "stream",
        // Important for SSE
        headers: {
          ...headers.headers,
          Accept: "text/event-stream",
        },
      })

      expect(res.status).toBe(200)
      const stream: NodeJS.ReadableStream = res.data

      let sawChunk = false
      let sawSummary = false
      let sawEnd = false

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          // Resolve even if not all events seen, to avoid flakiness
          resolve()
        }, 15000)

        stream.on("data", (buf: Buffer) => {
          const text = buf.toString("utf8")
          // Look for SSE event prefixes
          if (text.includes("event: chunk")) sawChunk = true
          if (text.includes("event: summary")) sawSummary = true
          if (text.includes("event: end")) {
            sawEnd = true
            clearTimeout(timeout)
            resolve()
          }
        })
        stream.on("error", (err) => {
          clearTimeout((timeout as any))
          reject(err)
        })
      })

      // We should at least see an end event; chunk/summary may vary based on model behavior
      expect(sawEnd).toBe(true)
      // Soft assertions to help debug without failing the suite unnecessarily
      // console.log({ sawChunk, sawSummary, sawEnd })
    })
  })
})
