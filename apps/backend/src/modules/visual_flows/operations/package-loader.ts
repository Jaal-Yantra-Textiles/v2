import { execSync } from "child_process"
import * as path from "path"
import * as fs from "fs"

/**
 * Cache for loaded packages
 */
const packageCache: Map<string, any> = new Map()

/**
 * Env flag gating runtime `npm install` of arbitrary packages.
 *
 * Shell-installing an attacker-supplied package name at flow-execution time is
 * a remote-code-execution vector (the #1 prod risk flagged in the visual-flows
 * engine analysis). It is therefore DISABLED by default and force-disabled in
 * production regardless of the flag. Set
 * `VFLOW_ALLOW_RUNTIME_NPM_INSTALL=true` only in a trusted, non-production
 * environment to opt back in.
 *
 * When disabled, {@link loadPackage} still loads packages already present in
 * `node_modules` (or a previously-populated temp dir) — only the on-demand
 * shell install is blocked.
 */
export function isRuntimeNpmInstallEnabled(): boolean {
  const raw = (process.env.VFLOW_ALLOW_RUNTIME_NPM_INSTALL || "").trim().toLowerCase()
  const enabled = raw === "true" || raw === "1" || raw === "yes" || raw === "on"

  if (enabled && process.env.NODE_ENV === "production") {
    console.warn(
      "[package-loader] VFLOW_ALLOW_RUNTIME_NPM_INSTALL is set but runtime npm install is force-disabled in production for security."
    )
    return false
  }

  return enabled
}

/**
 * Track packages that are being installed to prevent duplicate installs
 */
const installingPackages: Set<string> = new Set()

/**
 * Directory for temporary package installations
 */
const TEMP_PACKAGES_DIR = path.join(process.cwd(), ".cache", "visual-flow-packages")

/**
 * Ensure the temp packages directory exists
 */
function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_PACKAGES_DIR)) {
    fs.mkdirSync(TEMP_PACKAGES_DIR, { recursive: true })
    // Initialize package.json
    fs.writeFileSync(
      path.join(TEMP_PACKAGES_DIR, "package.json"),
      JSON.stringify({ name: "visual-flow-packages", version: "1.0.0", dependencies: {} }, null, 2)
    )
  }
}

/**
 * Check if a package is installed in the temp directory
 */
function isPackageInstalled(packageName: string): boolean {
  const packagePath = path.join(TEMP_PACKAGES_DIR, "node_modules", packageName)
  return fs.existsSync(packagePath)
}

/**
 * Install a package to the temp directory
 */
async function installPackage(packageName: string): Promise<void> {
  // Prevent duplicate concurrent installs
  if (installingPackages.has(packageName)) {
    // Wait for existing install to complete
    while (installingPackages.has(packageName)) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return
  }
  
  installingPackages.add(packageName)
  
  try {
    ensureTempDir()
    
    console.log(`[package-loader] Installing package: ${packageName}`)
    
    // Use npm to install the package
    execSync(`npm install ${packageName} --save --legacy-peer-deps`, {
      cwd: TEMP_PACKAGES_DIR,
      stdio: "pipe",
      timeout: 60000, // 60 second timeout
    })
    
    console.log(`[package-loader] Successfully installed: ${packageName}`)
  } finally {
    installingPackages.delete(packageName)
  }
}

/**
 * Load a package using dynamic require (works with CommonJS packages)
 */
function requirePackage(packagePath: string): any {
  // Use eval to bypass TypeScript's static analysis of require
  // This is necessary because we need to require from a dynamic path
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dynamicRequire = eval('require')
  return dynamicRequire(packagePath)
}

/**
 * Load a package, installing it if necessary
 */
export async function loadPackage(packageName: string): Promise<any> {
  // Check memory cache first
  if (packageCache.has(packageName)) {
    console.log(`[package-loader] Using cached: ${packageName}`)
    return packageCache.get(packageName)
  }
  
  // Try to load from main node_modules first using require
  try {
    const pkg = requirePackage(packageName)
    const result = pkg.default || pkg
    packageCache.set(packageName, result)
    console.log(`[package-loader] Loaded from node_modules: ${packageName}`)
    return result
  } catch {
    // Not in main node_modules
  }
  
  // Check if installed in temp directory
  if (!isPackageInstalled(packageName)) {
    // Not present anywhere. Only shell-install when explicitly allowed —
    // installing an arbitrary package name at execution time is an RCE vector.
    if (!isRuntimeNpmInstallEnabled()) {
      throw new Error(
        `Package '${packageName}' is not available and runtime package installation is disabled. ` +
          `Pre-bundled packages (lodash, dayjs, validator, uuid, crypto, fetch) work out of the box. ` +
          `To install other packages on demand, set VFLOW_ALLOW_RUNTIME_NPM_INSTALL=true in a non-production environment.`
      )
    }
    // Install it
    await installPackage(packageName)
  }
  
  // Load from temp directory using require
  try {
    const packagePath = path.join(TEMP_PACKAGES_DIR, "node_modules", packageName)
    const pkg = requirePackage(packagePath)
    const result = pkg.default || pkg
    packageCache.set(packageName, result)
    console.log(`[package-loader] Loaded from temp packages: ${packageName}`)
    return result
  } catch (err: any) {
    console.error(`[package-loader] Failed to load ${packageName}:`, err.message)
    throw new Error(`Failed to load package '${packageName}': ${err.message}`)
  }
}

/**
 * Clear the package cache
 */
export function clearPackageCache(): void {
  packageCache.clear()
}

/**
 * Get list of installed temp packages
 */
export function getInstalledPackages(): string[] {
  ensureTempDir()
  const nodeModulesPath = path.join(TEMP_PACKAGES_DIR, "node_modules")
  if (!fs.existsSync(nodeModulesPath)) {
    return []
  }
  return fs.readdirSync(nodeModulesPath).filter(name => !name.startsWith("."))
}
