/**
 * Unit tests for the `execute_code` operation's isolated-vm execution backend
 * (#459 — the code-injection half of the #1 prod RCE risk).
 *
 * These force `VFLOW_USE_ISOLATED_VM=true` so user code runs inside a real V8
 * isolate (no host realm, no `process`/`require`, hard timeout) and assert:
 *   - the data contract still works ($last/$input/$trigger, $-aliases, {{ }})
 *   - bridged capabilities work (console, crypto, sleep) and bundled libs
 *     (lodash/dayjs/validator) are available
 *   - host-realm escapes are blocked
 *   - runaway code is killed by the timeout
 *   - external npm packages are rejected with a clear error in isolated mode
 *
 * The operation only reads `context.dataChain`, so we invoke it directly.
 */

import { isIsolatedVmEnabled } from "../isolated-runner"

const READ_KEY = "read_data_1765961329832"

function makeContext(dataChain: Record<string, any>): any {
  return {
    container: {} as any,
    dataChain: {
      $trigger: { payload: {}, timestamp: "2026-06-16T00:00:00.000Z" },
      $last: null,
      ...dataChain,
    },
    flowId: "flow_test",
    executionId: "exec_test",
    operationId: "op_test",
    operationKey: "code_test",
  }
}

describe("isIsolatedVmEnabled — flag parsing", () => {
  const prev = process.env.VFLOW_USE_ISOLATED_VM
  afterEach(() => {
    if (prev === undefined) delete process.env.VFLOW_USE_ISOLATED_VM
    else process.env.VFLOW_USE_ISOLATED_VM = prev
  })

  it.each(["true", "1", "yes", "on", "TRUE", "  On  "])("treats %p as enabled", (v) => {
    process.env.VFLOW_USE_ISOLATED_VM = v
    expect(isIsolatedVmEnabled()).toBe(true)
  })

  it.each(["false", "0", "no", "off", "", undefined as any])("treats %p as disabled", (v) => {
    if (v === undefined) delete process.env.VFLOW_USE_ISOLATED_VM
    else process.env.VFLOW_USE_ISOLATED_VM = v
    expect(isIsolatedVmEnabled()).toBe(false)
  })
})

describe("execute_code — isolated-vm backend", () => {
  const prev = process.env.VFLOW_USE_ISOLATED_VM
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let executeCodeOperation: any

  beforeAll(() => {
    process.env.VFLOW_USE_ISOLATED_VM = "true"
    // Import after the flag is set (operation reads it at execute time, but be safe).
    executeCodeOperation = require("../execute-code").executeCodeOperation
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.VFLOW_USE_ISOLATED_VM
    else process.env.VFLOW_USE_ISOLATED_VM = prev
  })

  const run = (code: string, dataChain: Record<string, any> = {}, options: any = {}) =>
    executeCodeOperation.execute({ code, ...options }, makeContext(dataChain))

  it("runs a basic transform reading $last", async () => {
    const res = await run(
      `const recs = $last.records || []; return { n: recs.length, ids: recs.map(r => r.id) }`,
      { $last: { records: [{ id: "a" }, { id: "b" }] } }
    )
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ n: 2, ids: ["a", "b"] })
  })

  it("exposes $-aliases and {{ }} tokens for named outputs", async () => {
    const aliasRes = await run(`return $${READ_KEY}.records.length`, {
      [READ_KEY]: { records: [1, 2, 3] },
    })
    expect(aliasRes.success).toBe(true)
    expect(aliasRes.data).toBe(3)

    const tokenRes = await run(`return JSON.parse({{ $${READ_KEY}.records }})`, {
      [READ_KEY]: { records: '[{"sku":"A1"},{"sku":"B2"}]' },
    })
    expect(tokenRes.success).toBe(true)
    expect(tokenRes.data).toEqual([{ sku: "A1" }, { sku: "B2" }])
  })

  it("provides bundled lodash, dayjs and validator inside the isolate", async () => {
    const res = await run(`return {
      grouped: _.groupBy([{t:'x'},{t:'y'},{t:'x'}], 't'),
      year: dayjs('2021-05-05').year(),
      email: validator.isEmail('a@b.com'),
    }`)
    expect(res.success).toBe(true)
    expect(res.data.year).toBe(2021)
    expect(res.data.email).toBe(true)
    expect(Object.keys(res.data.grouped)).toEqual(["x", "y"])
  })

  it("provides bridged crypto helpers", async () => {
    const res = await run(`return {
      sha: crypto.sha256('hello'),
      isUuid: uuid.validate(crypto.randomUUID()),
    }`)
    expect(res.success).toBe(true)
    // sha256("hello") is a stable, well-known digest
    expect(res.data.sha).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
    expect(res.data.isUuid).toBe(true)
  })

  it("supports the bridged async sleep helper", async () => {
    const res = await run(`await sleep(5); return { done: true }`)
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ done: true })
  })

  it("blocks host-realm escape via constructor chain", async () => {
    const res = await run(`return this.constructor.constructor('return process')().pid`)
    expect(res.success).toBe(false)
    // process must NOT be reachable — either a ReferenceError or undefined access
    expect(JSON.stringify(res)).not.toContain('"pid"')
  })

  it("has no process/require in scope", async () => {
    const res = await run(
      `return { hasProcess: typeof process, hasRequire: typeof require }`
    )
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ hasProcess: "undefined", hasRequire: "undefined" })
  })

  it("kills runaway code via the timeout", async () => {
    const res = await run(`while (true) {}`, {}, { timeout: 300 })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/timed out|time/i)
  })

  it("rejects external npm packages in isolated mode with a clear error", async () => {
    const res = await run(`return 1`, {}, { packages: ["axios"] })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not supported while VFLOW_USE_ISOLATED_VM/i)
    expect(res.error).toMatch(/axios/)
  })

  it("still blocks dangerous packages in isolated mode", async () => {
    const res = await run(`return 1`, {}, { packages: ["child_process"] })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/blocked for security/i)
  })
})
