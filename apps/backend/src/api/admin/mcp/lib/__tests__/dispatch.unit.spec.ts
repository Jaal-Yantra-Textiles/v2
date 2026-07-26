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

  describe("orders ops (#1165): fulfillment, shipping and order edits", () => {
    it("registers the order read companions", () => {
      const reads = [
        ["list_order_changes", "/admin/orders/:id/changes"],
        ["list_order_designs", "/admin/orders/:id/design"],
        ["list_order_shipping_rates", "/admin/orders/:id/fulfillment-rates"],
        [
          "get_order_fulfillment_label",
          "/admin/orders/:id/fulfillments/:fulfillmentId/label",
        ],
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

    it("registers fulfillment/shipping writes as sensitive (confirm only)", () => {
      const writes = [
        ["update_order", "POST", "/admin/orders/:id"],
        ["create_order_fulfillment", "POST", "/admin/orders/:id/fulfillments"],
        [
          "create_order_shipment",
          "POST",
          "/admin/orders/:id/fulfillments/:fulfillmentId/shipments",
        ],
        [
          "mark_order_fulfillment_delivered",
          "POST",
          "/admin/orders/:id/fulfillments/:fulfillmentId/mark-as-delivered",
        ],
        ["complete_order", "POST", "/admin/orders/:id/complete"],
        ["produce_order_designs", "POST", "/admin/orders/:id/design/produce"],
        ["create_order_shipping_label", "POST", "/admin/orders/:id/fulfillment-label"],
        ["attach_order_awb", "POST", "/admin/orders/:id/shiprocket-attach-awb"],
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

    it("flags the irreversible order actions as dangerous (confirm + reason)", () => {
      const dangerous = [
        ["cancel_order", "/admin/orders/:id/cancel"],
        [
          "cancel_order_fulfillment",
          "/admin/orders/:id/fulfillments/:fulfillmentId/cancel",
        ],
        ["confirm_order_edit", "/admin/order-edits/:id/confirm"],
      ] as const
      for (const [name, path] of dangerous) {
        const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
        expect(def).toBeTruthy()
        expect(def!.path).toBe(path)
        expect(def!.write).toBe(true)
        expect(isDangerous(def!)).toBe(true)
        const schema = buildToolInputSchema(def!)
        expect(schema.properties.reason).toBeDefined()
        expect(schema.properties.confirm).toBeDefined()
      }
    })

    it("registers the staged order-edit loop, with only confirm being dangerous", () => {
      const staged = [
        ["create_order_edit", "POST", "/admin/order-edits"],
        ["add_order_edit_items", "POST", "/admin/order-edits/:id/items"],
        [
          "update_order_edit_item",
          "POST",
          "/admin/order-edits/:id/items/item/:itemId",
        ],
        ["request_order_edit", "POST", "/admin/order-edits/:id/request"],
        ["cancel_order_edit", "DELETE", "/admin/order-edits/:id"],
      ] as const
      for (const [name, method, path] of staged) {
        const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
        expect(def).toBeTruthy()
        expect(def!.method).toBe(method)
        expect(def!.path).toBe(path)
        expect(def!.write).toBe(true)
        expect(isSensitive(def!)).toBe(true)
        expect(isDangerous(def!)).toBe(false)
      }
    })

    it("substitutes both order and fulfillment path params", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "create_order_shipment",
        {
          id: "order_1",
          fulfillmentId: "ful_1",
          items: [{ id: "item_1", quantity: 2 }],
          dry_run: true,
        }
      )
      expect(res.ok).toBe(true)
      expect(res.plan?.path).toBe(
        "/admin/orders/order_1/fulfillments/ful_1/shipments"
      )
      expect((res.plan?.body as any)?.items).toHaveLength(1)
    })

    it("create_order_fulfillment without confirm returns requires_confirmation", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "create_order_fulfillment",
        { id: "order_1", items: [{ id: "item_1", quantity: 1 }] }
      )
      expect(res.requires_confirmation).toBe(true)
      expect(res.plan?.path).toBe("/admin/orders/order_1/fulfillments")
    })

    it("list_orders exposes kind so the model can reach non-retail orders", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "list_orders")!
      expect(def.queryParams).toContain("kind")
    })
  })

  describe("production runs (#1167): lifecycle levers", () => {
    it("registers the run read companions", () => {
      const reads = [
        ["get_production_run", "/admin/production-runs/:id"],
        ["list_production_run_activities", "/admin/production-runs/:id/activities"],
        ["get_production_run_cost_summary", "/admin/production-runs/:id/cost-summary"],
        ["get_production_run_task", "/admin/production-runs/:id/tasks/:taskId"],
        ["get_production_run_policy", "/admin/production-run-policy"],
      ] as const
      for (const [name, path] of reads) {
        const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
        expect(def).toBeTruthy()
        expect(def!.method ?? "GET").toBe("GET")
        expect(def!.path).toBe(path)
        expect(def!.write).toBeFalsy()
      }
    })

    it("registers the lifecycle writes as sensitive", () => {
      const writes = [
        ["create_production_run", "POST", "/admin/production-runs"],
        ["update_production_run", "POST", "/admin/production-runs/:id"],
        ["approve_production_run", "POST", "/admin/production-runs/:id/approve"],
        [
          "send_production_run_to_production",
          "POST",
          "/admin/production-runs/:id/send-to-production",
        ],
        [
          "start_production_run_dispatch",
          "POST",
          "/admin/production-runs/:id/start-dispatch",
        ],
        [
          "resume_production_run_dispatch",
          "POST",
          "/admin/production-runs/:id/resume-dispatch",
        ],
        ["update_production_run_task", "POST", "/admin/production-runs/:id/tasks/:taskId"],
        ["update_production_run_policy", "PUT", "/admin/production-run-policy"],
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

    it("cancel_production_run is dangerous and forwards the audited reason as the cancel reason", async () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "cancel_production_run")!
      expect(isDangerous(def)).toBe(true)
      expect(def.bodyParams).toContain("reason")

      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "cancel_production_run",
        { id: "prun_1", reason: "partner dropped out", dry_run: true }
      )
      expect(res.ok).toBe(true)
      expect(res.plan?.path).toBe("/admin/production-runs/prun_1/cancel")
      expect((res.plan?.body as any)?.reason).toBe("partner dropped out")
    })

    it("list_production_runs drops the unsupported q filter and exposes the real ones", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "list_production_runs")!
      // The route has no free-text search — declaring `q` would silently
      // swallow the model's search term.
      expect(def.queryParams).not.toContain("q")
      for (const p of ["status", "partner_id", "design_id", "run_type"]) {
        expect(def.queryParams).toContain(p)
      }
    })

    it("approve_production_run carries partner assignments in the body", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "approve_production_run",
        {
          id: "prun_1",
          assignments: [{ partner_id: "partner_1", quantity: 10 }],
          dry_run: true,
        }
      )
      expect(res.ok).toBe(true)
      expect(res.plan?.path).toBe("/admin/production-runs/prun_1/approve")
      expect((res.plan?.body as any)?.assignments?.[0]?.partner_id).toBe("partner_1")
    })

    it("resume_production_run_dispatch requires the transaction_id from start", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "resume_production_run_dispatch")!
      expect(def.bodyParams).toContain("transaction_id")
      expect(def.inputSchema.required).toEqual(
        expect.arrayContaining(["id", "template_names", "transaction_id"])
      )
    })
  })

  describe("designs (#1166): design -> production pipeline", () => {
    it("registers the design read companions", () => {
      const reads = [
        ["list_design_work_orders", "/admin/design-work-orders"],
        ["list_design_revisions", "/admin/designs/:id/revisions"],
        ["list_design_inventory", "/admin/designs/:id/inventory"],
        ["list_design_tasks", "/admin/designs/:id/tasks"],
        ["get_design_task", "/admin/designs/:id/tasks/:taskId"],
      ] as const
      for (const [name, path] of reads) {
        const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
        expect(def).toBeTruthy()
        expect(def!.method ?? "GET").toBe("GET")
        expect(def!.path).toBe(path)
        expect(def!.write).toBeFalsy()
      }
    })

    it("registers the pipeline writes as sensitive, none dangerous", () => {
      const writes = [
        ["create_design", "POST", "/admin/designs"],
        ["update_design", "PUT", "/admin/designs/:id"],
        ["link_design_partners", "POST", "/admin/designs/:id/partner"],
        ["unlink_design_partner", "DELETE", "/admin/designs/:id/partner"],
        ["create_design_production_run", "POST", "/admin/designs/:id/production-runs"],
        ["produce_designs", "POST", "/admin/designs/produce"],
        [
          "recreate_design_production_run",
          "POST",
          "/admin/designs/recreate-production-run",
        ],
        [
          "cancel_design_partner_assignment",
          "POST",
          "/admin/designs/:id/cancel-partner-assignment",
        ],
        ["update_design_task", "POST", "/admin/designs/:id/tasks/:taskId"],
        ["assign_design_task", "POST", "/admin/designs/:id/tasks/:taskId/assign"],
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

    it("update_design carries size_sets — the only route that can set them", () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "update_design")!
      expect(def.bodyParams).toContain("size_sets")
      expect(def.previewPath).toBe("/admin/designs/:id")
      expect(def.inputSchema.properties.size_sets).toBeDefined()
    })

    it("produce_designs previews a batch send-to-production without executing", async () => {
      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "produce_designs",
        { design_ids: ["design_1", "design_2"], partner_id: "partner_1", dry_run: true }
      )
      expect(res.ok).toBe(true)
      expect(res.dry_run).toBe(true)
      expect(res.plan?.path).toBe("/admin/designs/produce")
      expect((res.plan?.body as any)?.design_ids).toHaveLength(2)
    })

    it("assign_design_task sends taskId in BOTH the path and the body (route validator wants both)", async () => {
      const def = ADMIN_MCP_TOOLS.find((t) => t.name === "assign_design_task")!
      expect(def.pathParams).toEqual(["id", "taskId"])
      expect(def.bodyParams).toEqual(expect.arrayContaining(["taskId", "partnerId"]))

      const res = await dispatchAdminTool(
        { baseUrl: "http://localhost:9999" },
        "assign_design_task",
        { id: "design_1", taskId: "task_1", partnerId: "partner_1", dry_run: true }
      )
      expect(res.plan?.path).toBe("/admin/designs/design_1/tasks/task_1/assign")
      expect((res.plan?.body as any)?.taskId).toBe("task_1")
    })

    it("does NOT wrap the AI-generation / file-shaped design routes", () => {
      // These cost money per call, need an uploaded image, or return payloads
      // (SVG documents, Excalidraw scenes) that would blow the chat context.
      const excluded = [
        "/admin/designs/auto",
        "/admin/designs/:id/segment",
        "/admin/designs/:id/outline",
        "/admin/designs/:id/redesign",
        "/admin/designs/:id/moodboard/generate",
        "/admin/designs/:id/pattern-blocks",
      ]
      for (const path of excluded) {
        expect(ADMIN_MCP_TOOLS.find((t) => t.path === path)).toBeUndefined()
      }
    })
  })

  describe("registry-wide invariants across all tiers", () => {
    it("every write tool declares a non-GET method and at least one guard", () => {
      for (const def of ADMIN_MCP_TOOLS.filter((t) => t.write)) {
        expect(def.method ?? "GET").not.toBe("GET")
        expect(isSensitive(def)).toBe(true)
      }
    })

    it("every previewPath is a subset of its tool's own path params", () => {
      for (const def of ADMIN_MCP_TOOLS) {
        if (!def.previewPath) continue
        // Anything left as `:param` after substitution would produce a bogus
        // preview URL, so the preview path must only use declared params.
        const previewParams = [...def.previewPath.matchAll(/:([A-Za-z0-9_]+)/g)].map(
          (m) => m[1]
        )
        for (const p of previewParams) {
          expect(def.pathParams ?? []).toContain(p)
        }
      }
    })

    it("every declared path param actually appears in the tool's path", () => {
      for (const def of ADMIN_MCP_TOOLS) {
        for (const p of def.pathParams ?? []) {
          expect(def.path).toContain(`:${p}`)
        }
      }
    })

    it("every path/body/query param is described in the tool's input schema", () => {
      for (const def of ADMIN_MCP_TOOLS) {
        const props = def.inputSchema?.properties ?? {}
        for (const p of def.pathParams ?? []) {
          expect(`${def.name}:${p}`).toBe(props[p] ? `${def.name}:${p}` : "MISSING")
        }
        for (const p of def.queryParams ?? []) {
          expect(`${def.name}:${p}`).toBe(props[p] ? `${def.name}:${p}` : "MISSING")
        }
        for (const p of def.bodyParams ?? []) {
          // `reason` is injected by the dangerous rail, not declared per-tool.
          if (p === "reason" && isDangerous(def)) continue
          expect(`${def.name}:${p}`).toBe(props[p] ? `${def.name}:${p}` : "MISSING")
        }
      }
    })

    it("every nextSteps hint points at a tool that exists", () => {
      const names = new Set(ADMIN_MCP_TOOLS.map((t) => t.name))
      for (const def of ADMIN_MCP_TOOLS) {
        for (const step of def.nextSteps ?? []) {
          expect(`${def.name} -> ${step}`).toBe(
            names.has(step) ? `${def.name} -> ${step}` : "DANGLING"
          )
        }
      }
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
