/**
 * Code Index Service
 *
 * Provides code search and symbol lookup functionality for the codebase.
 * Uses file-based search with caching for performance.
 *
 * This is a simplified implementation that:
 * - Searches files by content using string matching
 * - Extracts basic symbol information (functions, classes, types)
 * - Caches results for repeated queries
 */

import * as fs from "fs"
import * as path from "path"

// Types
export interface CodeSearchResult {
  file: string
  line: number
  content: string
  score: number
}

export interface SymbolInfo {
  name: string
  type: "function" | "class" | "interface" | "type" | "variable" | "const" | "export"
  file: string
  line: number
  documentation?: string
  signature?: string
}

export interface Reference {
  file: string
  line: number
  context: string
}

// Configuration
const DEFAULT_ROOT = process.cwd()
const DEFAULT_INCLUDE = ["src/**/*.ts", "src/**/*.tsx"]
const DEFAULT_EXCLUDE = ["node_modules", "dist", ".medusa", "**/*.d.ts", "**/*.test.ts", "**/*.spec.ts"]

// Cache
const searchCache = new Map<string, CodeSearchResult[]>()
const symbolCache = new Map<string, SymbolInfo | null>()
const fileContentCache = new Map<string, { content: string; mtime: number }>()
const CACHE_TTL_MS = 60 * 1000 // 1 minute

let cacheTimestamp = 0

/**
 * Clear all caches
 */
export function clearCodeIndexCache(): void {
  searchCache.clear()
  symbolCache.clear()
  fileContentCache.clear()
  cacheTimestamp = 0
}

/**
 * Check if cache should be refreshed
 */
function shouldRefreshCache(): boolean {
  return Date.now() - cacheTimestamp > CACHE_TTL_MS
}

/**
 * Get all TypeScript files in the project
 */
function getProjectFiles(root: string = DEFAULT_ROOT): string[] {
  const files: string[] = []

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(root, fullPath)

        // Skip excluded directories
        if (DEFAULT_EXCLUDE.some((ex) => {
          if (ex.startsWith("**")) return false
          return relativePath.includes(ex) || entry.name === ex
        })) {
          continue
        }

        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.isFile()) {
          // Check if file matches include patterns and not excluded
          const isTs = entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
          const isExcludedFile = DEFAULT_EXCLUDE.some((ex) => {
            if (!ex.startsWith("**")) return false
            const pattern = ex.replace("**", "")
            return fullPath.includes(pattern) || entry.name.includes(pattern.replace("/", ""))
          })

          if (isTs && !isExcludedFile && relativePath.startsWith("src")) {
            files.push(fullPath)
          }
        }
      }
    } catch (error) {
      // Ignore permission errors
    }
  }

  walk(path.join(root, "src"))
  return files
}

/**
 * Read file content with caching
 */
function readFileContent(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath)
    const cached = fileContentCache.get(filePath)

    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.content
    }

    const content = fs.readFileSync(filePath, "utf-8")
    fileContentCache.set(filePath, { content, mtime: stat.mtimeMs })
    return content
  } catch {
    return null
  }
}

/**
 * Search code for a query string
 *
 * @param query - Search query (case-insensitive)
 * @param root - Project root directory
 * @returns Array of search results sorted by score (relevance)
 */
export async function searchCode(
  query: string,
  root: string = DEFAULT_ROOT
): Promise<CodeSearchResult[]> {
  if (!query || !query.trim()) {
    return []
  }

  const cacheKey = `search:${query.toLowerCase()}`
  if (!shouldRefreshCache() && searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey)!
  }

  const results: CodeSearchResult[] = []
  const queryLower = query.toLowerCase()
  const queryWords = queryLower.split(/\s+/).filter(Boolean)

  const files = getProjectFiles(root)

  for (const file of files) {
    const content = readFileContent(file)
    if (!content) continue

    const lines = content.split("\n")
    const relativePath = path.relative(root, file)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineLower = line.toLowerCase()

      // Calculate relevance score
      let score = 0

      // Exact match gets highest score
      if (lineLower.includes(queryLower)) {
        score = 100
      } else {
        // Partial word matches
        for (const word of queryWords) {
          if (lineLower.includes(word)) {
            score += 30
          }
        }
      }

      // Boost score for certain patterns
      if (line.includes("export ") || line.includes("function ") || line.includes("class ")) {
        score += 10
      }
      if (line.includes("const ") && line.includes(" = ")) {
        score += 5
      }

      if (score > 0) {
        results.push({
          file: relativePath,
          line: i + 1,
          content: line.trim().slice(0, 200),
          score,
        })
      }
    }
  }

  // Sort by score descending, limit to top 50
  results.sort((a, b) => b.score - a.score)
  const topResults = results.slice(0, 50)

  searchCache.set(cacheKey, topResults)
  cacheTimestamp = Date.now()

  return topResults
}

/**
 * Get information about a symbol (function, class, type, etc.)
 *
 * @param symbolName - Name of the symbol to find
 * @param root - Project root directory
 */
export async function getSymbolInfo(
  symbolName: string,
  root: string = DEFAULT_ROOT
): Promise<SymbolInfo | null> {
  if (!symbolName || !symbolName.trim()) {
    return null
  }

  const cacheKey = `symbol:${symbolName}`
  if (!shouldRefreshCache() && symbolCache.has(cacheKey)) {
    return symbolCache.get(cacheKey)!
  }

  const files = getProjectFiles(root)

  // Patterns to match different symbol types
  const patterns = [
    { regex: new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbolName}\\s*[(<]`, "m"), type: "function" as const },
    { regex: new RegExp(`export\\s+const\\s+${symbolName}\\s*[=:]`, "m"), type: "const" as const },
    { regex: new RegExp(`export\\s+class\\s+${symbolName}\\s*[{<]`, "m"), type: "class" as const },
    { regex: new RegExp(`export\\s+interface\\s+${symbolName}\\s*[{<]`, "m"), type: "interface" as const },
    { regex: new RegExp(`export\\s+type\\s+${symbolName}\\s*[=<]`, "m"), type: "type" as const },
    { regex: new RegExp(`(?:async\\s+)?function\\s+${symbolName}\\s*[(<]`, "m"), type: "function" as const },
    { regex: new RegExp(`const\\s+${symbolName}\\s*[=:]`, "m"), type: "const" as const },
    { regex: new RegExp(`class\\s+${symbolName}\\s*[{<]`, "m"), type: "class" as const },
    { regex: new RegExp(`interface\\s+${symbolName}\\s*[{<]`, "m"), type: "interface" as const },
    { regex: new RegExp(`type\\s+${symbolName}\\s*[=<]`, "m"), type: "type" as const },
  ]

  for (const file of files) {
    const content = readFileContent(file)
    if (!content) continue

    for (const { regex, type } of patterns) {
      const match = content.match(regex)
      if (match) {
        const lines = content.slice(0, match.index).split("\n")
        const lineNumber = lines.length
        const matchLine = content.split("\n")[lineNumber - 1] || ""

        // Try to extract JSDoc comment above the symbol
        let documentation: string | undefined
        if (lineNumber > 1) {
          const prevLines = content.split("\n").slice(Math.max(0, lineNumber - 10), lineNumber - 1)
          const commentLines: string[] = []
          for (let i = prevLines.length - 1; i >= 0; i--) {
            const line = prevLines[i].trim()
            if (line.startsWith("*") || line.startsWith("/**") || line.startsWith("//")) {
              commentLines.unshift(line.replace(/^\/?\*+\s*|\s*\*+\/?$/g, "").trim())
            } else if (line === "" || line.startsWith("*/")) {
              continue
            } else {
              break
            }
          }
          if (commentLines.length > 0) {
            documentation = commentLines.filter(Boolean).join(" ")
          }
        }

        const result: SymbolInfo = {
          name: symbolName,
          type,
          file: path.relative(root, file),
          line: lineNumber,
          signature: matchLine.trim().slice(0, 150),
          ...(documentation ? { documentation } : {}),
        }

        symbolCache.set(cacheKey, result)
        cacheTimestamp = Date.now()

        return result
      }
    }
  }

  symbolCache.set(cacheKey, null)
  return null
}

/**
 * Find all references to a symbol in the codebase
 *
 * @param symbolName - Name of the symbol to find references for
 * @param root - Project root directory
 */
export async function findReferences(
  symbolName: string,
  root: string = DEFAULT_ROOT
): Promise<Reference[]> {
  if (!symbolName || !symbolName.trim()) {
    return []
  }

  const references: Reference[] = []
  const files = getProjectFiles(root)

  // Match the symbol as a word boundary
  const regex = new RegExp(`\\b${symbolName}\\b`, "g")

  for (const file of files) {
    const content = readFileContent(file)
    if (!content) continue

    const lines = content.split("\n")
    const relativePath = path.relative(root, file)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (regex.test(line)) {
        references.push({
          file: relativePath,
          line: i + 1,
          context: line.trim().slice(0, 150),
        })
        regex.lastIndex = 0 // Reset regex state
      }
    }
  }

  return references.slice(0, 100) // Limit to 100 references
}

/**
 * Get file dependencies (imports) for a given file
 *
 * @param filePath - Path to the file (relative or absolute)
 * @param root - Project root directory
 */
export async function getDependencies(
  filePath: string,
  root: string = DEFAULT_ROOT
): Promise<string[]> {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath)

  const content = readFileContent(absolutePath)
  if (!content) return []

  const dependencies: string[] = []

  // Match import statements
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?["']([^"']+)["']/g
  let match

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1]
    if (importPath && !importPath.startsWith(".")) {
      // External dependency
      dependencies.push(importPath)
    } else if (importPath) {
      // Resolve relative import
      const dir = path.dirname(absolutePath)
      const resolved = path.resolve(dir, importPath)
      dependencies.push(path.relative(root, resolved))
    }
  }

  return [...new Set(dependencies)] // Deduplicate
}

/**
 * Get a summary of the codebase structure
 *
 * @param root - Project root directory
 */
export async function getCodebaseSummary(root: string = DEFAULT_ROOT): Promise<{
  totalFiles: number
  filesByDirectory: Record<string, number>
  topLevelDirectories: string[]
}> {
  const files = getProjectFiles(root)
  const filesByDirectory: Record<string, number> = {}

  for (const file of files) {
    const relativePath = path.relative(root, file)
    const parts = relativePath.split(path.sep)
    const topLevel = parts.slice(0, 2).join("/")

    filesByDirectory[topLevel] = (filesByDirectory[topLevel] || 0) + 1
  }

  const topLevelDirectories = [...new Set(
    files.map(f => {
      const rel = path.relative(root, f)
      const parts = rel.split(path.sep)
      return parts[0] + "/" + parts[1]
    })
  )].sort()

  return {
    totalFiles: files.length,
    filesByDirectory,
    topLevelDirectories,
  }
}

/**
 * Search for a specific pattern in the codebase (e.g., workflow definitions, module exports)
 *
 * @param pattern - Regex pattern to search for
 * @param root - Project root directory
 */
export async function searchPattern(
  pattern: RegExp,
  root: string = DEFAULT_ROOT
): Promise<CodeSearchResult[]> {
  const results: CodeSearchResult[] = []
  const files = getProjectFiles(root)

  for (const file of files) {
    const content = readFileContent(file)
    if (!content) continue

    const lines = content.split("\n")
    const relativePath = path.relative(root, file)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (pattern.test(line)) {
        results.push({
          file: relativePath,
          line: i + 1,
          content: line.trim().slice(0, 200),
          score: 100,
        })
        pattern.lastIndex = 0 // Reset regex state for global patterns
      }
    }
  }

  return results.slice(0, 100)
}
