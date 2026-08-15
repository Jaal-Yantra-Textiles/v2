/**
 * Loopback proxy auth forwarding.
 *
 * The bug this pins: `callMcpRoute` used to prefix any header that didn't
 * already start with "bearer " — so a Medusa secret API key, which authenticates
 * over HTTP Basic and only over Basic, was forwarded as `Bearer Basic <b64>` and
 * every tool CALL 401'd on the loopback. `initialize` and `tools/list` never
 * touch a route, so they kept working and the surface looked functional for a
 * key holder (#1306).
 */
import { callMcpRoute } from "../proxy"

describe("callMcpRoute — authorization forwarding", () => {
  const originalFetch = global.fetch
  let seen: Record<string, string>

  beforeEach(() => {
    seen = {}
    global.fetch = jest.fn(async (_url: any, init: any) => {
      seen = init.headers
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      } as any
    }) as any
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  const call = (bearer?: string) =>
    callMcpRoute({ baseUrl: "http://localhost:9000", path: "/admin/products", bearer })

  it("forwards a Basic header verbatim — an API key must stay Basic", async () => {
    await call("Basic c2tfZm9vOg==")
    expect(seen["authorization"]).toBe("Basic c2tfZm9vOg==")
  })

  it("is case-insensitive about the scheme", async () => {
    await call("basic c2tfZm9vOg==")
    expect(seen["authorization"]).toBe("basic c2tfZm9vOg==")
  })

  it("forwards a Bearer header verbatim", async () => {
    await call("Bearer jwt.token.here")
    expect(seen["authorization"]).toBe("Bearer jwt.token.here")
  })

  it("still prefixes a bare token", async () => {
    await call("jwt.token.here")
    expect(seen["authorization"]).toBe("Bearer jwt.token.here")
  })

  it("sends no authorization header when there is nothing to forward", async () => {
    await call(undefined)
    expect(seen["authorization"]).toBeUndefined()
  })
})
