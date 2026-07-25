import {
  dispatchAdminTool,
  buildToolInputSchema,
  isSensitive,
  isDangerous,
} from "../dispatch"
import { ADMIN_MCP_TOOLS } from "../registry"
import {
  dispatchMcpTool,
  type McpContext,
  type McpToolDef,
} from "../../../../../lib/mcp-core"

describe("admin-mcp registry + dispatch", () => {
  describe("registry shape (Tier 1 reads + Tier 2 writes)", () => {
    it("registers get_admin_stats as the read-only grounding tool", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "get_admin_stats")
      expect(def).toBeTruthy()
      expect(def!.method ?? "GET").toBe("GET")
      expect(def!.path).toBe("/admin/mcp/stats")
      expect(isSensitive(def!)).toBe(false)
    })

    it("GET tools carry no write/sensitive/dangerous flags", () => {
      for (const def of ADMIN_MCP_TOOLS) {
        if ((def.method ?? "GET") !== "GET") continue
        expect(def.write).toBeFalsy()
        expect(isSensitive(def)).toBe(false)
        expect(isDangerous(def)).toBe(false)
      }
    })

    it("every write tool is guarded (sensitive or dangerous) and non-GET", () => {
      const writeTools = ADMIN_MCP_TOOLS.filter((t) => t.write)
      // Tier 2 introduced writes — there must be some now.
      expect(writeTools.length).toBeGreaterThan(0)
      for (const def of writeTools) {
        expect(def.method ?? "GET").not.toBe("GET")
        expect(isSensitive(def)).toBe(true) // sensitive OR dangerous OR DELETE
      }
    })

    it("exposes delete_product as the first dangerous action (confirm + reason)", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "delete_product")
      expect(def).toBeTruthy()
      expect(def!.write).toBe(true)
      expect(def!.method).toBe("DELETE")
      expect(isDangerous(def!)).toBe(true)
      // buildToolInputSchema must inject BOTH reason and confirm.
      const schema = buildToolInputSchema(def!)
      expect(schema.properties.reason).toBeDefined()
      expect(schema.properties.confirm).toBeDefined()
    })

    it("resolve_admin_query is a read-only planner (POST, not a write)", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "resolve_admin_query")
      expect(def).toBeTruthy()
      expect(def!.method).toBe("POST")
      expect(def!.write).toBeFalsy()
      expect(isSensitive(def!)).toBe(false)
    })

    it("has unique tool names", () => {
      const names = ADMIN_MCP_TOOLS.map((t) => t.name)
      expect(new Set(names).size).toBe(names.length)
    })
  })

  describe("partner ops tools (#843): wrap existing /admin/partners/:id/* routes", () => {
    it("registers read tools for tasks, feedbacks, people, fees and subscription", () => {
      const reads = [
        ["list_partner_tasks", "/admin/partners/:id/tasks"],
        ["get_partner_task", "/admin/partners/:id/tasks/:taskId"],
        ["list_partner_feedbacks", "/admin/partners/:id/feedbacks"],
        ["list_partner_people", "/admin/partners/:id/people"],
        ["get_partner_fees", "/admin/partners/:id/fees"],
        ["get_partner_subscription", "/admin/partners/:id/subscription"],
      ] as const
      for (const [name, path] of reads) {
        const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
        expect(def).toBeTruthy()
        expect(def!.method ?? "GET").toBe("GET")
        expect(def!.path).toBe(path)
        expect(def!.write).toBeFalsy()
        expect(isSensitive(def!)).toBe(false)
      }
    })

    it("registers write tools for tasks, feedbacks, people and subscription, all sensitive", () => {
      const writes = [
        ["create_partner_task", "POST", "/admin/partners/:id/tasks"],
        ["update_partner_task", "PATCH", "/admin/partners/:id/tasks/:taskId"],
        ["create_partner_feedback", "POST", "/admin/partners/:id/feedbacks"],
        ["link_partner_people", "POST", "/admin/partners/:id/people"],
        ["create_partner_subscription", "POST", "/admin/partners/:id/subscription"],
      ] as const
      for (const [name, method, path] of writes) {
        const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
        expect(def).toBeTruthy()
        expect(def!.write).toBe(true)
        expect(def!.method).toBe(method)
        expect(def!.path).toBe(path)
        expect(isSensitive(def!)).toBe(true)
        expect(isDangerous(def!)).toBe(false)
      }
    })

    it("update_partner_task declares a previewPath matching its own route (dry_run shows current task)", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "update_partner_task")!
      expect(def.previewPath).toBe("/admin/partners/:id/tasks/:taskId")
      expect(def.pathParams).toEqual(["id", "taskId"])
    })

    it("get_partner_task requires both id and taskId path params", async () => {
      const missingTaskId = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "get_partner_task",
        { id: "partner_1" }
      )
      expect(missingTaskId.ok).toBe(false)
      expect(missingTaskId.error).toMatch(/taskId/)
    })

    it("dry_run on create_partner_task previews the plan without executing", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "create_partner_task",
        { id: "partner_1", title: "Inspect this partner", dry_run: true }
      )
      expect(res.ok).toBe(true)
      expect(res.dry_run).toBe(true)
      expect(res.plan?.method).toBe("POST")
      expect(res.plan?.path).toBe("/admin/partners/partner_1/tasks")
      expect((res.plan?.body as any)?.title).toBe("Inspect this partner")
    })

    it("link_partner_people without confirm returns requires_confirmation, not executed", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "link_partner_people",
        { id: "partner_1", person_ids: ["person_1"] }
      )
      expect(res.requires_confirmation).toBe(true)
      expect(res.plan?.path).toBe("/admin/partners/partner_1/people")
    })
  })

  describe("partner ops tools round 2 (#843): CRUD parity + admins/comms/artisan", () => {
    it("registers read tools for person-types, admins and the artisan proposal", () => {
      const reads = [
        ["list_partner_person_types", "/admin/partners/:id/person-types"],
        ["list_partner_admins", "/admin/partners/:id/admins"],
        ["get_partner_product_proposal", "/admin/partners/products/:id/proposal"],
      ] as const
      for (const [name, path] of reads) {
        const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
        expect(def).toBeTruthy()
        expect(def!.method ?? "GET").toBe("GET")
        expect(def!.path).toBe(path)
        expect(def!.write).toBeFalsy()
        expect(isSensitive(def!)).toBe(false)
      }
    })

    it("registers sensitive write tools for partner CRUD, admins, whatsapp and artisan approve/reject", () => {
      const writes = [
        ["create_partner", "POST", "/admin/partners"],
        ["update_partner", "PUT", "/admin/partners/:id"],
        ["assign_partner_task", "POST", "/admin/partners/:id/tasks/:taskId/assign"],
        ["set_partner_person_types", "POST", "/admin/partners/:id/person-types"],
        ["add_partner_admin", "POST", "/admin/partners/:id/admins"],
        ["update_partner_admin", "PATCH", "/admin/partners/:id/admins/:adminId"],
        ["connect_partner_whatsapp", "POST", "/admin/partners/:id/whatsapp-verify"],
        ["bypass_partner_email_verification", "POST", "/admin/partners/:id/bypass-email-verification"],
        ["approve_partner_product", "POST", "/admin/partners/products/:id/approve"],
        ["reject_partner_product", "POST", "/admin/partners/products/:id/reject"],
      ] as const
      for (const [name, method, path] of writes) {
        const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
        expect(def).toBeTruthy()
        expect(def!.write).toBe(true)
        expect(def!.method).toBe(method)
        expect(def!.path).toBe(path)
        expect(isSensitive(def!)).toBe(true)
        expect(isDangerous(def!)).toBe(false)
      }
    })

    it("registers unlink/disconnect DELETE tools as implicitly sensitive (not dangerous)", () => {
      const deletes = [
        ["unlink_partner_people", "/admin/partners/:id/people"],
        ["disconnect_partner_whatsapp", "/admin/partners/:id/whatsapp-verify"],
      ] as const
      for (const [name, path] of deletes) {
        const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
        expect(def).toBeTruthy()
        expect(def!.method).toBe("DELETE")
        expect(def!.path).toBe(path)
        expect(def!.write).toBe(true)
        expect(isSensitive(def!)).toBe(true)
        expect(isDangerous(def!)).toBe(false)
      }
    })

    it("exposes delete_partner as a second dangerous action (confirm + reason)", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "delete_partner")
      expect(def).toBeTruthy()
      expect(def!.write).toBe(true)
      expect(def!.method).toBe("DELETE")
      expect(isDangerous(def!)).toBe(true)
      const schema = buildToolInputSchema(def!)
      expect(schema.properties.reason).toBeDefined()
      expect(schema.properties.confirm).toBeDefined()
    })

    it("update_partner and update_partner_admin declare previewPaths for dry_run", () => {
      const updatePartner = ADMIN_MCP_TOOLS.find((t) => t.name === "update_partner")!
      expect(updatePartner.previewPath).toBe("/admin/partners/:id")

      const updateAdmin = ADMIN_MCP_TOOLS.find((t) => t.name === "update_partner_admin")!
      expect(updateAdmin.previewPath).toBe("/admin/partners/:id/admins")
      expect(updateAdmin.pathParams).toEqual(["id", "adminId"])
    })

    it("dry_run on create_partner previews the plan without executing", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "create_partner",
        {
          partner: { name: "Acme" },
          admin: { email: "a@acme.com", first_name: "A", last_name: "B" },
          dry_run: true,
        }
      )
      expect(res.ok).toBe(true)
      expect(res.dry_run).toBe(true)
      expect(res.plan?.method).toBe("POST")
      expect(res.plan?.path).toBe("/admin/partners")
      expect((res.plan?.body as any)?.partner?.name).toBe("Acme")
    })

    it("connect_partner_whatsapp without confirm returns requires_confirmation, not executed", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "connect_partner_whatsapp",
        { id: "partner_1", phone: "919876543210" }
      )
      expect(res.requires_confirmation).toBe(true)
      expect(res.plan?.path).toBe("/admin/partners/partner_1/whatsapp-verify")
    })

    it("assign_partner_task substitutes both id and taskId path params", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "assign_partner_task",
        { id: "partner_1", taskId: "task_1", dry_run: true }
      )
      expect(res.ok).toBe(true)
      expect(res.plan?.path).toBe("/admin/partners/partner_1/tasks/task_1/assign")
    })
  })

  describe("framework args — parity with the partner dispatcher", () => {
    it("injects context + dry_run onto EVERY tool's input schema", () => {
      for (const def of ADMIN_MCP_TOOLS) {
        const schema = buildToolInputSchema(def)
        expect(schema.properties.context).toBeDefined()
        expect(schema.properties.context.type).toBe("string")
        expect(schema.properties.dry_run).toBeDefined()
      }
    })

    it("adds neither confirm nor reason to a read tool", () => {
      const schema = buildToolInputSchema(
        ADMIN_MCP_TOOLS.find((t) => t.name === "list_orders")!
      )
      expect(schema.properties.confirm).toBeUndefined()
      expect(schema.properties.reason).toBeUndefined()
    })

    it("echoes context on a read tool's dry-run plan (no network)", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999", bearer: "t" },
        "list_orders",
        { dry_run: true, context: "reviewing recent orders" }
      )
      expect(res.ok).toBe(true)
      expect(res.dry_run).toBe(true)
      expect(res.plan?.context).toBe("reviewing recent orders")
      expect(res.plan?.method).toBe("GET")
      expect(res.plan?.path).toBe("/admin/orders")
    })

    it("returns a soft error for an unknown tool", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "does_not_exist",
        {}
      )
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/unknown tool/i)
    })
  })

  // The `dangerous` rail is the admin surface's third rail. Tier 1 has no
  // dangerous tool yet, so exercise the shared dispatcher directly with a
  // synthetic dangerous def — the exact contract later admin tiers rely on.
  describe("dangerous rail (shared core)", () => {
    const DANGEROUS: McpToolDef[] = [
      {
        name: "settle_reconciliation",
        description: "Settle a payout reconciliation.",
        method: "POST",
        path: "/admin/reconciliations/:id/settle",
        pathParams: ["id"],
        write: true,
        dangerous: true,
        inputSchema: { type: "object", properties: {} },
      },
    ]
    const ctx: McpContext = {
      baseUrl: "http://localhost:9999",
      enableWrite: true,
      enableDangerous: true,
      surface: "admin",
    }

    it("injects BOTH reason and confirm onto a dangerous tool's schema", () => {
      const schema = buildToolInputSchema(DANGEROUS[0])
      expect(schema.properties.reason).toBeDefined()
      expect(schema.properties.confirm).toBeDefined()
    })

    it("refuses to run without a reason (even with confirm=true)", async () => {
      const res = await dispatchMcpTool(ctx, DANGEROUS, "settle_reconciliation", {
        id: "recon_1",
        confirm: true,
      })
      expect(res.ok).toBe(true)
      expect(res.requires_reason).toBe(true)
    })

    it("still requires confirmation when a reason is given", async () => {
      const res = await dispatchMcpTool(ctx, DANGEROUS, "settle_reconciliation", {
        id: "recon_1",
        reason: "month-end close",
      })
      expect(res.requires_confirmation).toBe(true)
    })

    it("is hidden/refused when the surface disables dangerous tools", async () => {
      const res = await dispatchMcpTool(
        { ...ctx, enableDangerous: false },
        DANGEROUS,
        "settle_reconciliation",
        { id: "recon_1", reason: "x", confirm: true }
      )
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/dangerous/i)
    })
  })
})
