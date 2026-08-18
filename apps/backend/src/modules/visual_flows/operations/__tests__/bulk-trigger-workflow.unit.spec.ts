/**
 * Unit tests for the visual-flows `bulk_trigger_workflow` operation —
 * specifically the `idempotency_key_template` per-item lock (#1334).
 *
 * The regression this guards: two concurrent flow executions (e.g. during a
 * rolling ECS deploy) both read the same abandoned carts, both build
 * `send_items`, and both trigger `send-notification-email` for the same cart.
 * The `idempotency_key_template` option wraps each item's trigger in a
 * distributed lock (Modules.LOCKING). `acquire` is non-blocking — it throws
 * immediately when the lock is already held — so the second execution skips
 * the item instead of producing a duplicate send.
 *
 * The operation only reads `context.container` + `context.dataChain`, so we
 * can invoke it directly without booting Medusa.
 */

import { bulkTriggerWorkflowOperation } from "../bulk-trigger-workflow"

/** A minimal fake locking service that records calls and can be pre-locked. */
function makeLocking(preLockedKeys: Set<string> = new Set()) {
  const held = new Set<string>()       // currently held
  const everAcquired = new Set<string>() // all keys ever acquired (for assertions)
  const released = new Set<string>()
  return {
    acquired: everAcquired,
    released,
    locking: {
      acquire: jest.fn(async (key: string) => {
        if (preLockedKeys.has(key) || held.has(key)) {
          throw new Error("Failed to acquire lock")
        }
        held.add(key)
        everAcquired.add(key)
      }),
      release: jest.fn(async (key: string) => {
        held.delete(key)
        released.add(key)
      }),
    },
  }
}

/** A minimal fake workflow engine that records runs. */
function makeWorkflowEngine() {
  const runs: any[] = []
  return {
    runs,
    engine: {
      run: jest.fn(async (_name: string, opts: any) => {
        runs.push(opts)
        return { result: { id: `wf-${runs.length}` }, errors: null }
      }),
    },
  }
}

function makeContext(
  dataChain: Record<string, any>,
  container: any
): any {
  return {
    container,
    dataChain: {
      $trigger: { payload: {}, timestamp: "2026-08-18T00:00:00.000Z" },
      $accountability: {},
      $env: {},
      $last: null,
      ...dataChain,
    },
    flowId: "flow_test",
    executionId: "exec_test",
    operationId: "op_test",
    operationKey: "dispatch",
  }
}

/** Build a fake container that resolves `workflows` → engine and `locking` → locking service. */
function makeContainer(engine: any, locking: any) {
  return {
    resolve: (name: string) => {
      if (name === "workflows") return engine
      if (name === "locking") return locking
      return undefined
    },
  }
}

const SEND_ITEMS = [
  { cart_id: "cart_a", to: "a@test.com", template: "cart-abandoned", data: {} },
  { cart_id: "cart_b", to: "b@test.com", template: "cart-abandoned", data: {} },
]

describe("bulk_trigger_workflow — idempotency_key_template (#1334)", () => {
  it("triggers the workflow for every item when no idempotency key is set", async () => {
    const { engine } = makeWorkflowEngine()
    const ctx = makeContext(
      { classify: { send_items: SEND_ITEMS } },
      makeContainer(engine, null)
    )

    const result = await bulkTriggerWorkflowOperation.execute(
      {
        workflow_name: "send-notification-email",
        items: "{{ classify.send_items }}",
        input_template: {
          to: "{{ item.to }}",
          template: "{{ item.template }}",
          data: "{{ item.data }}",
        },
        continue_on_error: true,
        max_items: 100,
      },
      ctx
    )

    expect(result.success).toBe(true)
    expect(result.data.triggered).toBe(2)
    expect(result.data.skipped).toBe(0)
    expect(result.data.failed).toBe(0)
    expect(engine.run).toHaveBeenCalledTimes(2)
  })

  it("skips items whose idempotency lock is already held", async () => {
    const { engine } = makeWorkflowEngine()
    const { locking, acquired } = makeLocking(new Set(["cart-abandoned:cart_a"]))
    const ctx = makeContext(
      { classify: { send_items: SEND_ITEMS } },
      makeContainer(engine, locking)
    )

    const result = await bulkTriggerWorkflowOperation.execute(
      {
        workflow_name: "send-notification-email",
        items: "{{ classify.send_items }}",
        input_template: {
          to: "{{ item.to }}",
          template: "{{ item.template }}",
          data: "{{ item.data }}",
        },
        idempotency_key_template: "cart-abandoned:{{ item.cart_id }}",
        continue_on_error: true,
        max_items: 100,
      },
      ctx
    )

    expect(result.success).toBe(true)
    expect(result.data.triggered).toBe(1)  // only cart_b
    expect(result.data.skipped).toBe(1)   // cart_a skipped
    expect(result.data.failed).toBe(0)
    expect(engine.run).toHaveBeenCalledTimes(1)
    // The skip is visible in the per-item results
    expect(result.data.results[0].skipped).toBe(true)
    expect(result.data.results[0].error).toBe("idempotency-skip")
  })

  it("acquires and releases the lock for each non-skipped item", async () => {
    const { engine } = makeWorkflowEngine()
    const { locking, acquired, released } = makeLocking()
    const ctx = makeContext(
      { classify: { send_items: SEND_ITEMS } },
      makeContainer(engine, locking)
    )

    await bulkTriggerWorkflowOperation.execute(
      {
        workflow_name: "send-notification-email",
        items: "{{ classify.send_items }}",
        input_template: {
          to: "{{ item.to }}",
          template: "{{ item.template }}",
          data: "{{ item.data }}",
        },
        idempotency_key_template: "cart-abandoned:{{ item.cart_id }}",
        continue_on_error: true,
        max_items: 100,
      },
      ctx
    )

    expect(acquired.has("cart-abandoned:cart_a")).toBe(true)
    expect(acquired.has("cart-abandoned:cart_b")).toBe(true)
    expect(released.has("cart-abandoned:cart_a")).toBe(true)
    expect(released.has("cart-abandoned:cart_b")).toBe(true)
    expect(locking.acquire).toHaveBeenCalledTimes(2)
    expect(locking.release).toHaveBeenCalledTimes(2)
  })

  it("releases the lock even when the workflow trigger throws", async () => {
    const failingEngine = {
      run: jest.fn().mockRejectedValue(new Error("SMTP down")),
    }
    const { locking, released } = makeLocking()
    const ctx = makeContext(
      { classify: { send_items: [SEND_ITEMS[0]] } },
      makeContainer(failingEngine, locking)
    )

    const result = await bulkTriggerWorkflowOperation.execute(
      {
        workflow_name: "send-notification-email",
        items: "{{ classify.send_items }}",
        input_template: { to: "{{ item.to }}" },
        idempotency_key_template: "cart-abandoned:{{ item.cart_id }}",
        continue_on_error: true,
        max_items: 100,
      },
      ctx
    )

    expect(result.data.failed).toBe(1)
    expect(released.has("cart-abandoned:cart_a")).toBe(true)
  })

  it("returns skipped=0 when idempotency_key_template is omitted", async () => {
    const { engine } = makeWorkflowEngine()
    const ctx = makeContext(
      { classify: { send_items: SEND_ITEMS } },
      makeContainer(engine, null)
    )

    const result = await bulkTriggerWorkflowOperation.execute(
      {
        workflow_name: "send-notification-email",
        items: "{{ classify.send_items }}",
        input_template: { to: "{{ item.to }}" },
        continue_on_error: true,
        max_items: 100,
      },
      ctx
    )

    expect(result.data.skipped).toBe(0)
  })
})
