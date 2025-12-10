import { execSync } from "child_process"
import * as path from "path"
import * as fs from "fs"

/**
 * Cache for loaded packages
 */
const packageCache: Map<string, any> = new Map()

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
