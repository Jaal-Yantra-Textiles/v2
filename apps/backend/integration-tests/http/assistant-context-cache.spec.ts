import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ASSISTANT_CONTEXT_CACHE_MODULE } from "../../src/modules/assistant-context-cache"
import { loadAndFormatContext } from "../../src/lib/assistant-context"

jest.setTimeout(90 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Assistant context cache service + injection", () => {
    let headers: Record<string, string>
    let adminUserId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = (await getAuthHeaders(api)).headers

      // Get the admin user id from auth context by hitting an authenticated
      // endpoint that echoes the actor id.
      const me = await api.get("/admin/users/me", { headers })
      adminUserId = me.data.user.id
    })

    it("creates and reads back a context entry", async () => {
      const container = getContainer()
      const service = container.resolve(ASSISTANT_CONTEXT_CACHE_MODULE)

      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "orders",
        entityIds: ["order_001", "order_002"],
        summary: "list_orders: 2 orders, first: order_001",
      })

      const rows = await service.getContextForPrincipal(
        adminUserId,
        "admin"
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].domain).toBe("orders")
      expect(rows[0].entity_ids).toEqual(["order_001", "order_002"])
      expect(rows[0].summary).toContain("2 orders")
    })

    it("upserts (updates) an existing entry instead of creating a duplicate", async () => {
      const container = getContainer()
      const service = container.resolve(ASSISTANT_CONTEXT_CACHE_MODULE)

      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "orders",
        entityIds: ["order_001"],
        summary: "first write",
      })

      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "orders",
        entityIds: ["order_999"],
        summary: "second write",
      })

      const rows = await service.getContextForPrincipal(
        adminUserId,
        "admin"
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].summary).toBe("second write")
      expect(rows[0].entity_ids).toEqual(["order_999"])
    })

    it("stores multiple domains for one principal", async () => {
      const container = getContainer()
      const service = container.resolve(ASSISTANT_CONTEXT_CACHE_MODULE)

      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "orders",
        entityIds: ["order_001"],
        summary: "orders summary",
      })
      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "catalog",
        entityIds: ["prod_001"],
        summary: "products summary",
      })

      const rows = await service.getContextForPrincipal(
        adminUserId,
        "admin"
      )
      expect(rows).toHaveLength(2)
      const domains = rows.map((r: any) => r.domain).sort()
      expect(domains).toEqual(["catalog", "orders"])
    })

    it("filters by domains when reading", async () => {
      const container = getContainer()
      const service = container.resolve(ASSISTANT_CONTEXT_CACHE_MODULE)

      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "orders",
        entityIds: [],
        summary: "orders",
      })
      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "catalog",
        entityIds: [],
        summary: "catalog",
      })
      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "production",
        entityIds: [],
        summary: "production",
      })

      const rows = await service.getContextForPrincipal(
        adminUserId,
        "admin",
        ["orders", "production"]
      )
      expect(rows).toHaveLength(2)
      const domains = rows.map((r: any) => r.domain).sort()
      expect(domains).toEqual(["orders", "production"])
    })

    it("isolates entries by principal_id", async () => {
      const container = getContainer()
      const service = container.resolve(ASSISTANT_CONTEXT_CACHE_MODULE)

      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "orders",
        entityIds: ["order_mine"],
        summary: "my orders",
      })
      await service.upsertContextEntry({
        principalId: "other-user-id",
        surface: "admin",
        domain: "orders",
        entityIds: ["order_theirs"],
        summary: "their orders",
      })

      const mine = await service.getContextForPrincipal(
        adminUserId,
        "admin"
      )
      expect(mine).toHaveLength(1)
      expect(mine[0].entity_ids).toEqual(["order_mine"])

      const theirs = await service.getContextForPrincipal(
        "other-user-id",
        "admin"
      )
      expect(theirs).toHaveLength(1)
      expect(theirs[0].entity_ids).toEqual(["order_theirs"])
    })

    it("clears all entries for a principal + surface", async () => {
      const container = getContainer()
      const service = container.resolve(ASSISTANT_CONTEXT_CACHE_MODULE)

      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "orders",
        entityIds: [],
        summary: "x",
      })
      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "catalog",
        entityIds: [],
        summary: "y",
      })

      const deleted = await service.clearContextForPrincipal(
        adminUserId,
        "admin"
      )
      expect(deleted).toBe(2)

      const remaining = await service.getContextForPrincipal(
        adminUserId,
        "admin"
      )
      expect(remaining).toHaveLength(0)
    })

    it("loadAndFormatContext returns undefined when no entries", async () => {
      const container = getContainer()
      const service = container.resolve(ASSISTANT_CONTEXT_CACHE_MODULE)

      const result = await loadAndFormatContext(
        service,
        adminUserId,
        "admin",
        ["orders"]
      )
      expect(result).toBeUndefined()
    })

    it("loadAndFormatContext returns a formatted block with entries", async () => {
      const container = getContainer()
      const service = container.resolve(ASSISTANT_CONTEXT_CACHE_MODULE)

      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "orders",
        entityIds: ["order_001", "order_002"],
        summary: "list_orders: 2 orders, first: order_001",
      })

      const result = await loadAndFormatContext(
        service,
        adminUserId,
        "admin",
        ["orders"]
      )
      expect(result).toBeDefined()
      expect(result!).toContain("Prior context from earlier conversations")
      expect(result!).toContain("### orders")
      expect(result!).toContain("2 orders")
      expect(result!).toContain("order_001, order_002")
    })

    it("loadAndFormatContext only returns entries for requested domains", async () => {
      const container = getContainer()
      const service = container.resolve(ASSISTANT_CONTEXT_CACHE_MODULE)

      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "orders",
        entityIds: ["order_001"],
        summary: "orders here",
      })
      await service.upsertContextEntry({
        principalId: adminUserId,
        surface: "admin",
        domain: "catalog",
        entityIds: ["prod_001"],
        summary: "catalog here",
      })

      const result = await loadAndFormatContext(
        service,
        adminUserId,
        "admin",
        ["orders"]
      )
      expect(result).toBeDefined()
      expect(result!).toContain("orders")
      expect(result!).not.toContain("catalog")
    })

    it("loadAndFormatContext returns undefined for null service", async () => {
      const result = await loadAndFormatContext(
        null,
        adminUserId,
        "admin",
        ["orders"]
      )
      expect(result).toBeUndefined()
    })
  })
})
