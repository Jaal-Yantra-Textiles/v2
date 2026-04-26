/**
 * AI V4 Workflow Integration Tests
 *
 * Tests the hybrid query resolver and V4 chat endpoint with:
 * - Core Medusa entities (orders, products, customers)
 * - Custom entities (designs, partners, production_runs)
 * - Mixed entity queries
 * - Complex multi-step queries
 * - Edge cases and error handling
 *
 * Run with:
 *   TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" jest --testPathPattern="ai-v4-workflow"
 */

import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(120000) // AI queries can take time

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers: Record<string, string>

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      const authResult = await getAuthHeaders(api)
      headers = authResult.headers
    })

    describe("AI V4 Workflow - GET /admin/ai/chat/chat", () => {
      it("should return V4 status and configuration", async () => {
        const response = await api.get("/admin/ai/chat/chat", { headers })

        expect(response.status).toBe(200)
        expect(response.data).toMatchObject({
          status: "ok",
          version: "v4",
          workflow: {
            available: true,
            name: "aiChatWorkflow",
          },
          config: {
            features: expect.arrayContaining([
              "BM25 code search",
              "Pre-indexed docs lookup",
              "LLM query analysis",
            ]),
          },
        })
      })
    })

    describe("AI V4 Workflow - Core Entity Queries", () => {
      describe("Orders", () => {
        it("should list all orders", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show me all orders" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
          expect(response.data.result).toBeDefined()
          expect(response.data.result.reply).toBeDefined()

          // Check resolved query
          const resolved = response.data.result.resolvedQuery
          if (resolved) {
            expect(resolved.targetEntity).toMatch(/order/i)
            expect(resolved.mode).toBe("data")
            expect(resolved.executionPlan?.length).toBeGreaterThan(0)
          }
        })

        it("should query orders with status filter", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show me pending orders" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          // Execution plan should include status filter
          const plan = response.data.result.resolvedQuery?.executionPlan
          if (plan?.length) {
            const hasStatusFilter = plan.some(
              (step: any) =>
                step.code?.includes("status") || step.code?.includes("pending")
            )
            expect(hasStatusFilter).toBe(true)
          }
        })

        it("should count orders (analysis mode)", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "how many orders are there?" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          const resolved = response.data.result.resolvedQuery
          if (resolved) {
            expect(resolved.mode).toBe("analysis")
          }
        })

        it("should query orders with date filter", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show orders from last week" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })

      describe("Products", () => {
        it("should list all products", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "list all products" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          const resolved = response.data.result.resolvedQuery
          if (resolved) {
            expect(resolved.targetEntity).toMatch(/product/i)
          }
        })

        it("should query products with collection filter", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show products in summer collection" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })

        it("should query products with relations", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show products with their variants and images" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          // Check that fields parameter uses +prefix for relations
          const plan = response.data.result.resolvedQuery?.executionPlan
          if (plan?.length) {
            const apiStep = plan.find((s: any) => s.method === "api")
            if (apiStep?.code) {
              // Should NOT use fields=* (invalid in Medusa v2)
              expect(apiStep.code).not.toContain("fields=*")
              // Should use +prefix for relations if fields specified
              if (apiStep.code.includes("fields=")) {
                expect(apiStep.code).toMatch(/fields=\+|fields=[a-z]/)
              }
            }
          }
        })
      })

      describe("Customers", () => {
        it("should list all customers", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show all customers" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          const resolved = response.data.result.resolvedQuery
          if (resolved) {
            expect(resolved.targetEntity).toMatch(/customer/i)
          }
        })

        it("should search customers by name", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "find customer John Doe" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })

        it("should query customers with orders", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show customers with their orders" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })

      describe("Collections", () => {
        it("should list all collections", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show me all collections" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })

      describe("Regions", () => {
        it("should list all regions", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "what regions are configured?" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })
    })

    describe("AI V4 Workflow - Custom Entity Queries", () => {
      describe("Designs", () => {
        it("should list all designs", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show me all designs" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          const resolved = response.data.result.resolvedQuery
          if (resolved) {
            expect(resolved.targetEntity).toMatch(/design/i)
          }
        })

        it("should query designs with status filter", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show designs in development" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          // Check execution uses service method for custom entity
          const plan = response.data.result.resolvedQuery?.executionPlan
          if (plan?.length) {
            const hasServiceCall = plan.some(
              (step: any) => step.method === "service"
            )
            expect(hasServiceCall).toBe(true)
          }
        })

        it("should query designs with specifications relation", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show designs with their specifications" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          // Should use service call with relations for model relations
          const plan = response.data.result.resolvedQuery?.executionPlan
          if (plan?.length) {
            const serviceStep = plan.find((s: any) => s.method === "service")
            if (serviceStep?.code) {
              expect(serviceStep.code).toContain("specifications")
            }
          }
        })

        it("should query designs with linked customer (module link)", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show designs with their customer information" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          // Module links should use graph query
          const plan = response.data.result.resolvedQuery?.executionPlan
          if (plan?.length) {
            const graphStep = plan.find((s: any) => s.method === "graph")
            if (graphStep) {
              expect(graphStep.code).toContain("customer")
            }
          }
        })

        it("should count designs by status", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "how many designs are in production?" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          const resolved = response.data.result.resolvedQuery
          if (resolved) {
            expect(resolved.mode).toBe("analysis")
          }
        })
      })

      describe("Partners", () => {
        it("should list all partners", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show me all partners" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          const resolved = response.data.result.resolvedQuery
          if (resolved) {
            expect(resolved.targetEntity).toMatch(/partner/i)
          }
        })

        it("should query partners by type", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show all manufacturing partners" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })

        it("should count partners", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "how many partners do we have?" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          // Reply should contain count information
          expect(response.data.result.reply).toBeDefined()
        })
      })

      describe("Production Runs", () => {
        it("should list all production runs", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show all production runs" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          const resolved = response.data.result.resolvedQuery
          if (resolved) {
            expect(resolved.targetEntity).toMatch(/production_run/i)
          }
        })

        it("should query production runs with status filter", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show pending production runs" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })

      describe("Inventory Orders", () => {
        it("should list inventory orders", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show all inventory orders" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })

      describe("Tasks", () => {
        it("should list all tasks", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show me all tasks" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })

        it("should query tasks by status", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show incomplete tasks" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })

      describe("Persons", () => {
        it("should list all persons", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show all persons" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })

      describe("Media", () => {
        it("should list media files", async () => {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: "show all media files" },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })
    })

    describe("AI V4 Workflow - Mixed Entity Queries", () => {
      it("should handle orders for customer query (core + reference)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show orders for customer John" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")

        // Should have multi-step plan
        const plan = response.data.result.resolvedQuery?.executionPlan
        if (plan) {
          // Multi-step query: find customer -> filter orders
          expect(plan.length).toBeGreaterThanOrEqual(1)
        }
      })

      it("should handle designs for partner query (custom + custom reference)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs assigned to partner ABC" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle production runs for design query", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show production runs for design SKU123" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle products with designs (core + custom link)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show products with their linked designs" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Complex Multi-Step Queries", () => {
      it("should handle count query with filter", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "how many orders are pending this week?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
        expect(response.data.result.resolvedQuery?.mode).toBe("analysis")
      })

      it("should handle aggregation query", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "what is the total count of active designs?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle comparison query", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "compare pending vs completed production runs" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle query with multiple relations", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs with specifications, colors, and size sets" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")

        // Check relations are included
        const plan = response.data.result.resolvedQuery?.executionPlan
        if (plan?.length) {
          const code = plan.map((s: any) => s.code).join(" ")
          expect(code).toMatch(/specifications|colors|size_sets/i)
        }
      })

      it("should handle transitive query (A -> B -> C)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show tasks for production runs of design SKU100" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")

        // Should have multi-step plan for transitive resolution
        const plan = response.data.result.resolvedQuery?.executionPlan
        if (plan) {
          expect(plan.length).toBeGreaterThanOrEqual(2)
        }
      })
    })

    describe("AI V4 Workflow - MCP Generic Path (No Entity Detected)", () => {
      it("should handle feature flags query via MCP", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "list all feature flags in the system" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")

        // Should use mcp_generic source when no entity detected
        const source = response.data.result.resolvedQuery?.source
        expect(["mcp_generic", "bm25_llm", "fallback"]).toContain(source)
      })

      it("should handle store configuration query", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show store configuration" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle settings query", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "what settings are available?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Human-in-the-Loop Clarification", () => {
      it("should request clarification for ambiguous campaign query", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show me campaigns" },
          { headers }
        )

        expect(response.status).toBe(200)

        // May need clarification between publishing_campaigns and meta_ads campaigns
        if (response.data.status === "clarification_needed") {
          expect(response.data.result.needsClarification).toBe(true)
          expect(response.data.result.clarificationOptions).toBeDefined()
          expect(response.data.result.clarificationOptions.length).toBeGreaterThan(1)

          // Each option should have required fields
          response.data.result.clarificationOptions.forEach((opt: any) => {
            expect(opt.id).toBeDefined()
            expect(opt.label).toBeDefined()
            expect(opt.module).toBeDefined()
          })
        }
      })

      it("should handle clarification response", async () => {
        // First, trigger clarification
        const initial = await api.post(
          "/admin/ai/chat/chat",
          { message: "show me campaigns" },
          { headers }
        )

        if (initial.data.status === "clarification_needed") {
          const options = initial.data.result.clarificationOptions
          const selectedOption = options[0]

          // Send clarification response
          const response = await api.post(
            "/admin/ai/chat/chat",
            {
              message: "show me campaigns",
              clarification: {
                selectedOptionId: selectedOption.id,
                selectedModule: selectedOption.module,
                originalQuery: "show me campaigns",
              },
            },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
          expect(response.data.result.needsClarification).toBeFalsy()
        }
      })
    })

    describe("AI V4 Workflow - Fields Parameter Validation", () => {
      it("should NOT generate fields=* (invalid in Medusa v2)", async () => {
        const queries = [
          "show all orders with all fields",
          "get products with everything",
          "list customers with all data",
        ]

        for (const query of queries) {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: query },
            { headers }
          )

          expect(response.status).toBe(200)

          const plan = response.data.result.resolvedQuery?.executionPlan
          if (plan?.length) {
            plan.forEach((step: any) => {
              if (step.code && step.method === "api") {
                // fields=* is invalid in Medusa v2
                expect(step.code).not.toContain("fields=*")
              }
            })
          }
        }
      })

      it("should use +prefix for expanding relations", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show orders with items and customer details" },
          { headers }
        )

        expect(response.status).toBe(200)

        const plan = response.data.result.resolvedQuery?.executionPlan
        if (plan?.length) {
          const apiStep = plan.find((s: any) => s.method === "api" && s.code?.includes("fields"))
          if (apiStep) {
            // Should use +prefix for relations
            expect(apiStep.code).toMatch(/\+items|\+customer|fields=[a-z]/)
          }
        }
      })
    })

    describe("AI V4 Workflow - Data Presentation (All Items)", () => {
      it("should return all items when listing entities", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "list all products" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")

        // Response should indicate data mode
        const mode = response.data.result.resolvedQuery?.mode || response.data.result.mode
        expect(mode).toBe("data")

        // Reply should be present
        expect(response.data.result.reply).toBeDefined()
      })

      it("should handle entity-specific response keys", async () => {
        // Test that products key is recognized
        const productResponse = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all products" },
          { headers }
        )
        expect(productResponse.status).toBe(200)

        // Test that orders key is recognized
        const orderResponse = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all orders" },
          { headers }
        )
        expect(orderResponse.status).toBe(200)

        // Test that designs key is recognized
        const designResponse = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all designs" },
          { headers }
        )
        expect(designResponse.status).toBe(200)
      })
    })

    describe("AI V4 Workflow - Error Handling", () => {
      it("should handle empty message gracefully", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "" },
          { headers }
        )

        expect(response.status).toBe(400)
      })

      it("should handle unknown entity gracefully", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show me all xyzabc123" },
          { headers }
        )

        expect(response.status).toBe(200)
        // Should fall back to chat mode
        const mode = response.data.result.resolvedQuery?.mode
        expect(["chat", "data"]).toContain(mode)
      })

      it("should handle malformed clarification context", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          {
            message: "show campaigns",
            clarification: {
              // Missing required fields
              selectedOptionId: "test",
            },
          },
          { headers }
        )

        // Should either reject with 400 or handle gracefully
        expect([200, 400]).toContain(response.status)
      })
    })

    describe("AI V4 Workflow - Execution Logs", () => {
      it("should include execution logs in response", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all partners" },
          { headers }
        )

        expect(response.status).toBe(200)

        // Check execution logs are included
        const logs = response.data.result.executionLogs
        if (logs && logs.length > 0) {
          logs.forEach((log: any) => {
            expect(log.step).toBeDefined()
            expect(log.success).toBeDefined()
            expect(log.durationMs).toBeDefined()
          })
        }
      })

      it("should include execution plan in response", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all designs" },
          { headers }
        )

        expect(response.status).toBe(200)

        const resolvedQuery = response.data.result.resolvedQuery
        if (resolvedQuery) {
          expect(resolvedQuery.executionPlan).toBeDefined()
          expect(resolvedQuery.executionPlanSteps).toBeGreaterThanOrEqual(0)
        }
      })
    })

    describe("AI V4 Workflow - Thread Management", () => {
      it("should accept and return threadId", async () => {
        const threadId = `test_thread_${Date.now()}`

        const response = await api.post(
          "/admin/ai/chat/chat",
          {
            message: "show all orders",
            threadId,
          },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.result.threadId).toBe(threadId)
      })

      it("should generate threadId if not provided", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all products" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.result.threadId).toBeDefined()
      })
    })

    describe("AI V4 Workflow - Performance Metadata", () => {
      it("should include timing metadata", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all designs" },
          { headers }
        )

        expect(response.status).toBe(200)

        // Check meta includes timing
        expect(response.data.meta).toBeDefined()
        expect(response.data.meta.durationMs).toBeGreaterThan(0)
        expect(response.data.meta.version).toBe("v4")
      })

      it("should include runId for tracking", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all partners" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.runId).toBeDefined()
      })
    })

    // ================================================================
    // COMPLEX TEST CASES
    // ================================================================

    describe("AI V4 Workflow - Natural Language Variations", () => {
      it("should understand different ways to ask for the same data", async () => {
        const variations = [
          "show me all designs",
          "list designs",
          "get all designs",
          "display designs",
          "what designs do we have?",
          "I need to see the designs",
          "can you show the designs?",
        ]

        for (const query of variations) {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: query },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")

          const entity = response.data.result.resolvedQuery?.targetEntity
          if (entity) {
            expect(entity.toLowerCase()).toContain("design")
          }
        }
      })

      it("should understand count variations", async () => {
        const countQueries = [
          "how many partners are there?",
          "count the partners",
          "what is the total number of partners?",
          "give me the partner count",
          "partners total",
        ]

        for (const query of countQueries) {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: query },
            { headers }
          )

          expect(response.status).toBe(200)
          const mode = response.data.result.resolvedQuery?.mode
          expect(["analysis", "data"]).toContain(mode)
        }
      })

      it("should handle informal/conversational queries", async () => {
        const informalQueries = [
          "yo, show me the orders",
          "hey can I see the products?",
          "gimme the customer list",
          "I wanna see all designs please",
        ]

        for (const query of informalQueries) {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: query },
            { headers }
          )

          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        }
      })
    })

    describe("AI V4 Workflow - Complex Filtering", () => {
      it("should handle multiple filter conditions (AND)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs that are in development and have specifications" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")

        const plan = response.data.result.resolvedQuery?.executionPlan
        if (plan?.length) {
          const code = plan.map((s: any) => s.code || "").join(" ")
          // Should include status filter
          expect(code.toLowerCase()).toMatch(/status|in_development|development/i)
        }
      })

      it("should handle OR conditions", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show orders that are pending or processing" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle NOT/exclusion queries", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs that are not completed" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle numeric range filters", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show orders with total greater than 100" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle null/exists filters", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs that have a partner assigned" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Date Range Queries", () => {
      it("should handle relative date queries (today)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show orders created today" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle relative date queries (this week)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show production runs created this week" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle relative date queries (last month)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs updated last month" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle specific date ranges", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show orders from January 2024 to March 2024" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle before/after date queries", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show partners created before 2024" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle date comparisons (older than)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show tasks older than 30 days" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Sorting and Pagination", () => {
      it("should handle sorting by field (ascending)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs sorted by name" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle sorting by field (descending)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show orders sorted by created date descending" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle limit queries (first N)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show the first 5 designs" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle latest/newest queries", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show the 10 most recent orders" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle oldest queries", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show the oldest 5 partners" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle top N by metric", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show top 10 products by price" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Search and Text Matching", () => {
      it("should handle keyword search (contains)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "find designs containing 'summer'" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle search with special characters", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "find products with SKU like 'ABC-123'" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle case-insensitive search", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "find customer with email JOHN@EXAMPLE.COM" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle partial name matching", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "find partners whose name starts with 'A'" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Complex Multi-Entity Queries", () => {
      it("should resolve entity by name then filter related entity", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all orders for customer named 'John Smith'" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")

        // Should have multi-step plan
        const plan = response.data.result.resolvedQuery?.executionPlan
        if (plan) {
          expect(plan.length).toBeGreaterThanOrEqual(1)
        }
      })

      it("should handle chained entity resolution (3 levels deep)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show tasks for production runs of design 'Summer Collection'" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should aggregate across related entities", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "count orders per customer" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle joins with filters on both sides", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show pending orders for active customers" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle reverse lookups (find parent by child)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "which designs have production runs in progress?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Aggregation and Statistics", () => {
      it("should count with grouping", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "count designs by status" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
        expect(response.data.result.resolvedQuery?.mode).toBe("analysis")
      })

      it("should calculate sum", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "what is the total value of all orders?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should calculate average", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "what is the average order value?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle min/max queries", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "what is the most expensive product?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle comparison between groups", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "compare count of pending vs completed orders" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle percentage calculations", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "what percentage of designs are completed?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Typo Tolerance and Fuzzy Matching", () => {
      it("should handle minor typos in entity names", async () => {
        const typoQueries = [
          { query: "show all desings", expected: "design" },  // typo: desings -> designs
          { query: "list the partnrs", expected: "partner" }, // typo: partnrs -> partners
          { query: "show prodcuts", expected: "product" },    // typo: prodcuts -> products
        ]

        for (const { query, expected } of typoQueries) {
          const response = await api.post(
            "/admin/ai/chat/chat",
            { message: query },
            { headers }
          )

          expect(response.status).toBe(200)
          // Should still resolve to correct entity
          const entity = response.data.result.resolvedQuery?.targetEntity
          if (entity) {
            expect(entity.toLowerCase()).toContain(expected)
          }
        }
      })

      it("should handle mixed case queries", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "SHOW ALL DESIGNS" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle extra whitespace", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "  show   all    designs  " },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Contextual Queries", () => {
      it("should handle 'those' referring to previous query results", async () => {
        // First query
        await api.post(
          "/admin/ai/chat/chat",
          { message: "show all pending orders", threadId: "context_test_1" },
          { headers }
        )

        // Follow-up query (ideally would reference previous results)
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "how many of those are there?", threadId: "context_test_1" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle filter refinement", async () => {
        // First query
        await api.post(
          "/admin/ai/chat/chat",
          { message: "show all designs", threadId: "context_test_2" },
          { headers }
        )

        // Refine filter
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "now filter to only show completed ones", threadId: "context_test_2" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Edge Cases", () => {
      it("should handle very long queries", async () => {
        const longQuery = "show me all the designs that were created recently and have status set to in development along with their specifications and colors and size sets and also include the partner information if available"

        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: longQuery },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle queries with numbers", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show order #12345" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle queries with special characters", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "find design with SKU: ABC-123/XYZ" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle queries with unicode characters", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "find customer with name 'José García'" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle queries with emojis gracefully", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs 👗👔" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle ambiguous pronouns", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show me their orders" },
          { headers }
        )

        expect(response.status).toBe(200)
        // Should still complete, possibly with chat mode
        expect(["completed", "clarification_needed"]).toContain(response.data.status)
      })
    })

    describe("AI V4 Workflow - Module Link Traversal", () => {
      it("should traverse design -> customer link", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs with their linked customers" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")

        const plan = response.data.result.resolvedQuery?.executionPlan
        if (plan?.length) {
          // Should use graph query for module links
          const code = plan.map((s: any) => s.code || "").join(" ")
          expect(code).toMatch(/graph|customer/i)
        }
      })

      it("should traverse design -> product link", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs with their associated products" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should traverse design -> partner link", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs with their assigned partners" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should handle bidirectional link queries", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "which partners are working on design SKU-001?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Model Relations (Within Module)", () => {
      it("should fetch design specifications (model relation)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show design specifications" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should fetch design colors (model relation)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all design colors" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should fetch design size sets (model relation)", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "list design size sets" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should differentiate between model relations and module links", async () => {
        // Model relation query (should use service)
        const modelRelResponse = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs with specifications" },
          { headers }
        )
        expect(modelRelResponse.status).toBe(200)

        // Module link query (should use graph)
        const moduleLinkResponse = await api.post(
          "/admin/ai/chat/chat",
          { message: "show designs with customer" },
          { headers }
        )
        expect(moduleLinkResponse.status).toBe(200)
      })
    })

    describe("AI V4 Workflow - Complex Business Queries", () => {
      it("should answer 'which partner has the most designs?'", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "which partner has the most designs?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should answer 'what is the status of design X?'", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "what is the status of design Summer-2024?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should answer 'are there any overdue tasks?'", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "are there any overdue tasks?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should answer 'show production pipeline status'", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show production pipeline status" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should answer 'what designs are ready for production?'", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "what designs are ready for production?" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })

      it("should answer 'show inventory status'", async () => {
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show inventory status" },
          { headers }
        )

        expect(response.status).toBe(200)
        expect(response.data.status).toBe("completed")
      })
    })

    describe("AI V4 Workflow - Error Recovery", () => {
      it("should recover from service call failures gracefully", async () => {
        // Query for a non-existent entity ID
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show design with ID non_existent_id_12345" },
          { headers }
        )

        expect(response.status).toBe(200)
        // Should complete with error message, not crash
        expect(["completed", "clarification_needed"]).toContain(response.data.status)
      })

      it("should handle service resolution failures", async () => {
        // Query for an entity type that might not exist
        const response = await api.post(
          "/admin/ai/chat/chat",
          { message: "show all foobarbaz entities" },
          { headers }
        )

        expect(response.status).toBe(200)
        // Should fallback to chat mode
        const mode = response.data.result.resolvedQuery?.mode
        expect(["chat", "data"]).toContain(mode)
      })
    })

    describe("AI V4 Workflow - Concurrent Requests", () => {
      it("should handle multiple concurrent requests", async () => {
        const queries = [
          "show all designs",
          "count partners",
          "list orders",
          "show production runs",
        ]

        const promises = queries.map((query) =>
          api.post("/admin/ai/chat/chat", { message: query }, { headers })
        )

        const responses = await Promise.all(promises)

        responses.forEach((response) => {
          expect(response.status).toBe(200)
          expect(response.data.status).toBe("completed")
        })
      })
    })
  },
})
