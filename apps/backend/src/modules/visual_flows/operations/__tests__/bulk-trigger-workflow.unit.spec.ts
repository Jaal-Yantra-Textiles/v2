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

  it("claims a key per item and HOLDS it after a successful trigger", async () => {
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
    expect(locking.acquire).toHaveBeenCalledTimes(2)

    // The key is the dedup WINDOW, not a mutex hold. This assertion used to
    // read `release` twice — which is what let a later execution re-send a cart
    // the moment the first one had finished with it. Releasing on success is
    // the defect, not the contract.
    expect(released.has("cart-abandoned:cart_a")).toBe(false)
    expect(released.has("cart-abandoned:cart_b")).toBe(false)
    expect(locking.release).not.toHaveBeenCalled()
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

/**
 * The failure mode the option exists to prevent, as it actually occurs (#1334).
 *
 * The tests above hand each execution a FRESH locking fake, which models two
 * scanners that overlap on the same instant. Production is not like that: the
 * two executions share one Redis, and they walk the same `send_items` list
 * SERIALLY. Whether the key still exists when the second execution reaches an
 * item is the whole question — so these tests share one locking service across
 * two sequential runs, which is the only arrangement that can answer it.
 */
describe("bulk_trigger_workflow — idempotency across sequential executions (#1334)", () => {
  const OPTIONS = {
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
  }

  it("does not re-send a cart a previous execution already sent", async () => {
    // One Redis, two executions — exactly the rolling-deploy scenario. The
    // second scanner reads the same carts (its `classify` ran before the
    // first's `mark_sent` landed) and must send nothing.
    const { engine } = makeWorkflowEngine()
    const { locking } = makeLocking()
    const container = makeContainer(engine, locking)

    const first = await bulkTriggerWorkflowOperation.execute(
      OPTIONS,
      makeContext({ classify: { send_items: SEND_ITEMS } }, container)
    )
    const second = await bulkTriggerWorkflowOperation.execute(
      OPTIONS,
      makeContext({ classify: { send_items: SEND_ITEMS } }, container)
    )

    expect(first.data.triggered).toBe(2)
    expect(second.data.triggered).toBe(0)
    expect(second.data.skipped).toBe(2)
    // Two carts, two emails. Anything more is the duplicate this option exists
    // to stop.
    expect(engine.run).toHaveBeenCalledTimes(2)
  })

  it("lets a cart whose send FAILED be retried by the next execution", async () => {
    // The mirror image: an idempotency key must not permanently blacklist a
    // cart whose mail never went out. Release on failure, hold on success.
    const runs: any[] = []
    const flakyEngine = {
      run: jest.fn(async (_name: string, opts: any) => {
        runs.push(opts)
        if (runs.length === 1) throw new Error("SMTP down")
        return { result: { id: "wf-ok" }, errors: null }
      }),
    }
    const { locking } = makeLocking()
    const container = makeContainer(flakyEngine, locking)
    const items = { classify: { send_items: [SEND_ITEMS[0]] } }

    const first = await bulkTriggerWorkflowOperation.execute(
      OPTIONS,
      makeContext(items, container)
    )
    const second = await bulkTriggerWorkflowOperation.execute(
      OPTIONS,
      makeContext(items, container)
    )

    expect(first.data.failed).toBe(1)
    expect(second.data.triggered).toBe(1)
    expect(second.data.skipped).toBe(0)
  })

  it("fails an item loudly when the locking backend is unreachable", async () => {
    // A Redis outage throws from `acquire` just like contention does. Reading
    // one as the other turns a total send outage into `success: true` with
    // every cart reported as an idempotency skip — and, because `mark_sent`
    // marks on classification, those carts are recorded as reminded anyway.
    const { engine } = makeWorkflowEngine()
    const brokenLocking = {
      acquire: jest.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.4:6379")
      }),
      release: jest.fn(async () => {}),
    }
    const ctx = makeContext(
      { classify: { send_items: SEND_ITEMS } },
      makeContainer(engine, brokenLocking)
    )

    const result = await bulkTriggerWorkflowOperation.execute(OPTIONS, ctx)

    // Reported as failures, NOT as tidy idempotency skips. (`success` still
    // follows `continue_on_error`, which is the operation-wide contract and not
    // this option's to redefine — but `failed: 2` with an explicit message is
    // now visible in the execution log, where `skipped: 2` looked like healthy
    // dedup.)
    expect(result.data.skipped).toBe(0)
    expect(result.data.failed).toBe(2)
    expect(result.data.results[0].error).toMatch(/Locking backend unavailable/)
    expect(engine.run).not.toHaveBeenCalled()
  })

  it("does not count skipped items as failures when continue_on_error is false", async () => {
    // The two return paths compute `failed` differently: the early return
    // counts every not-ok result, which includes skips.
    const failOnSecond = {
      run: jest.fn(async (_name: string, opts: any) => {
        if (opts.input.to === "b@test.com") throw new Error("SMTP down")
        return { result: { id: "wf-1" }, errors: null }
      }),
    }
    const { locking } = makeLocking(new Set(["cart-abandoned:cart_a"]))
    const ctx = makeContext(
      { classify: { send_items: SEND_ITEMS } },
      makeContainer(failOnSecond, locking)
    )

    const result = await bulkTriggerWorkflowOperation.execute(
      { ...OPTIONS, continue_on_error: false },
      ctx
    )

    expect(result.success).toBe(false)
    expect(result.data.skipped).toBe(1) // cart_a — lock held elsewhere
    expect(result.data.failed).toBe(1)  // cart_b — the actual failure
  })
})
