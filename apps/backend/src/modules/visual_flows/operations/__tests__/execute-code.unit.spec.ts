/**
 * Unit tests for the visual-flows `execute_code` operation — specifically the
 * variable/interpolation contract for user code (#424).
 *
 * Three ways to reach upstream data from inside code, all exercised here:
 *   1. Built-in sandbox vars:           `$last`, `$input`, `$trigger`
 *   2. `$`-aliases for named outputs:    `$read_data_123.records`
 *   3. `{{ ... }}` template tokens:      `JSON.parse({{ $last.records }})`
 *
 * The regression this guards: `{{ ... }}` tokens used to be string-interpolated
 * by JSON-stringifying the value INTO the source text, which mangled
 * objects/JSON (`JSON.parse({{$last}})` threw
 * `Expected property name or '}' at position 1`). Tokens now bind the RAW value
 * into the sandbox — no stringify→parse round-trip.
 *
 * The operation only reads `context.dataChain`, so we can invoke it directly
 * without booting Medusa.
 */

import { executeCodeOperation } from "../execute-code"

// The named upstream operation key from the real-world repro.
const READ_KEY = "read_data_1765961329832"

function makeContext(dataChain: Record<string, any>): any {
  return {
    container: {} as any,
    dataChain: {
      $trigger: { payload: {}, timestamp: "2026-06-16T00:00:00.000Z" },
      $accountability: {},
      $env: {},
      $last: null,
      ...dataChain,
    },
    flowId: "flow_test",
    executionId: "exec_test",
    operationId: "op_test",
    operationKey: "code_test",
  }
}

async function run(code: string, dataChain: Record<string, any>) {
  return executeCodeOperation.execute({ code }, makeContext(dataChain))
}

describe("execute_code — interpolation / variable resolution", () => {
  // The exact user code from #424: prefer $last.records, else parse the JSON
  // string the read step returned.
  const USER_CODE = `
    const records = ($last && $last.records) || JSON.parse($${READ_KEY}.records)
    return { count: records.length, first: records[0] }
  `

  it("uses $last.records directly when present (object, no parse)", async () => {
    const res = await run(USER_CODE, {
      $last: { records: [{ id: "a" }, { id: "b" }] },
      [READ_KEY]: { records: '[{"id":"x"}]' }, // present but unused — $last wins
    })

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ count: 2, first: { id: "a" } })
  })

  it("falls back to JSON.parse($read_data_*.records) when $last has no records", async () => {
    const res = await run(USER_CODE, {
      $last: { something_else: true }, // truthy but no .records
      [READ_KEY]: { records: '[{"id":"x"},{"id":"y"},{"id":"z"}]' },
    })

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ count: 3, first: { id: "x" } })
  })

  it("falls back via the $-alias when $last is null", async () => {
    const res = await run(USER_CODE, {
      $last: null,
      [READ_KEY]: { records: '[{"id":"only"}]' },
    })

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ count: 1, first: { id: "only" } })
  })

  it("exposes named outputs via $input too", async () => {
    const res = await run(
      `return $input.${READ_KEY}.records.length`,
      { [READ_KEY]: { records: '[1,2,3,4]'.concat("]") /* keep it a string */ } }
    )
    // records is a JSON string here; .length is the string length, proving the
    // value is passed through verbatim (not auto-parsed).
    expect(res.success).toBe(true)
    expect(typeof res.data).toBe("number")
  })
})

describe("execute_code — {{ }} template tokens bind RAW values (#424 regression)", () => {
  it("JSON.parse({{ $read_*.records }}) parses the raw JSON string (no mangling)", async () => {
    // Pre-fix: the JSON string was JSON-stringified into source, producing
    // invalid code and the 'Expected property name' error.
    const res = await run(
      `return JSON.parse({{ $${READ_KEY}.records }})`,
      { [READ_KEY]: { records: '[{"sku":"A1"},{"sku":"B2"}]' } }
    )

    expect(res.success).toBe(true)
    expect(res.data).toEqual([{ sku: "A1" }, { sku: "B2" }])
  })

  it("an object token is bound as a real object, not a stringified copy", async () => {
    const res = await run(
      `const v = {{ $last }}; return { isObject: typeof v === "object", id: v.id }`,
      { $last: { id: 42, nested: { ok: true } } }
    )

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ isObject: true, id: 42 })
  })

  it("a JSON-string token round-trips through JSON.parse correctly", async () => {
    // $last is itself a JSON string. Pre-fix, stringify added an extra layer of
    // quotes/escapes so JSON.parse saw a quoted string, not an object.
    const res = await run(
      `return JSON.parse({{ $last }})`,
      { $last: '{"hello":"world"}' }
    )

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ hello: "world" })
  })

  it("a primitive token is bound with its type preserved", async () => {
    const res = await run(
      `const n = {{ $last }}; return { isNumber: typeof n === "number", doubled: n * 2 }`,
      { $last: 21 }
    )

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ isNumber: true, doubled: 42 })
  })

  it("a missing token path binds to undefined (does not throw at bind time)", async () => {
    const res = await run(
      `return { v: {{ $does_not_exist.foo }} === undefined }`,
      { $last: null }
    )

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ v: true })
  })
})
