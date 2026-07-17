import {
  buildToolInputSchema,
  dispatchPartnerTool,
  isSensitive,
} from "../dispatch"
import { PARTNER_MCP_TOOLS } from "../registry"

describe("partner-mcp registry + dispatch", () => {
  describe("create_store tool", () => {
    const def = PARTNER_MCP_TOOLS.find((t) => t.name === "create_store")

    it("is registered as a sensitive write on POST /partners/stores", () => {
      expect(def).toBeTruthy()
      expect(def!.method).toBe("POST")
      expect(def!.path).toBe("/partners/stores")
      expect(def!.write).toBe(true)
      expect(isSensitive(def!)).toBe(true)
      expect(def!.bodyParams).toEqual([
        "store",
        "sales_channel",
        "region",
        "location",
      ])
    })

    it("requires store, region and location in its schema", () => {
      expect(def!.inputSchema.required).toEqual(
        expect.arrayContaining(["store", "region", "location"])
      )
    })
  })

  describe("context framework arg", () => {
    it("is injected onto EVERY tool's input schema", () => {
      for (const def of PARTNER_MCP_TOOLS) {
        const schema = buildToolInputSchema(def)
        expect(schema.properties.context).toBeDefined()
        expect(schema.properties.context.type).toBe("string")
        expect(schema.properties.dry_run).toBeDefined()
      }
    })

    it("adds confirm only to sensitive tools", () => {
      const readTool = PARTNER_MCP_TOOLS.find((t) => t.name === "list_stores")!
      const sensitiveTool = PARTNER_MCP_TOOLS.find(
        (t) => t.name === "create_store"
      )!
      expect(buildToolInputSchema(readTool).properties.confirm).toBeUndefined()
      expect(
        buildToolInputSchema(sensitiveTool).properties.confirm
      ).toBeDefined()
    })

    it("echoes context on the dry-run plan of a read tool (no network)", async () => {
      const res = await dispatchPartnerTool(
        { baseUrl: "http://localhost:9999", bearer: "t", enableWrite: true },
        "list_stores",
        { dry_run: true, context: "checking stores before onboarding a partner" }
      )
      expect(res.ok).toBe(true)
      expect(res.dry_run).toBe(true)
      expect(res.plan?.context).toBe(
        "checking stores before onboarding a partner"
      )
    })
  })

  it("returns a soft error for an unknown tool", async () => {
    const res = await dispatchPartnerTool(
      { baseUrl: "http://localhost:9999" },
      "does_not_exist",
      {}
    )
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/unknown tool/i)
  })
})
