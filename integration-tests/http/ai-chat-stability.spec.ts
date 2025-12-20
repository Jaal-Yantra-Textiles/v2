import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

// Mock ESM-only dependency to avoid Jest/CJS issues
jest.mock("@sindresorhus/slugify", () => {
    return {
        __esModule: true,
        default: (str: string) => (str || "").toLowerCase().replace(/\s+/g, "-"),
    }
}, { virtual: true })

jest.mock("p-map", () => {
    return {
        __esModule: true,
        default: async (iterable: any[], mapper: any) => Promise.all(iterable.map(mapper)),
    }
}, { virtual: true })

import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
    const { api, getContainer } = getSharedTestEnv()
    let headers: any

    beforeEach(async () => {
        const container = getContainer()
        await createAdminUser(container)
        headers = await getAuthHeaders(api)
    })

    describe("Chat Stability & Stream Tests", () => {
        it("successfully establishes a chat stream and receives response", async () => {
            const params = {
                message: "Hello world",
                context: JSON.stringify({ sse: true })
            }

            const res = await api.get("/admin/ai/chat/stream", {
                ...headers,
                params,
                responseType: "stream",
                headers: {
                    ...headers.headers,
                    Accept: "text/event-stream",
                },
            })

            expect(res.status).toBe(200)
            const stream: NodeJS.ReadableStream = res.data

            let dataReceived = false
            let summaryReceived = false
            let endReceived = false

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    resolve() // Resolve to avoid hanging if stream is incomplete but check flags
                }, 15000)

                stream.on("data", (buf: Buffer) => {
                    const text = buf.toString("utf8")
                    if (text.includes("event: chunk")) dataReceived = true
                    if (text.includes("event: summary")) summaryReceived = true
                    if (text.includes("event: end")) {
                        endReceived = true
                        clearTimeout(timeout)
                        resolve()
                    }
                })
                stream.on("error", (err) => {
                    clearTimeout(timeout)
                    reject(err)
                })
            })

            expect(endReceived).toBe(true)
            // We expect at least some chunks or a summary
            expect(dataReceived || summaryReceived).toBe(true)
        })

        it("can handle multiple sequential requests without crashing", async () => {
            // Run 3 sequential requests to test stability/embedding locking
            for (let i = 0; i < 3; i++) {
                const params = {
                    message: `Request number ${i}`,
                    context: JSON.stringify({ sse: true })
                }

                try {
                    const res = await api.get("/admin/ai/chat/stream", {
                        ...headers,
                        params,
                        responseType: "stream",
                        headers: {
                            ...headers.headers,
                            Accept: "text/event-stream",
                        },
                    })

                    expect(res.status).toBe(200)
                    const stream: NodeJS.ReadableStream = res.data

                    // Consume stream
                    await new Promise<void>((resolve) => {
                        stream.on("data", () => { })
                        stream.on("end", resolve)
                        stream.on("error", resolve) // Treat error as end for loop continuation but test fails if status != 200
                    })
                } catch (e) {
                    console.error(`Request ${i} failed`, e)
                    throw e
                }
            }
        })
    })
})
