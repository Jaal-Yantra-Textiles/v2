/**
 * Visual Flow Lifecycle Email — integration test (roadmap item 26)
 *
 * Covers two angles:
 *
 *   1. The execute-visual-flow workflow emits
 *      `visual_flow_execution.started` on entry and
 *      `visual_flow_execution.failed` on operation failure (via the
 *      compensation path), with the failing-operation key and the
 *      real operation error message included on the failed event.
 *
 *   2. The subscriber's in-memory throttle + error-fingerprint helper
 *      collapse repeated failures with the same shape so a broken
 *      flow that fans out N reminders only sends 1 email per
 *      throttle window.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/visual-flow-lifecycle-email
 */

import { Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { __testing as lifecycleTesting } from "../../src/subscribers/visual-flow-lifecycle-email"

jest.setTimeout(120_000)

// Canvas with one `execute_code` operation that throws. Chosen because
// `execute_code` runs in-process (no Meta / OpenRouter / SMTP) so the
// test is deterministic in CI and the failure happens inside the
// per-operation try/catch — exactly the path that writes a "failure"
// row to the log table, which the compensation reads to surface the
// real error in the emitted event.
function buildFailingCanvas() {
  return {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        position: { x: 400, y: 0 },
        data: { label: "Manual Trigger" },
      },
      {
        id: "op_throw",
        type: "operation",
        position: { x: 400, y: 150 },
        data: {
          operationKey: "throw_op",
          operationType: "execute_code",
          label: "Throws",
          options: {
            code: "throw new Error('intentional test failure')",
          },
        },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "trigger",
        target: "op_throw",
        sourceHandle: "default",
        targetHandle: "default",
      },
    ],
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("execute-visual-flow → lifecycle events (roadmap 26)", () => {
    // `getAuthHeaders` returns `{ headers: { Authorization } }` — the
    // axios-friendly request-config shape. Carry it through verbatim
    // so we don't have to unwrap on every call site.
    let headers: Record<string, any>

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)
    })

    it("emits started + failed events with the failing operation key", async () => {
      const container = getContainer()
      const eventBus: any = container.resolve(Modules.EVENT_BUS)

      const captured: Array<{ name: string; data: any }> = []
      const recorder = async (payload: any) => {
        const evts = Array.isArray(payload) ? payload : [payload]
        for (const e of evts) {
          if (
            e?.name === "visual_flow_execution.started" ||
            e?.name === "visual_flow_execution.failed"
          ) {
            captured.push({ name: e.name, data: e.data })
          }
        }
      }
      // Subscribe to both names — local-event-bus supports either
      // direct subscribe (name) or a wildcard. Two explicit subs is
      // the most portable shape across in-memory + redis impls.
      eventBus.subscribe("visual_flow_execution.started", recorder)
      eventBus.subscribe("visual_flow_execution.failed", recorder)

      try {
        const createResp = await api.post(
          "/admin/visual-flows",
          {
            name: "VF Lifecycle Test — Failing Flow",
            status: "active",
            trigger_type: "manual",
            metadata: {
              failure_email: "lifecycle-test@jyt.test",
            },
            canvas_state: buildFailingCanvas(),
          },
          headers
        )
        expect(createResp.status).toBe(201)
        const flowId = createResp.data.flow.id as string

        const execResp = await api.post(
          `/admin/visual-flows/${flowId}/execute`,
          { trigger_data: { source: "lifecycle_test" } },
          { ...headers, validateStatus: () => true }
        )
        // The workflow re-throws when the operation throws — admin
        // route turns that into a non-2xx. Either shape is fine for
        // this test; the lifecycle events are the contract.
        expect([200, 400, 500]).toContain(execResp.status)

        // Subscribers run after the workflow emits — small grace
        // window so the in-memory bus drains before assertions.
        await new Promise((r) => setTimeout(r, 250))

        const started = captured.find(
          (e) => e.name === "visual_flow_execution.started"
        )
        const failed = captured.find(
          (e) => e.name === "visual_flow_execution.failed"
        )

        expect(started).toBeDefined()
        expect(started!.data.flow_id).toBe(flowId)
        expect(started!.data.execution_id).toBeDefined()

        expect(failed).toBeDefined()
        expect(failed!.data.flow_id).toBe(flowId)
        expect(failed!.data.execution_id).toBe(started!.data.execution_id)
        expect(failed!.data.failing_operation_key).toBe("throw_op")
        // The real error survives into the event (vs the generic
        // "Workflow cancelled during execution" pre-fix message).
        expect(String(failed!.data.error_message)).toMatch(
          /intentional test failure/i
        )
        // The flow metadata reaches the event payload so the
        // subscriber can route to flow.metadata.failure_email.
        expect(failed!.data.flow_metadata).toMatchObject({
          failure_email: "lifecycle-test@jyt.test",
        })
      } finally {
        // Best-effort unsubscribe — not every event-bus impl exposes
        // unsubscribe on the public surface, so swallow.
        try {
          eventBus.unsubscribe?.("visual_flow_execution.started", recorder)
          eventBus.unsubscribe?.("visual_flow_execution.failed", recorder)
        } catch {
          /* ignore */
        }
      }
    })
  })

  // NOTE (roadmap 32B): the engine path (FlowExecutionEngine.execute) now
  // emits `visual_flow_execution.failed` from its catch — but it can't be
  // exercised end-to-end here. The engine resolves a flow's graph by matching
  // connection.target_id against operation.id (a generated `vfop_…`), while
  // canvas-built flows store the canvas node id as `operation_key` and wire
  // connections by node id. So the engine finds zero starting operations for a
  // canvas flow and completes empty — a PRE-EXISTING engine graph-resolution
  // gap (the engine path is currently unused), unrelated to the emit fix.
  // The emit mirrors the workflow compensation emit covered above; fixing the
  // engine graph resolver is tracked separately.

  describe("visual-flow-lifecycle-email subscriber helpers", () => {
    const ENV_KEYS = ["VISUAL_FLOW_FAILURE_EMAIL", "MAILJET_FROM_EMAIL"]
    let savedEnv: Record<string, string | undefined>

    beforeEach(() => {
      lifecycleTesting.clearThrottle()
      savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
      for (const k of ENV_KEYS) delete process.env[k]
    })

    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k]
        else process.env[k] = savedEnv[k]
      }
    })

    it("resolveRecipient prefers per-flow metadata, then env, then Mailjet fallback (32B)", () => {
      // 1. per-flow override wins
      process.env.VISUAL_FLOW_FAILURE_EMAIL = "env@jyt.test"
      process.env.MAILJET_FROM_EMAIL = "from@jyt.test"
      expect(
        lifecycleTesting.resolveRecipient({ flow_metadata: { failure_email: "flow@jyt.test" } })
      ).toEqual({ email: "flow@jyt.test", source: "flow.metadata.failure_email" })

      // 2. platform env when no per-flow override
      expect(lifecycleTesting.resolveRecipient({})).toEqual({
        email: "env@jyt.test",
        source: "VISUAL_FLOW_FAILURE_EMAIL",
      })

      // 3. Mailjet from-address as the never-silent floor
      delete process.env.VISUAL_FLOW_FAILURE_EMAIL
      expect(lifecycleTesting.resolveRecipient({})).toEqual({
        email: "from@jyt.test",
        source: "MAILJET_FROM_EMAIL (fallback)",
      })

      // 4. truly nothing configured → null (subscriber then WARN-logs)
      delete process.env.MAILJET_FROM_EMAIL
      expect(lifecycleTesting.resolveRecipient({})).toBeNull()
    })

    it("fingerprint normalises ULID-like ids and truncates", () => {
      // Real Medusa IDs are Crockford base32 ULIDs (e.g.
      // `01KPET5HBGNH9QXGC0MC8RHR39`) — alphanumeric, not hex — so
      // the fingerprint regex must collapse alphanumeric runs, not
      // just hex.
      const fp1 = lifecycleTesting.fingerprint(
        "Meta error: template 01KPET5HBGNH9QXGC0MC8RHR39 has no header component"
      )
      const fp2 = lifecycleTesting.fingerprint(
        "Meta error: template 01KT8ZDV1BPG37K7VTF0D3T4YD has no header component"
      )
      // Both errors describe the same problem with different IDs; the
      // normalised fingerprint should collapse them onto one bucket so
      // the throttle actually deduplicates.
      expect(fp1).toEqual(fp2)
      // Length cap keeps the throttle key bounded regardless of
      // error-message verbosity.
      const long = lifecycleTesting.fingerprint("x".repeat(500))
      expect(long.length).toBeLessThanOrEqual(60)
    })
  })
})
