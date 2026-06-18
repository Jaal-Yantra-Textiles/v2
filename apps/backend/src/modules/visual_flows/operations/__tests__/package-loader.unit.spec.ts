/**
 * Unit tests for the visual-flows package-loader runtime-npm-install gate.
 *
 * Shell-installing an attacker-supplied package name at flow-execution time is
 * an RCE vector. The gate (env flag `VFLOW_ALLOW_RUNTIME_NPM_INSTALL`) must:
 *   - be DISABLED by default,
 *   - be force-disabled in production even when the flag is set,
 *   - still load packages that already exist in `node_modules`,
 *   - throw a clear error (and NOT shell out to `npm install`) for a missing
 *     package while disabled.
 *
 * `child_process` is mocked so we can assert no shell install ever happens.
 */

jest.mock("child_process", () => ({ execSync: jest.fn() }))

import { execSync } from "child_process"
import {
  loadPackage,
  isRuntimeNpmInstallEnabled,
  clearPackageCache,
} from "../package-loader"

const mockExecSync = execSync as unknown as jest.Mock

const FLAG = "VFLOW_ALLOW_RUNTIME_NPM_INSTALL"
const ORIG_FLAG = process.env[FLAG]
const ORIG_NODE_ENV = process.env.NODE_ENV

beforeEach(() => {
  clearPackageCache()
  mockExecSync.mockReset()
  delete process.env[FLAG]
  process.env.NODE_ENV = "test"
})

afterAll(() => {
  if (ORIG_FLAG === undefined) {
    delete process.env[FLAG]
  } else {
    process.env[FLAG] = ORIG_FLAG
  }
  process.env.NODE_ENV = ORIG_NODE_ENV
})

describe("isRuntimeNpmInstallEnabled", () => {
  it("is disabled by default", () => {
    expect(isRuntimeNpmInstallEnabled()).toBe(false)
  })

  it.each(["true", "1", "yes", "on", "TRUE", " On "])(
    "is enabled when flag is %p in a non-production env",
    (val) => {
      process.env[FLAG] = val
      expect(isRuntimeNpmInstallEnabled()).toBe(true)
    }
  )

  it("treats arbitrary/false-y values as disabled", () => {
    for (const val of ["", "false", "0", "no", "maybe"]) {
      process.env[FLAG] = val
      expect(isRuntimeNpmInstallEnabled()).toBe(false)
    }
  })

  it("is force-disabled in production even when the flag is set", () => {
    process.env[FLAG] = "true"
    process.env.NODE_ENV = "production"
    expect(isRuntimeNpmInstallEnabled()).toBe(false)
  })
})

describe("loadPackage gate", () => {
  it("loads a package already present in node_modules without shelling out", async () => {
    const lodash = await loadPackage("lodash")
    expect(typeof lodash.chunk).toBe("function")
    expect(mockExecSync).not.toHaveBeenCalled()
  })

  it("throws a clear error for a missing package while disabled (no npm install)", async () => {
    await expect(
      loadPackage("definitely-not-a-real-package-xyz-0000")
    ).rejects.toThrow(/runtime package installation is disabled/i)
    expect(mockExecSync).not.toHaveBeenCalled()
  })

  it("error message points operators at the opt-in flag", async () => {
    await expect(
      loadPackage("definitely-not-a-real-package-xyz-0001")
    ).rejects.toThrow(/VFLOW_ALLOW_RUNTIME_NPM_INSTALL/)
    expect(mockExecSync).not.toHaveBeenCalled()
  })
})
