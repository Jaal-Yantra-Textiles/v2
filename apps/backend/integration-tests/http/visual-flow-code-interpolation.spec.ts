/**
 * Visual Flow — execute_code interpolation (#424)
 *
 * Drives the REAL production path: create a flow whose canvas chains a few
 * `execute_code` nodes, then run it through `POST /:id/execute`
 * (→ executeVisualFlowWorkflow). The workflow passes RAW options to each
 * operation, so this exercises the operation's own `{{...}}` resolution end to
 * end — the path the autonomous engine unit test can't reach.
 *
 * Regression guarded (#424): a `{{ $read_*.records }}` token whose upstream
 * value is a JSON string used to be JSON-stringified INTO the source text,
 * producing invalid code and `Expected property name or '}' at position 1`.
 * Tokens now bind the RAW value into the sandbox, and named outputs are also
 * reachable as `$<operation_key>` aliases.
 *
 * `execute_code` runs in-process (no external services) so this is
 * deterministic in CI.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/visual-flow-code-interpolation
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120_000)

// The named upstream key from the real-world repro.
const READ_KEY = "read_data_1765961329832"

// A JSON STRING (as a "read" step would return it), with embedded quotes — the
// exact shape that broke when spliced into source via JSON.stringify.
const RECORDS_JSON = '[{"sku":"A1"},{"sku":"B2"},{"sku":"C3"}]'

// op_use runs the user's #424 code plus a {{...}} token cross-check:
//   - $last      → previous node output (no `.records` → fallback fires)
//   - $read_*    → alias for the earlier read step (JSON.parse its string)
//   - {{ ... }}  → raw-bound token (must JSON.parse identically, not mangle)
const USE_CODE = `
const fromLast = ($last && $last.records)
const parsed = fromLast || JSON.parse($${READ_KEY}.records)
const viaToken = JSON.parse({{ $${READ_KEY}.records }})
return {
  usedFallback: !fromLast,
  count: parsed.length,
  firstSku: parsed[0].sku,
  tokenCount: viaToken.length,
  tokenMatchesAlias: viaToken.length === parsed.length,
}
`

function buildInterpolationCanvas() {
  const node = (key: string, code: string, y: number) => ({
    id: key,
    type: "operation",
    position: { x: 400, y },
    data: {
      operationKey: key,
      operationType: "execute_code",
      label: key,
      options: { code },
    },
  })

  const edge = (source: string, target: string) => ({
    id: `e_${source}_${target}`,
    source,
    target,
    sourceHandle: "default",
    targetHandle: "default",
  })

  return {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        position: { x: 400, y: 0 },
        data: { label: "Manual Trigger" },
      },
      // Read step: returns records as a JSON STRING.
      node(READ_KEY, `return { records: ${JSON.stringify(RECORDS_JSON)} }`, 150),
      // Noise step: makes $last (for op_use) lack `.records`, forcing the
      // JSON.parse fallback branch to run.
      node("noise", `return { ok: true }`, 300),
      // Use step: the actual interpolation contract under test.
      node("use_records", USE_CODE, 450),
    ],
    edges: [
      edge("trigger", READ_KEY),
      edge(READ_KEY, "noise"),
      edge("noise", "use_records"),
    ],
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("execute_code interpolation end-to-end (#424)", () => {
    let headers: Record<string, any>

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)
    })

    it("resolves $last, $<key> aliases, and {{ }} tokens without mangling JSON", async () => {
      const createResp = await api.post(
        "/admin/visual-flows",
        {
          name: "VF #424 — code interpolation",
          status: "active",
          trigger_type: "manual",
          canvas_state: buildInterpolationCanvas(),
        },
        headers
      )
      expect(createResp.status).toBe(201)
      const flowId = createResp.data.flow.id as string

      const execResp = await api.post(
        `/admin/visual-flows/${flowId}/execute`,
        { trigger_data: { source: "interpolation_test" } },
        { ...headers, validateStatus: () => true }
      )

      expect(execResp.status).toBe(200)
      expect(execResp.data.status).toBe("completed")
      expect(execResp.data.error).toBeFalsy()

      const out = execResp.data.data_chain?.use_records
      expect(out).toBeDefined()
      // Fallback branch ran (noise step's $last had no `.records`).
      expect(out.usedFallback).toBe(true)
      // $<key> alias + JSON.parse of the raw string worked.
      expect(out.count).toBe(3)
      expect(out.firstSku).toBe("A1")
      // {{ }} token bound the RAW JSON string (no stringify round-trip), so it
      // JSON.parses to the same array — the core #424 regression.
      expect(out.tokenCount).toBe(3)
      expect(out.tokenMatchesAlias).toBe(true)
    })

    it("a {{ }} token holding an object binds as a real object, not a stringified copy", async () => {
      // Single read step returns an object; the next node consumes it via a
      // token and reads a nested field. Pre-fix this became `[object Object]`
      // or a quoted JSON string spliced into source.
      const canvas = {
        nodes: [
          {
            id: "trigger",
            type: "trigger",
            position: { x: 400, y: 0 },
            data: { label: "Manual Trigger" },
          },
          {
            id: "make_obj",
            type: "operation",
            position: { x: 400, y: 150 },
            data: {
              operationKey: "make_obj",
              operationType: "execute_code",
              label: "make_obj",
              options: { code: `return { id: 42, nested: { ok: true } }` },
            },
          },
          {
            id: "read_obj",
            type: "operation",
            position: { x: 400, y: 300 },
            data: {
              operationKey: "read_obj",
              operationType: "execute_code",
              label: "read_obj",
              options: {
                code: `const v = {{ $make_obj }}; return { isObject: typeof v === "object", id: v.id, nestedOk: v.nested.ok }`,
              },
            },
          },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "make_obj", sourceHandle: "default", targetHandle: "default" },
          { id: "e2", source: "make_obj", target: "read_obj", sourceHandle: "default", targetHandle: "default" },
        ],
      }

      const createResp = await api.post(
        "/admin/visual-flows",
        { name: "VF #424 — object token", status: "active", trigger_type: "manual", canvas_state: canvas },
        headers
      )
      expect(createResp.status).toBe(201)
      const flowId = createResp.data.flow.id as string

      const execResp = await api.post(
        `/admin/visual-flows/${flowId}/execute`,
        { trigger_data: {} },
        { ...headers, validateStatus: () => true }
      )

      expect(execResp.status).toBe(200)
      expect(execResp.data.status).toBe("completed")
      const out = execResp.data.data_chain?.read_obj
      expect(out).toEqual({ isObject: true, id: 42, nestedOk: true })
    })
  })
})
