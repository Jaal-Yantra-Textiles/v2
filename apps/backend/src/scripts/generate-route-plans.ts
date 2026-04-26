#!/usr/bin/env ts-node
/**
 * API Route Plan Generator
 * 
 * Parses API routes from src/api/admin and generates example query plans
 * that can be used by the query planner for the "learning RAG" pattern.
 * 
 * Usage: npx ts-node scripts/generate-route-plans.ts
 */

import * as fs from "fs"
import * as path from "path"

interface ApiRoute {
  method: string
  path: string
  module: string
  entity: string
  operation: "list" | "retrieve" | "create" | "update" | "delete"
  hasBody: boolean
  hasParams: boolean
  hasQuery: boolean
  filters?: string[]
  description?: string
}

interface QueryPlanExample {
  id: string
  naturalQuery: string
  plan: {
    steps: PlanStep[]
    finalEntity: string
    explanation: string
  }
  tags: string[]
  module: string
}

interface PlanStep {
  step: number
  entity: string
  operation: "list" | "retrieve" | "listAndCount"
  filters: Record<string, any>
  relations?: string[]
  executionMethod?: "http" | "module"
}

// Known entities to module mapping
const ENTITY_TO_MODULE: Record<string, string> = {
  design: "designs",
  designs: "designs",
  partner: "partners",
  partners: "partners",
  company: "company",
  companies: "company",
  person: "person",
  persons: "person",
  feedback: "feedbacks",
  feedbacks: "feedbacks",
  inventory: "inventory-items",
  inventoryItem: "inventory-items",
  inventoryItems: "inventory-items",
  task: "tasks",
  tasks: "tasks",
  media: "medias",
  medias: "medias",
  note: "notes",
  notes: "notes",
  category: "categories",
  categories: "categories",
  product: "products",
  products: "products",
  order: "orders",
  orders: "orders",
  customer: "customers",
  customers: "customers",
}

function parseRoutePath(filePath: string, content: string): ApiRoute[] {
  const routes: ApiRoute[] = []
  const moduleName = path.basename(path.dirname(path.dirname(filePath)))
  const entityName = ENTITY_TO_MODULE[moduleName] || moduleName.replace(/s$/, "")

  const methodMatches = content.matchAll(/export\s+(?:const|async\s+function)\s+(GET|POST|PATCH|DELETE|PUT)\s*=/g)
  const methodPositions: { method: string; pos: number }[] = []
  for (const match of methodMatches) {
    methodPositions.push({ method: match[1], pos: match.index! })
  }

  for (const { method, pos } of methodPositions) {
    let routePath = ""
    let hasBody = false
    let hasParams = false
    let hasQuery = false
    let filters: string[] = []
    let description = ""

    // Find the route path from context
    const contextStart = Math.max(0, pos - 2000)
    const context = content.slice(contextStart, pos + 500)

    // Check for path patterns
    const pathMatch = context.match(/(?:\/admin|\/store|\/partners)\/([^{}]+?)(?:\/|:|\?|\s|$|\))/i)
    if (pathMatch) {
      routePath = pathMatch[1].trim()
    }

    // Detect if has body parameters
    if (/req\.validatedBody|req\.body/i.test(context)) {
      hasBody = true
    }

    // Detect if has path parameters (e.g., /:id, {id})
    if (/\/:[a-zA-Z]+|\{[a-zA-Z]+(,[a-zA-Z]+)*\}/.test(routePath)) {
      hasParams = true
    }

    // Detect if has query parameters
    if (/req\.query/i.test(context)) {
      hasQuery = true
      const queryMatches = context.matchAll(/req\.query\.([a-zA-Z_]+)/g)
      for (const m of queryMatches) {
        filters.push(m[1])
      }
    }

    // Infer operation from method and path
    let operation: ApiRoute["operation"] = "list"
    if (method === "POST") {
      operation = "create"
    } else if (method === "PATCH" || method === "PUT") {
      operation = "update"
    } else if (method === "DELETE") {
      operation = "delete"
    } else if (routePath.includes(":") || routePath.includes("/{")) {
      operation = "retrieve"
    } else {
      operation = "list"
    }

    // Generate description from path
    description = `${method} ${routePath || "/" + moduleName}`

    routes.push({
      method,
      path: routePath || "/" + moduleName,
      module: moduleName,
      entity: entityName,
      operation,
      hasBody,
      hasParams,
      hasQuery,
      filters: [...new Set(filters)],
      description,
    })
  }

  return routes
}

function generatePlanExamples(routes: ApiRoute[]): QueryPlanExample[] {
  const examples: QueryPlanExample[] = []

  for (const route of routes) {
    const examplePlans = generateExamplesForRoute(route)
    examples.push(...examplePlans)
  }

  return examples
}

function generateExamplesForRoute(route: ApiRoute): QueryPlanExample[] {
  const examples: QueryPlanExample[] = []
  const { module, entity, operation, path, filters } = route

  // Generate natural language queries based on operation
  switch (operation) {
    case "list":
      examples.push({
        id: `plan_${module}_list_${Date.now()}`,
        naturalQuery: `List all ${module}`,
        plan: {
          steps: [{
            step: 1,
            entity,
            operation: "list" as const,
            filters: {},
            executionMethod: "http" as const,
          }],
          finalEntity: entity,
          explanation: `Direct list of all ${module}`,
        },
        tags: [module, "list", operation],
        module,
      })

      if (filters && filters.length > 0) {
        for (const filter of filters.slice(0, 3)) {
          examples.push({
            id: `plan_${module}_filter_${filter}_${Date.now()}`,
            naturalQuery: `List ${module} filtered by ${filter}`,
            plan: {
              steps: [{
                step: 1,
                entity,
                operation: "list" as const,
                filters: { [filter]: "{value}" },
                executionMethod: "http" as const,
              }],
              finalEntity: entity,
              explanation: `List ${module} with ${filter} filter`,
            },
            tags: [module, "list", "filter"],
            module,
          })
        }
      }
      break

    case "retrieve":
      examples.push({
        id: `plan_${module}_get_${Date.now()}`,
        naturalQuery: `Get ${module} by ID`,
        plan: {
          steps: [{
            step: 1,
            entity,
            operation: "retrieve" as const,
            filters: { id: "{id}" },
            executionMethod: "http" as const,
          }],
          finalEntity: entity,
          explanation: `Retrieve single ${module} by ID`,
        },
        tags: [module, "retrieve"],
        module,
      })
      break

    case "create":
      examples.push({
        id: `plan_${module}_create_${Date.now()}`,
        naturalQuery: `Create new ${module}`,
        plan: {
          steps: [{
            step: 1,
            entity,
            operation: "list" as const,
            filters: {},
            executionMethod: "http" as const,
          }],
          finalEntity: entity,
          explanation: `Create new ${module} via POST`,
        },
        tags: [module, "create", "workflow"],
        module,
      })
      break

    case "update":
      examples.push({
        id: `plan_${module}_update_${Date.now()}`,
        naturalQuery: `Update ${module}`,
        plan: {
          steps: [{
            step: 1,
            entity,
            operation: "retrieve" as const,
            filters: { id: "{id}" },
            executionMethod: "http" as const,
          }],
          finalEntity: entity,
          explanation: `Update ${module} by ID via PATCH`,
        },
        tags: [module, "update"],
        module,
      })
      break

    case "delete":
      examples.push({
        id: `plan_${module}_delete_${Date.now()}`,
        naturalQuery: `Delete ${module}`,
        plan: {
          steps: [{
            step: 1,
            entity,
            operation: "retrieve" as const,
            filters: { id: "{id}" },
            executionMethod: "http" as const,
          }],
          finalEntity: entity,
          explanation: `Delete ${module} by ID via DELETE`,
        },
        tags: [module, "delete"],
        module,
      })
      break
  }

  return examples
}

function scanApiRoutes(): ApiRoute[] {
  const routes: ApiRoute[] = []
  const adminApiPath = path.join(process.cwd(), "src/api/admin")

  if (!fs.existsSync(adminApiPath)) {
    console.warn("Admin API path not found:", adminApiPath)
    return routes
  }

  function scanDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "__tests__") {
        scanDir(fullPath)
      } else if (entry.isFile() && (entry.name === "route.ts" || entry.name === "route.tsx")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8")
          const routeInfos = parseRoutePath(fullPath, content)
          routes.push(...routeInfos)
        } catch (e) {
          console.warn("Failed to parse:", fullPath)
        }
      }
    }
  }

  scanDir(adminApiPath)
  return routes
}

function generateExamplesJson(examples: QueryPlanExample[]): object {
  const grouped: Record<string, QueryPlanExample[]> = {}

  for (const example of examples) {
    if (!grouped[example.module]) {
      grouped[example.module] = []
    }
    grouped[example.module].push(example)
  }

  return {
    generated: new Date().toISOString(),
    totalExamples: examples.length,
    byModule: grouped,
    allExamples: examples,
  }
}

async function main() {
  console.log("🔍 Scanning API routes...")

  const routes = scanApiRoutes()
  console.log(`Found ${routes.length} API routes`)

  // Group by module
  const routesByModule: Record<string, ApiRoute[]> = {}
  for (const route of routes) {
    if (!routesByModule[route.module]) {
      routesByModule[route.module] = []
    }
    routesByModule[route.module].push(route)
  }

  console.log("\nRoutes by module:")
  for (const [module, moduleRoutes] of Object.entries(routesByModule)) {
    console.log(`  ${module}: ${moduleRoutes.length} routes`)
  }

  console.log("\n📝 Generating query plan examples...")

  const examples = generatePlanExamples(routes)
  console.log(`Generated ${examples.length} plan examples`)

  // Output summary
  console.log("\nExamples by module:")
  const examplesByModule: Record<string, number> = {}
  for (const example of examples) {
    examplesByModule[example.module] = (examplesByModule[example.module] || 0) + 1
  }
  for (const [module, count] of Object.entries(examplesByModule)) {
    console.log(`  ${module}: ${count} examples`)
  }

  // Generate the JSON output
  const output = generateExamplesJson(examples)

  // Write to file
  const outputPath = path.join(process.cwd(), "specs/api-route-plans.json")
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(`\n✅ Written to ${outputPath}`)

  // Also output to console for easy copy
  console.log("\n--- Sample Examples ---")
  const sampleExamples = examples.slice(0, 5)
  for (const example of sampleExamples) {
    console.log(`\nQuery: "${example.naturalQuery}"`)
    console.log(`Plan: ${JSON.stringify(example.plan, null, 2)}`)
  }

  return output
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
