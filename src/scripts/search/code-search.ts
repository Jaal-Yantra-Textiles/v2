#!/usr/bin/env node

/**
 * Code Search Indexer for Medusa Modules
 * 
 * Uses ripgrep patterns to index workflows, routes, and links
 * Provides natural language search capabilities for module analysis
 */

import * as fs from "fs/promises"
import * as path from "path"
import * as dotenv from "dotenv"

dotenv.config()

const PROJECT_ROOT = path.resolve(__dirname, "..", "..")

interface CodeIndex {
  workflows: WorkflowIndexItem[]
  routes: RouteIndexItem[]
  links: LinkIndexItem[]
  models: ModelIndexItem[]
}

interface WorkflowIndexItem {
  name: string
  file: string
  description: string
  steps: string[]
  inputType?: string
  outputType?: string
  category: string
  content: string
}

interface RouteIndexItem {
  path: string
  method: string
  file: string
  description: string
  pathParams: string[]
  queryParams?: string[]
  bodyType?: string
  category: string
  content: string
}

interface LinkIndexItem {
  sourceModule: string
  sourceEntity: string
  targetModule: string
  targetEntity: string
  linkType: string
  file: string
  content: string
}

interface ModelIndexItem {
  module: string
  entity: string
  table: string
  fields: string[]
  relations: string[]
  content: string
}

class CodeSearchIndexer {
  private _index: CodeIndex = {
    workflows: [],
    routes: [],
    links: [],
    models: []
  }

  private apiKey: string

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || ""
  }

  async build(): Promise<CodeIndex> {
    console.log("🔍 Indexing codebase...")

    await Promise.all([
      this.indexWorkflows(),
      this.indexRoutes(),
      this.indexLinks(),
      this.indexModels()
    ])

    console.log(`✅ Indexed: ${this._index.workflows.length} workflows, ${this._index.routes.length} routes, ${this._index.links.length} links, ${this._index.models.length} models`)

    return this._index
  }

  private async indexWorkflows() {
    console.log("  📦 Indexing workflows...")

    const workflowsDir = path.join(PROJECT_ROOT, "src", "workflows")
    const modulesDir = path.join(PROJECT_ROOT, "src", "modules")

    try {
      const workflowFiles = await this.findFiles(workflowDir, /\.ts$/)
      const moduleWorkflowFiles: string[] = []

      try {
        const moduleDirs = await fs.readdir(modulesDir)
        for (const module of moduleDirs) {
          const moduleWorkflowsDir = path.join(modulesDir, module, "workflows")
          const files = await this.findFiles(moduleWorkflowsDir, /\.ts$/).catch(() => [])
          moduleWorkflowFiles.push(...files)
        }
      } catch {
        // Ignore if modules dir doesn't exist
      }

      const allWorkflowFiles = [...workflowFiles, ...moduleWorkflowFiles]

      for (const file of allWorkflowFiles) {
        const content = await fs.readFile(file, "utf-8")

        const workflowPatterns = [
          /export\s+const\s+(\w+)\s*=\s*createWorkflow\s*\(\s*["']([^"']+)["']/g,
          /const\s+(\w+)\s*=\s*createWorkflow\s*\(\s*["']([^"']+)["']/g,
          /export\s+default\s+createWorkflow\s*\(\s*["']([^"']+)["']/g
        ]

        for (const pattern of workflowPatterns) {
          let match
          while ((match = pattern.exec(content)) !== null) {
            const [, exportName, workflowName] = match

            const stepMatches = content.matchAll(/createStep\s*\(\s*\{[^}]*id:\s*["']([^"']+)["'][^}]*\}/g)
            const steps = [...stepMatches].map(m => m[1])

            const inputMatch = content.match(/inputSchema\s*:\s*(\w+)/)
            const outputMatch = content.match(/outputSchema\s*:\s*(\w+)/)

            const category = this.categorizeWorkflow(workflowName)

            this._index.workflows.push({
              name: workflowName,
              file: path.relative(PROJECT_ROOT, file),
              description: `Workflow: ${workflowName}`,
              steps,
              inputType: inputMatch?.[1],
              outputType: outputMatch?.[1],
              category,
              content
            })
          }
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Error indexing workflows: ${error}`)
    }
  }

  private async indexRoutes() {
    console.log("  🌐 Indexing API routes...")

    const apiDir = path.join(PROJECT_ROOT, "src", "api", "admin")

    try {
      const routeFiles = await this.findFiles(apiDir, /route\.ts$/)

      for (const file of routeFiles) {
        const content = await fs.readFile(file, "utf-8")

        const methods = this.extractHttpMethods(content)

        let apiPath = "/" + path.relative(apiDir, file)
          .replace("/route.ts", "")
          .replace(/\[(\w+)\]/g, ":$1")
          .replace(/\\/g, "/")

        const pathParams = (apiPath.match(/:(\w+)/g) || []).map(p => p.slice(1))
        const category = this.categorizeRoute(apiPath)

        for (const method of methods) {
          this._index.routes.push({
            path: apiPath,
            method,
            file: path.relative(PROJECT_ROOT, file),
            description: `${method} ${apiPath}`,
            pathParams,
            category,
            content
          })
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Error indexing routes: ${error}`)
    }
  }

  private async indexLinks() {
    console.log("  🔗 Indexing module links...")

    const linksDir = path.join(PROJECT_ROOT, "src", "links")

    try {
      const linkFiles = await this.findFiles(linksDir, /\.ts$/)

      for (const file of linkFiles) {
        const content = await fs.readFile(file, "utf-8")

        const importMap: Record<string, string> = {}
        const importRegex = /import\s+(\w+(?:Module)?)\s+from\s+["']([^"']+)["']/g
        let importMatch
        while ((importMatch = importRegex.exec(content)) !== null) {
          const [, importName, importPath] = importMatch
          const moduleName = importPath.split("/").pop()?.replace(/module$/i, "") || importName
          importMap[importName] = moduleName
        }

        const defineLinkRegex = /defineLink\s*\(\s*([\s\S]*?)\s*\)/g
        let linkMatch
        while ((linkMatch = defineLinkRegex.exec(content)) !== null) {
          const linkContent = linkMatch[1]

          const configPatterns = [
            /(\w+(?:Module)?)\.linkable\.(\w+)/g,
            /\{\s*linkable:\s*(\w+(?:Module)?)\.linkable\.(\w+)/g
          ]

          const configs: Array<{ module: string; entity: string }> = []

          for (const pattern of configPatterns) {
            let configMatch
            while ((configMatch = pattern.exec(linkContent)) !== null) {
              const [, moduleName, entityName] = configMatch
              const resolvedModule = importMap[moduleName] || moduleName.toLowerCase()
              configs.push({ module: resolvedModule, entity: entityName })
            }
          }

          if (configs.length >= 2) {
            const source = configs[0]
            const target = configs[1]

            const isListSource = linkContent.includes("isList: true")
            const isListTarget = linkContent.includes("isList: true")
            let linkType = "one-to-one"
            if (isListSource && isListTarget) linkType = "many-to-many"
            else if (isListSource || isListTarget) linkType = "one-to-many"

            this._index.links.push({
              sourceModule: source.module,
              sourceEntity: source.entity,
              targetModule: target.module,
              targetEntity: target.entity,
              linkType,
              file: path.relative(PROJECT_ROOT, file),
              content
            })
          }
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Error indexing links: ${error}`)
    }
  }

  private async indexModels() {
    console.log("  📋 Indexing data models...")

    const modulesDir = path.join(PROJECT_ROOT, "src", "modules")

    try {
      const moduleDirs = await fs.readdir(modulesDir)

      for (const module of moduleDirs) {
        const modelsDir = path.join(modulesDir, module, "models")

        try {
          const modelFiles = await this.findFiles(modelsDir, /\.ts$/)

          for (const file of modelFiles) {
            const content = await fs.readFile(file, "utf-8")

            const entityMatch = content.match(/model\.define\s*\(\s*\{\s*[^}]*name:\s*["'](\w+)["']/)
            const tableMatch = content.match(/model\.define\s*\(\s*\{\s*[^}]*tableName:\s*["'](\w+)["']/)

            if (entityMatch && tableMatch) {
              const entityName = entityMatch[1]
              const tableName = tableMatch[1]

              const fieldMatches = content.matchAll(/(\w+)\s*:\s*model\.\w+\([^)]*\)/g)
              const fields = [...fieldMatches].map(m => m[1])

              const relationMatches = content.matchAll(/model\.\w+\s*\(\s*\(\)\s*=>\s*(\w+)/g)
              const relations = [...relationMatches].map(m => m[1])

              this._index.models.push({
                module,
                entity: entityName,
                table: tableName,
                fields,
                relations,
                content
              })
            }
          }
        } catch {
          // Skip if models dir doesn't exist
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Error indexing models: ${error}`)
    }
  }

  private extractHttpMethods(content: string): string[] {
    const methods: string[] = []
    const methodPatterns = [
      { method: "GET", pattern: /export\s+(?:const\s+GET\s*=\s*async|async\s+function\s+GET)/g },
      { method: "POST", pattern: /export\s+(?:const\s+POST\s*=\s*async|async\s+function\s+POST)/g },
      { method: "PUT", pattern: /export\s+(?:const\s+PUT\s*=\s*async|async\s+function\s+PUT)/g },
      { method: "DELETE", pattern: /export\s+(?:const\s+DELETE\s*=\s*async|async\s+function\s+DELETE)/g },
      { method: "PATCH", pattern: /export\s+(?:const\s+PATCH\s*=\s*async|async\s+function\s+PATCH)/g }
    ]

    for (const { method, pattern } of methodPatterns) {
      if (pattern.test(content)) {
        methods.push(method)
      }
    }

    return methods
  }

  private categorizeWorkflow(name: string): string {
    const nameLower = name.toLowerCase()
    if (nameLower.startsWith("create") || nameLower.startsWith("add") || nameLower.startsWith("new")) return "create"
    if (nameLower.startsWith("update") || nameLower.startsWith("edit")) return "update"
    if (nameLower.startsWith("delete") || nameLower.startsWith("remove")) return "delete"
    if (nameLower.startsWith("list") || nameLower.startsWith("get") || nameLower.startsWith("retrieve")) return "read"
    if (nameLower.startsWith("send") || nameLower.startsWith("notify")) return "action"
    return "utility"
  }

  private categorizeRoute(apiPath: string): string {
    if (apiPath.includes(":id")) return "retrieve"
    if (apiPath.match(/\/[a-z]+\/\?:id\//)) return "nested"
    if (apiPath.match(/\/[a-z]+\/\?:id$/)) return "update"
    return "list"
  }

  private async findFiles(dir: string, pattern: RegExp): Promise<string[]> {
    const files: string[] = []

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          files.push(...await this.findFiles(fullPath, pattern))
        } else if (entry.isFile() && pattern.test(entry.name)) {
          files.push(fullPath)
        }
      }
    } catch {
      // Ignore errors
    }

    return files
  }

  async search(query: string, type: "workflows" | "routes" | "links" | "models" | "all" = "all", limit: number = 5): Promise<any[]> {
    const queryLower = query.toLowerCase()
    const queryTerms = queryLower.split(/\s+/)

    const items = type === "all" 
      ? [...this._index.workflows, ...this._index.routes, ...this._index.links, ...this._index.models]
      : this._index[type]

    const scored = items.map(item => {
      const contentLower = item.content.toLowerCase()
      const nameLower = "name" in item ? (item as any).name?.toLowerCase() || "" : 
                        "path" in item ? (item as any).path?.toLowerCase() || "" : ""

      let score = 0
      for (const term of queryTerms) {
        if (term === "workflow" && type === "all" && "steps" in item) score += 10
        if (term === "route" && type === "all" && "path" in item) score += 10
        if (term === "link" && type === "all" && "sourceModule" in item) score += 10
        if (contentLower.includes(term)) score += 1
        if (nameLower.includes(term)) score += 3
      }

      return { item, score }
    })

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.item)
  }

  async findWorkflowsForModule(moduleName: string) {
    const nameLower = moduleName.toLowerCase()
    return this.search(`workflow ${moduleName}`, "workflows", 20)
      .filter((w: any) => w.name.toLowerCase().includes(nameLower) || w.file.includes(`/${moduleName}/`))
  }

  async findRoutesForModule(moduleName: string) {
    const nameLower = moduleName.toLowerCase()
    const plural = moduleName + "s"
    return this.search(`route ${moduleName}`, "routes", 20)
      .filter((r: any) => r.path.includes(`/${nameLower}/`) || r.path.includes(`/${plural}/`))
  }

  async findLinksForModule(moduleName: string) {
    const nameLower = moduleName.toLowerCase()
    return this.search(`link ${moduleName}`, "links", 20)
      .filter((l: any) => l.sourceModule === nameLower || l.targetModule === nameLower)
  }

  getIndex(): CodeIndex {
    return this._index
  }

  async save(outputPath: string = "code-index.json"): Promise<void> {
    const outputFile = path.join(PROJECT_ROOT, outputPath)
    await fs.writeFile(outputFile, JSON.stringify(this._index, null, 2), "utf-8")
    console.log(`💾 Index saved to: ${outputFile}`)
  }

  async load(inputPath: string = "code-index.json"): Promise<void> {
    const inputFile = path.join(PROJECT_ROOT, inputPath)
    try {
      const data = await fs.readFile(inputFile, "utf-8")
      this._index = JSON.parse(data)
      console.log(`📂 Loaded index from: ${inputFile}`)
    } catch (error) {
      console.warn(`⚠️  Could not load index: ${error}`)
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || "index"

  const indexer = new CodeSearchIndexer()

  if (command === "index") {
    await indexer.build()
    await indexer.save()

    console.log("\n📝 Example Searches:")
    console.log("  node src/scripts/code-search.js search 'create partner workflow'")
    console.log("  node src/scripts/code-search.js search 'GET partners route'")
    console.log("  node src/scripts/code-search.js module partner")
  } 
  else if (command === "search") {
    const query = args[1] || ""
    const type = (args[2] as any) || "all"
    const limit = parseInt(args[3]) || 5

    await indexer.load()
    const results = await indexer.search(query, type, limit)

    console.log(`\n🔍 Search Results for: "${query}"\n`)
    results.forEach((result: any, i: number) => {
      console.log(`${i + 1}. ${result.name || result.path || result.description}`)
      console.log(`   File: ${result.file}`)
      if (result.steps) {
        console.log(`   Steps: ${result.steps.join(" → ")}`)
      }
      if (result.pathParams?.length) {
        console.log(`   Params: ${result.pathParams.join(", ")}`)
      }
      console.log("")
    })
  }
  else if (command === "module") {
    const moduleName = args[1] || ""

    await indexer.load()
    await indexer.build()

    console.log(`\n📦 Module Analysis: ${moduleName}\n`)

    const workflows = await indexer.findWorkflowsForModule(moduleName)
    console.log(`Workflows (${workflows.length}):`)
    workflows.slice(0, 10).forEach((w: any) => console.log(`  - ${w.name} [${w.category}]`))

    const routes = await indexer.findRoutesForModule(moduleName)
    console.log(`\nRoutes (${routes.length}):`)
    routes.slice(0, 10).forEach((r: any) => console.log(`  - ${r.method} ${r.path}`))

    const links = await indexer.findLinksForModule(moduleName)
    console.log(`\nLinks (${links.length}):`)
    links.forEach((l: any) => console.log(`  - ${l.sourceModule}.${l.sourceEntity} ↔ ${l.targetModule}.${l.targetEntity} (${l.linkType})`))
  }
  else {
    console.log(`
🔍 Code Search Indexer

Usage:
  node src/scripts/code-search.js [command] [options]

Commands:
  index           Build the code index (default)
  search <query>  Search the index
  module <name>   Analyze a specific module

Examples:
  node src/scripts/code-search.js index
  node src/scripts/code-search.js search "create workflow"
  node src/scripts/code-search.js search "GET partners" routes
  node src/scripts/code-search.js module partner
    `)
  }
}

main().catch(console.error)
