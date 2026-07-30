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

jest.setTimeout(90000)

/**
 * Both tests in this file used to drive `GET /admin/ai/chat/stream` (SSE), a
 * route DELETED in 92bc280bb when the admin chat was consolidated onto
 * `/admin/ai/chat/chat`. They 404'd from that commit onward and nobody saw it,
 * because the main gate ran no tests at all (#1187).
 *
 * The stream-establishment test is gone with the endpoint — there is no SSE GET
 * to establish. What is worth keeping is the *stability* concern the file is
 * named for: repeated sequential requests must not deadlock the shared
 * embedding/index state. That is retargeted onto the consolidated route, where
 * it still means something.
 */
setupSharedTestSuite(() => {
    const { api, getContainer } = getSharedTestEnv()
    let headers: any

    beforeEach(async () => {
        const container = getContainer()
        await createAdminUser(container)
        headers = await getAuthHeaders(api)
    })

    describe("Chat Stability", () => {
        // 3 minutes, not the file's 90s: with no OPENROUTER_API_KEY (CI's normal
        // state) every call walks the model rotator, which sleeps between
        // attempts before giving up — ~20-25s per request against ~2s locally.
        // Three of those overran the old 60s and this is the only test here that
        // pays the cost more than once.
        it("handles multiple sequential requests without crashing", async () => {
            // Sequential (not parallel) on purpose: this exercises the
            // embedding/index locking that a burst would mask.
            for (let i = 0; i < 3; i++) {
                const res = await api.post(
                    "/admin/ai/chat/chat",
                    { message: `Request number ${i}` },
                    headers
                )

                expect(res.status).toBe(200)
                expect(res.data.status).toBe("completed")
                expect(typeof res.data.result?.reply).toBe("string")
            }
        }, 180000)

        it("keeps serving after a malformed request", async () => {
            const bad = await api
                .post("/admin/ai/chat/chat", {}, headers)
                .catch((e: any) => e.response)
            expect(bad.status).toBe(400)

            // The route must still answer normally afterwards — a rejected
            // request must not leave the workflow or its storage wedged.
            const good = await api.post(
                "/admin/ai/chat/chat",
                { message: "still alive?" },
                headers
            )
            expect(good.status).toBe(200)
            expect(good.data.status).toBe("completed")
        })
    })
})
