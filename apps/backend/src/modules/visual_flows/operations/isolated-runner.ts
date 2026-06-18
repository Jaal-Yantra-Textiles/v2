/**
 * True-sandbox runner for the visual-flows `execute_code` operation, backed by
 * `isolated-vm`.
 *
 * The default `execute_code` runner uses a `new Function(...)` body, which runs
 * user code in the host realm — it is explicitly NOT a real sandbox. User code
 * can escape via prototype tricks (e.g. `this.constructor.constructor("return
 * process")()`) and reach `process`, `require`, the filesystem, etc. That, plus
 * runtime npm-install (gated separately in {@link ./package-loader}), is the #1
 * remote-code-execution risk flagged in the visual-flows engine analysis.
 *
 * This module runs the same user code inside a fresh V8 isolate with no host
 * objects in scope: no `process`, no `require`, no `Function`-realm escape, a
 * hard memory limit, and a CPU/wall-clock timeout. Capabilities the existing
 * sandbox exposes are bridged explicitly across the isolate boundary:
 *
 *   - data chain (`$input`/`$last`/`$trigger`/`$context`) + `{{ }}` token
 *     bindings + `$`-aliases — copied in via `ExternalCopy` (structured clone)
 *   - `console.log/error/warn` — captured to the host `logs` array
 *   - `crypto` helpers + `uuid` + `btoa`/`atob` — bridged to host functions
 *   - `sleep(ms)` — bridged to a host timer (capped at 5s)
 *   - `lodash` (`_`), `dayjs`, `validator` — their UMD bundles are evaluated
 *     INSIDE the isolate (pure JS, no boundary objects needed)
 *
 * NOT supported in isolated mode (yet): `fetch` and on-demand external npm
 * packages — those require live host objects across the boundary and are left
 * for a follow-up. The caller surfaces a clear error if a flow requests them.
 *
 * Gated behind {@link isIsolatedVmEnabled} (env `VFLOW_USE_ISOLATED_VM`),
 * DISABLED by default so production behaviour is unchanged until explicitly
 * opted in. `isolated-vm` is an `optionalDependency` and is imported lazily, so
 * a host where the native addon is absent or failed to build is unaffected
 * while the flag is off.
 */

import * as crypto from "crypto"
import { createRequire } from "module"

/**
 * Whether to run `execute_code` inside an `isolated-vm` sandbox instead of the
 * in-process `new Function(...)` runner.
 *
 * DISABLED by default. Set `VFLOW_USE_ISOLATED_VM=true` (or `1`/`yes`/`on`) to
 * opt in. Unlike the npm-install gate this is a hardening switch, so it is NOT
 * force-disabled in production — an operator may enable it anywhere.
 */
export function isIsolatedVmEnabled(): boolean {
  const raw = (process.env.VFLOW_USE_ISOLATED_VM || "").trim().toLowerCase()
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on"
}

/**
 * Bootstrap evaluated inside the isolate before user code. Wires `console`,
 * `crypto`, `uuid`, `btoa`/`atob` and `sleep` onto the isolate global using the
 * host references injected as `__hostLog` / `__hostCall` / `__hostSleep`.
 */
const SANDBOX_BOOTSTRAP = `
;(function () {
  function stringify(a) {
    try { return typeof a === "string" ? a : JSON.stringify(a) }
    catch (e) { return String(a) }
  }
  function joinArgs(args) {
    return Array.prototype.map.call(args, stringify).join(" ")
  }
  global.console = {
    log: function () { __hostLog.applySync(undefined, ["log", joinArgs(arguments)]) },
    error: function () { __hostLog.applySync(undefined, ["error", joinArgs(arguments)]) },
    warn: function () { __hostLog.applySync(undefined, ["warn", joinArgs(arguments)]) },
    info: function () { __hostLog.applySync(undefined, ["log", joinArgs(arguments)]) },
    debug: function () { __hostLog.applySync(undefined, ["log", joinArgs(arguments)]) },
  }
  function call(kind, args) {
    return JSON.parse(__hostCall.applySync(undefined, [kind, JSON.stringify(args)]) || "null")
  }
  global.crypto = {
    randomUUID: function () { return call("crypto.randomUUID", []) },
    hash: function (algorithm, data) { return call("crypto.hash", [algorithm, data]) },
    md5: function (data) { return call("crypto.md5", [data]) },
    sha256: function (data) { return call("crypto.sha256", [data]) },
    hmac: function (algorithm, key, data) { return call("crypto.hmac", [algorithm, key, data]) },
  }
  global.uuid = {
    v4: function () { return call("crypto.randomUUID", []) },
    validate: function (str) {
      var re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      return re.test(str)
    },
  }
  global.btoa = function (str) { return call("util.btoa", [str]) }
  global.atob = function (str) { return call("util.atob", [str]) }
  global.sleep = function (ms) {
    return __hostSleep.apply(undefined, [Math.min(Number(ms) || 0, 5000)], { result: { promise: true } })
  }
})();
`

let cachedLibSources: { lodash: string; dayjs: string; validator: string } | null = null

/**
 * Read the UMD bundles for the convenience libraries once. They are evaluated
 * inside the isolate (no host objects cross the boundary). Missing files are
 * tolerated — the corresponding global just won't be defined.
 */
function loadLibSources(): { lodash: string; dayjs: string; validator: string } {
  if (cachedLibSources) {
    return cachedLibSources
  }
  // Resolve relative to this module so we read the same versions the backend
  // depends on, regardless of cwd.
  const req = createRequire(__filename)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs") as typeof import("fs")
  const read = (spec: string): string => {
    try {
      return fs.readFileSync(req.resolve(spec), "utf8")
    } catch {
      return ""
    }
  }
  cachedLibSources = {
    lodash: read("lodash/lodash.js"),
    dayjs: read("dayjs/dayjs.min.js"),
    validator: read("validator/validator.min.js"),
  }
  return cachedLibSources
}

/**
 * Host-side dispatcher for the small set of native capabilities exposed to the
 * sandbox. Receives a JSON payload, returns a JSON string.
 */
function hostCall(kind: string, payload: string): string {
  const args: any[] = JSON.parse(payload || "[]")
  let result: any = null
  switch (kind) {
    case "crypto.randomUUID":
      result = crypto.randomUUID()
      break
    case "crypto.hash":
      result = crypto.createHash(String(args[0])).update(String(args[1])).digest("hex")
      break
    case "crypto.md5":
      result = crypto.createHash("md5").update(String(args[0])).digest("hex")
      break
    case "crypto.sha256":
      result = crypto.createHash("sha256").update(String(args[0])).digest("hex")
      break
    case "crypto.hmac":
      result = crypto.createHmac(String(args[0]), String(args[1])).update(String(args[2])).digest("hex")
      break
    case "util.btoa":
      result = Buffer.from(String(args[0])).toString("base64")
      break
    case "util.atob":
      result = Buffer.from(String(args[0]), "base64").toString("utf-8")
      break
    default:
      result = null
  }
  return JSON.stringify(result === undefined ? null : result)
}

/**
 * Lazily import `isolated-vm`. Throws an operator-facing error if the optional
 * native addon is not installed/built on this host.
 */
async function loadIsolatedVm(): Promise<any> {
  try {
    const mod: any = await import("isolated-vm")
    return mod.default || mod
  } catch (err: any) {
    throw new Error(
      `isolated-vm is not available (VFLOW_USE_ISOLATED_VM is enabled but the native module failed to load): ${err?.message || err}`
    )
  }
}

export type IsolatedRunOptions = {
  /** Full data chain (already containing $last/$trigger/etc.). */
  dataChain: Record<string, any>
  /** $-aliases for named outputs + resolved {{ }} token bindings. */
  extraBindings?: Record<string, any>
  /** Host log sink — console.* output is appended here. */
  logs: string[]
  /** Total wall-clock budget in ms. */
  timeout: number
  /** Isolate memory limit in MB. */
  memoryLimitMb?: number
}

/**
 * Best-effort copy of a value across the isolate boundary. Falls back to a JSON
 * round-trip (which drops functions/undefined) and finally to `undefined` so a
 * single non-cloneable binding never aborts the whole run.
 */
function setBinding(jail: any, ivm: any, name: string, value: any): void {
  try {
    jail.setSync(name, new ivm.ExternalCopy(value).copyInto())
    return
  } catch {
    // structured clone failed (e.g. a function) — try a JSON round-trip
  }
  try {
    const safe = value === undefined ? null : JSON.parse(JSON.stringify(value))
    jail.setSync(name, new ivm.ExternalCopy(safe).copyInto())
  } catch {
    jail.setSync(name, new ivm.ExternalCopy(null).copyInto())
  }
}

/**
 * Run `code` inside a fresh isolate and return its value.
 *
 * The code is wrapped in an async IIFE so `return` and top-level `await` both
 * work, mirroring the in-process runner.
 */
export async function runInIsolate(code: string, opts: IsolatedRunOptions): Promise<any> {
  const ivm = await loadIsolatedVm()
  const { dataChain, extraBindings = {}, logs, timeout } = opts
  const memoryLimit = opts.memoryLimitMb ?? 128

  const isolate = new ivm.Isolate({ memoryLimit })
  let disposed = false
  const dispose = () => {
    if (!disposed) {
      disposed = true
      try {
        isolate.dispose()
      } catch {
        // already disposed / mid-execution termination
      }
    }
  }

  let timer: NodeJS.Timeout | undefined
  try {
    const context = await isolate.createContext()
    const jail = context.global
    await jail.set("global", jail.derefInto())
    await jail.set("globalThis", jail.derefInto())

    // ---- host capability references -------------------------------------
    await jail.set(
      "__hostLog",
      new ivm.Reference((level: string, msg: string) => {
        if (level === "error") logs.push(`[ERROR] ${msg}`)
        else if (level === "warn") logs.push(`[WARN] ${msg}`)
        else logs.push(msg)
      })
    )
    await jail.set("__hostCall", new ivm.Reference(hostCall))
    await jail.set(
      "__hostSleep",
      new ivm.Reference((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    )

    // ---- bootstrap + convenience libraries ------------------------------
    await context.eval(SANDBOX_BOOTSTRAP)
    const libs = loadLibSources()
    if (libs.lodash) {
      await context.eval(libs.lodash)
      await context.eval("try { global.lodash = _ } catch (e) {}")
    }
    if (libs.dayjs) {
      await context.eval(libs.dayjs)
    }
    if (libs.validator) {
      await context.eval(libs.validator)
    }

    // ---- data bindings ---------------------------------------------------
    setBinding(jail, ivm, "$input", { ...dataChain })
    setBinding(jail, ivm, "$last", dataChain.$last)
    setBinding(jail, ivm, "$trigger", dataChain.$trigger)
    setBinding(jail, ivm, "$context", { timestamp: new Date().toISOString() })
    for (const [name, value] of Object.entries(extraBindings)) {
      setBinding(jail, ivm, name, value)
    }

    // ---- execute ---------------------------------------------------------
    const wrapped = `(async function () {\n"use strict";\n${code}\n})()`

    const evalPromise = context.eval(wrapped, {
      timeout,
      promise: true,
      copy: true,
    })

    const result = await Promise.race([
      evalPromise,
      new Promise((_resolve, reject) => {
        // Host-side wall-clock guard: the isolate `timeout` only bounds
        // synchronous CPU; a pending async chain (e.g. await that never
        // resolves) needs the isolate forcibly disposed.
        timer = setTimeout(() => {
          dispose()
          reject(new Error(`Execution timed out after ${timeout}ms`))
        }, timeout + 500)
      }),
    ])

    return result
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    dispose()
  }
}
