/**
 * Per-token MCP scope arithmetic (#1306 Track C).
 *
 * The properties that matter here are not "does the ladder sort" but the two
 * that make the mechanism safe: a scope row can only ever RESTRICT, and an
 * absent row leaves behaviour exactly as it was before scopes existed.
 */
import {
  MCP_SCOPE_LEVELS,
  isMcpScopeLevel,
  mcpScopeRank,
  minMcpScope,
  mcpScopeAllows,
  mcpScopeToContextFlags,
  mcpCeilingLevel,
  mcpPrincipalFromRequest,
  isMcpMachinePrincipal,
  resolveMcpScope,
  type McpScopeLevel,
} from "../mcp-scope"

const asReq = (authContext: any, service?: any) =>
  ({
    auth_context: authContext,
    scope: {
      resolve: () => {
        if (!service) throw new Error("module not registered")
        return service
      },
    },
  } as any)

describe("mcp scope ladder", () => {
  it("orders the levels weakest-first", () => {
    expect([...MCP_SCOPE_LEVELS]).toEqual([
      "read",
      "write",
      "sensitive",
      "dangerous",
    ])
  })

  it("ranks an unknown level as the weakest, not the strongest", () => {
    // Fail shut: a typo'd or future level stored in the DB must not grant more
    // than `read` on an older deployment that doesn't know the word.
    expect(mcpScopeRank("wildcard")).toBe(mcpScopeRank("read"))
    expect(isMcpScopeLevel("wildcard")).toBe(false)
  })

  it("implies every level below it", () => {
    expect(mcpScopeAllows("dangerous", "read")).toBe(true)
    expect(mcpScopeAllows("dangerous", "write")).toBe(true)
    expect(mcpScopeAllows("write", "sensitive")).toBe(false)
    expect(mcpScopeAllows("read", "write")).toBe(false)
  })

  it("maps each level onto the three context flags", () => {
    expect(mcpScopeToContextFlags("read")).toEqual({
      enableWrite: false,
      enableSensitive: false,
      enableDangerous: false,
    })
    // The rung that did not exist before: ordinary mutations, no confirm-gated
    // tools — which is what a third-party client should get by default, since
    // there the MODEL supplies confirm:true rather than a human.
    expect(mcpScopeToContextFlags("write")).toEqual({
      enableWrite: true,
      enableSensitive: false,
      enableDangerous: false,
    })
    expect(mcpScopeToContextFlags("sensitive")).toEqual({
      enableWrite: true,
      enableSensitive: true,
      enableDangerous: false,
    })
    expect(mcpScopeToContextFlags("dangerous")).toEqual({
      enableWrite: true,
      enableSensitive: true,
      enableDangerous: true,
    })
  })
})

describe("process ceiling", () => {
  it("is 'sensitive' in the default deployment — writes on, dangerous off", () => {
    // This is the compatibility assertion. Confirm-gated tools have always been
    // callable when ADMIN_MCP_ENABLE_WRITE is on, so the default ceiling must
    // sit at `sensitive`, not `write`, or scopes would silently take something
    // away from every existing credential.
    expect(mcpCeilingLevel({ write: true, dangerous: false })).toBe("sensitive")
  })

  it("collapses to read when writes are off, regardless of the dangerous flag", () => {
    expect(mcpCeilingLevel({ write: false, dangerous: false })).toBe("read")
    expect(mcpCeilingLevel({ write: false, dangerous: true })).toBe("read")
  })

  it("reaches dangerous only when both flags are on", () => {
    expect(mcpCeilingLevel({ write: true, dangerous: true })).toBe("dangerous")
  })
})

describe("intersection with the ceiling", () => {
  it("takes the weaker of the two", () => {
    expect(minMcpScope("dangerous", "read")).toBe("read")
    expect(minMcpScope("write", "sensitive")).toBe("write")
  })

  it("never lets a row widen past the ceiling", async () => {
    const service = {
      getScope: async () => ({ level: "dangerous" }),
    }
    const req = asReq({ actor_id: "apk_1", actor_type: "api-key" }, service)
    // Deployment allows writes but not dangerous ⇒ ceiling 'sensitive'.
    const resolved = await resolveMcpScope(req, "sensitive")
    expect(resolved.level).toBe("sensitive")
    expect(resolved.granted).toBe("dangerous")
    expect(resolved.source).toBe("scope_row")
  })

  it("falls back to the ceiling when the principal has no row", async () => {
    const service = { getScope: async () => null }
    const req = asReq({ actor_id: "apk_1", actor_type: "api-key" }, service)
    const resolved = await resolveMcpScope(req, "sensitive")
    expect(resolved).toEqual({ level: "sensitive", source: "ceiling" })
  })

  it("falls back to the ceiling when the module is unavailable", async () => {
    // A missing module must degrade to prior behaviour, not lock every
    // credential out of the platform.
    const req = asReq({ actor_id: "apk_1", actor_type: "api-key" })
    const resolved = await resolveMcpScope(req, "sensitive")
    expect(resolved).toEqual({ level: "sensitive", source: "ceiling" })
  })

  it("restricts when the row is weaker than the ceiling", async () => {
    const service = { getScope: async () => ({ level: "read" }) }
    const req = asReq({ actor_id: "apk_1", actor_type: "api-key" }, service)
    expect((await resolveMcpScope(req, "dangerous")).level).toBe("read")
  })

  it("treats an unrecognised stored level as read", async () => {
    const service = { getScope: async () => ({ level: "admin" }) }
    const req = asReq({ actor_id: "apk_1", actor_type: "api-key" }, service)
    expect((await resolveMcpScope(req, "dangerous")).level).toBe("read")
  })
})

describe("principals", () => {
  it("reads the api-key actor Medusa sets for a secret key", () => {
    const req = asReq({ actor_id: "apk_01M0", actor_type: "api-key" })
    expect(mcpPrincipalFromRequest(req)).toEqual({
      type: "api-key",
      id: "apk_01M0",
    })
  })

  it("is null when unauthenticated", () => {
    expect(mcpPrincipalFromRequest(asReq(undefined))).toBeNull()
    expect(mcpPrincipalFromRequest(asReq({ actor_type: "user" }))).toBeNull()
  })

  it("counts only machine credentials as HTTP-enforceable", () => {
    // A human admin can do anything through the dashboard, so refusing their
    // raw HTTP writes would restrict nothing and could lock a person out.
    expect(isMcpMachinePrincipal({ type: "api-key", id: "apk_1" })).toBe(true)
    expect(isMcpMachinePrincipal({ type: "oauth", id: "tok_1" })).toBe(true)
    expect(isMcpMachinePrincipal({ type: "user", id: "usr_1" })).toBe(false)
  })
})
