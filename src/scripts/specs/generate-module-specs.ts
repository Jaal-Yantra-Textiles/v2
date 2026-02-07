#!/usr/bin/env node

/**
 * Custom Module Spec Generator
 * 
 * Proof of concept for intelligent RAG system that:
 * 1. Extracts rich module metadata using multiple sources
 * 2. Uses LLM to generate business process documentation
 * 3. Creates actionable intelligence for complex queries
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"
import * as fs from "fs/promises"
import * as path from "path"
import { glob } from "glob"

interface ModuleSpec {
  name: string
  entityName: string
  tableName: string
  description: string
  fields: FieldInfo[]
  relations: RelationInfo[]
  workflows: WorkflowInfo[]
  apiRoutes: APIRouteInfo[]
  businessProcesses: BusinessProcess[]
}

interface FieldInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  enumValues?: string[]
  searchable: boolean
  filterable: boolean
}

interface RelationInfo {
  name: string
  targetEntity: string
  cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many"
  inverseSide?: string
}

interface WorkflowInfo {
  name: string
  description: string
  inputFields: string[]
  outputFields: string[]
  triggers: string[]
}

interface APIRouteInfo {
  path: string
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  description: string
  requiresAuth: boolean
  queryParams?: string[]
}

interface BusinessProcess {
  name: string
  description: string
  steps: ProcessStep[]
  relatedModules: string[]
  kpis: string[]
}

interface ProcessStep {
  name: string
  description: string
  inputRequired: boolean
  outputGenerated: boolean
  estimatedTime?: string
}

class ModuleSpecGenerator {
  private projectRoot: string
  private modulesDir: string
  private openrouter: any

  constructor() {
    this.projectRoot = path.join(__dirname, "..", "..")
    this.modulesDir = path.join(this.projectRoot, "src/modules")
    
    this.openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    })
  }

  /**
   * Generate comprehensive specification for a specific module
   */
  async generateModuleSpec(moduleName: string): Promise<ModuleSpec> {
    console.log(`🔍 Analyzing module: ${moduleName}`)

    // 1. Extract structured data from code
    const moduleData = await this.extractModuleData(moduleName)
    
    // 2. Use LLM to generate business process documentation
    const businessProcesses = await this.generateBusinessProcesses(moduleName, moduleData)
    
    // 3. Build comprehensive spec
    const spec: ModuleSpec = {
      name: moduleName,
      entityName: moduleData.entityName,
      tableName: moduleData.tableName,
      description: await this.generateModuleDescription(moduleName, moduleData),
      fields: moduleData.fields,
      relations: moduleData.relations,
      workflows: moduleData.workflows,
      apiRoutes: moduleData.apiRoutes,
      businessProcesses
    }

    console.log(`✅ Generated spec for ${moduleName}`)
    return spec
  }

  /**
   * Extract structured data from module files
   */
  private async extractModuleData(moduleName: string): Promise<any> {
    const moduleDir = path.join(this.modulesDir, moduleName)
    const data: any = {
      entityName: "",
      tableName: "",
      fields: [],
      relations: [],
      workflows: [],
      apiRoutes: []
    }

    try {
      // Extract from models
      const modelFiles = await glob(`${moduleDir}/models/*.ts`)
      for (const file of modelFiles) {
        const content = await fs.readFile(file, "utf-8")
        
        // Parse model.define() calls
        const modelMatch = content.match(/model\.define\s*\(\s*["']([^"']+)["']/)
        if (modelMatch) {
          data.tableName = modelMatch[1]
          data.entityName = this.toPascalCase(modelMatch[1])
        }

        // Extract fields
        const fieldMatches = content.matchAll(/(\w+)\s*:\s*model\.(id|text|number|boolean|dateTime|enum)\([^)]*\)/g)
        for (const match of fieldMatches) {
          const [fullMatch, fieldName, fieldType] = match
          data.fields.push({
            name: fieldName,
            type: this.mapFieldType(fieldType),
            nullable: false,
            primaryKey: fieldType === "id",
            searchable: ["text", "id"].includes(fieldType),
            filterable: !["dateTime", "json"].includes(fieldType)
          })
        }

        // Extract enums
        const enumMatches = content.matchAll(/enum\(\s*\[([^\]]+)\]/g)
        for (const enumMatch of enumMatches) {
          const enumValues = enumMatch[1].split(",").map(v => v.trim().replace(/["']/g, ""))
          if (data.fields.length > 0) {
            data.fields[data.fields.length - 1].enumValues = enumValues
            data.fields[data.fields.length - 1].type = "enum"
          }
        }
      }

      // Extract relations
      const relationMatches = content.matchAll(/\.(hasOne|hasMany|belongsTo|manyToMany)\s*\([^)]+\)/g)
      for (const match of relationMatches) {
        const relationType = match[0].split('(')[0]
        data.relations.push({
          name: relationType,
          targetEntity: "Unknown", // Would need deeper parsing
          cardinality: this.inferCardinality(relationType)
        })
      }

      // Extract from service
      const serviceFile = path.join(moduleDir, "service.ts")
      if (await this.fileExists(serviceFile)) {
        const serviceContent = await fs.readFile(serviceFile, "utf-8")
        
        // Find workflow references
        const workflowMatches = serviceContent.matchAll(/\w+Workflow/g)
        for (const workflow of workflowMatches) {
          data.workflows.push({
            name: workflow,
            description: `Workflow for ${workflow.replace("Workflow", "")}`,
            inputFields: [],
            outputFields: [],
            triggers: []
          })
        }
      }

      // Extract API routes
      const apiDir = path.join(this.projectRoot, "src/api/admin", moduleName)
      if (await this.directoryExists(apiDir)) {
        const routeFiles = await glob(`${apiDir}/**/route.ts`)
        for (const file of routeFiles) {
          const content = await fs.readFile(file, "utf-8")
          
          // Extract HTTP methods
          const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"].filter(m => content.includes(m))
          const routePath = this.extractRoutePath(file, this.projectRoot)
          
          if (routePath) {
            data.apiRoutes.push({
              path: routePath,
              method: methods[0] as any,
              description: `${methods[0]} ${routePath}`,
              requiresAuth: true
            })
          }
        }
      }

    } catch (error) {
      console.warn(`⚠️  Error extracting data for ${moduleName}:`, error)
    }

    return data
  }

  /**
   * Generate business process documentation using LLM
   */
  private async generateBusinessProcesses(
    moduleName: string,
    moduleData: any
  ): Promise<BusinessProcess[]> {
    console.log(`🤖 Generating business processes for ${moduleName}`)

    const context = this.buildModuleContext(moduleName, moduleData)
    const prompt = `
As a business process analyst, analyze the ${moduleName} module and generate typical business processes.

## Module Context
${context}

## Task
Generate 3-5 realistic business processes for this module that would be valuable for:
- Business intelligence
- Operational efficiency  
- Decision making
- Customer communication

For each process, provide:
- Clear, actionable name
- Step-by-step description
- Required inputs/data
- Expected outputs
- Related modules it might need to interact with
- Key performance indicators (KPIs) to measure success

Format as JSON array:
{
  "processes": [
    {
      "name": "partner_outreach_strategy",
      "description": "Create personalized outreach plans based on partner engagement history",
      "steps": [
        {
          "name": "analyze_partner_profile",
          "description": "Review partner's order history, payment patterns, and communication preferences",
          "inputRequired": true,
          "outputGenerated": true,
          "estimatedTime": "5-10 minutes"
        },
        {
          "name": "generate_personalized_approach",
          "description": "Create tailored outreach message and communication plan",
          "inputRequired": true,
          "outputGenerated": true,
          "estimatedTime": "2-5 minutes"
        }
      ],
      "relatedModules": ["partner", "order", "payment"],
      "kpis": ["response_rate", "conversion_rate", "engagement_score"]
    }
  ]
}
`

    try {
      const { text } = await generateText({
        model: this.openrouter("meta-llama/llama-3.3-70b-instruct:free"),
        prompt,
        maxOutputTokens: 2000,
        temperature: 0.3
      })

      const parsed = JSON.parse(text.replace(/```json\n?/, "").replace(/```\n?/, ""))
      return parsed.processes || []
    } catch (error) {
      console.warn(`⚠️  Failed to generate business processes for ${moduleName}:`, error)
      return []
    }
  }

  /**
   * Generate comprehensive module description using LLM
   */
  private async generateModuleDescription(
    moduleName: string,
    moduleData: any
  ): Promise<string> {
    const context = this.buildModuleContext(moduleName, moduleData)
    const prompt = `
Generate a concise, professional description for the ${moduleName} module.

## Module Context
${context}

## Task
Write a 2-3 sentence description that explains:
- What this module manages/stores
- Its role in the textile commerce platform
- Key business value it provides

Format as a single paragraph without markdown.
`

    try {
      const { text } = await generateText({
        model: this.openrouter("google/gemini-2.0-flash-exp:free"),
        prompt,
        maxOutputTokens: 200,
        temperature: 0.5
      })

      return text.trim()
    } catch (error) {
      console.warn(`⚠️  Failed to generate description for ${moduleName}:`, error)
      return `${moduleName} module for managing related data.`
    }
  }

  /**
   * Build context string for LLM
   */
  private buildModuleContext(moduleName: string, moduleData: any): string {
    const parts = [
      `## Module: ${moduleName}`,
      `Entity: ${moduleData.entityName || 'Unknown'}`,
      `Table: ${moduleData.tableName || 'Unknown'}`,
      ``,
      `## Fields (${moduleData.fields.length})`,
      moduleData.fields.map((f: any) => 
        `- ${f.name}: ${f.type}${f.enumValues ? ` (${f.enumValues.join(" | ")})` : ""}${f.primaryKey ? " [PK]" : f.filterable ? " [Filterable]" : f.searchable ? " [Searchable]" : ""}`
      ).join("\n"),
      ``,
      `## Relations (${moduleData.relations.length})`,
      moduleData.relations.map((r: any) => 
        `- ${r.name}: ${r.cardinality} → ${r.targetEntity}`
      ).join("\n"),
      ``,
      `## API Routes (${moduleData.apiRoutes.length})`,
      moduleData.apiRoutes.map((r: any) => 
        `- ${r.method} ${r.path}`
      ).join("\n"),
      ``,
      `## Workflows (${moduleData.workflows.length})`,
      moduleData.workflows.map((w: any) => 
        `- ${w.name}: ${w.description}`
      ).join("\n")
    ]

    return parts.join("\n")
  }

  /**
   * Save module spec to file
   */
  async saveModuleSpec(spec: ModuleSpec): Promise<string> {
    const specsDir = path.join(this.projectRoot, "specs")
    await fs.mkdir(specsDir, { recursive: true })

    const filename = `${spec.name.toLowerCase()}-spec.json`
    const filepath = path.join(specsDir, filename)
    
    await fs.writeFile(
      filepath,
      JSON.stringify(spec, null, 2),
      "utf-8"
    )

    console.log(`💾 Saved spec to: ${filepath}`)
    return filepath
  }

  /**
   * Generate HTML report for human consumption
   */
  async generateHTMLReport(spec: ModuleSpec): Promise<string> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>${spec.name} Module Specification</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .section { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        .field { margin: 5px 0; padding: 8px; background: #f5f5f5; border-radius: 4px; }
        .relation { margin: 10px 0; padding: 10px; background: #e8f4fd; border-left: 4px solid #2196f3; }
        .process { margin: 15px 0; padding: 15px; background: #f0f9ff; border-radius: 6px; }
        .kpi { background: #ffeaa7; padding: 4px 8px; border-radius: 4px; margin: 5px 0; display: inline-block; }
    </style>
</head>
<body>
    <h1>${spec.name} Module Specification</h1>
    
    <div class="section">
        <h2>📋 Overview</h2>
        <p><strong>Description:</strong> ${spec.description}</p>
        <p><strong>Entity:</strong> ${spec.entityName}</p>
        <p><strong>Table:</strong> ${spec.tableName}</p>
    </div>

    <div class="section">
        <h2>🔧 Data Model</h2>
        <h3>Fields (${spec.fields.length})</h3>
        ${spec.fields.map(f => `
            <div class="field">
                <strong>${f.name}</strong>: ${f.type}
                ${f.nullable ? " (Optional)" : " (Required)"}
                ${f.primaryKey ? " 🔑" : ""}
                ${f.enumValues ? `<br><em>Values: ${f.enumValues.join(", ")}</em>` : ""}
            </div>
        `).join("")}
    </div>

    <div class="section">
        <h2>🔗 Relations</h2>
        ${spec.relations.map(r => `
            <div class="relation">
                <strong>${r.name}</strong>: ${r.cardinality} → ${r.targetEntity}
            </div>
        `).join("")}
    </div>

    <div class="section">
        <h2>🌐 API Routes</h2>
        ${spec.apiRoutes.map(r => `
            <div class="field">
                <strong>${r.method}</strong> ${r.path}
                ${r.requiresAuth ? " 🔒" : ""}
            </div>
        `).join("")}
    </div>

    <div class="section">
        <h2>⚙️ Workflows</h2>
        ${spec.workflows.map(w => `
            <div class="process">
                <strong>${w.name}</strong><br>
                <em>${w.description}</em>
            </div>
        `).join("")}
    </div>

    <div class="section">
        <h2>💼 Business Processes</h2>
        ${spec.businessProcesses.map(p => `
            <div class="process">
                <h3>${p.name}</h3>
                <p>${p.description}</p>
                <strong>Steps:</strong>
                <ol>
                    ${p.steps.map(s => `
                        <li>
                            <strong>${s.name}</strong><br>
                            ${s.description}<br>
                            <em>Time: ${s.estimatedTime || "Varies"}</em>
                        </li>
                    `).join("")}
                </ol>
                <strong>Related Modules:</strong> ${p.relatedModules.join(", ")}<br>
                <strong>KPIs:</strong> ${p.kpis.map(k => `<span class="kpi">${k}</span>`).join(" ")}
            </div>
        `).join("")}
    </div>
</body>
</html>
    `.trim()

    const reportsDir = path.join(this.projectRoot, "specs", "reports")
    await fs.mkdir(reportsDir, { recursive: true })
    
    const reportFile = path.join(reportsDir, `${spec.name.toLowerCase()}-report.html`)
    await fs.writeFile(reportFile, html, "utf-8")
    
    return reportFile
  }

  /**
   * Helper methods
   */
  private async fileExists(filepath: string): Promise<boolean> {
    try {
      await fs.access(filepath)
      return true
    } catch {
      return false
    }
  }

  private async directoryExists(dirpath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirpath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  private toPascalCase(str: string): string {
    return str.replace(/(^|_)([a-z])/g, (_, __, char) => char.toUpperCase())
  }

  private mapFieldType(type: string): string {
    const typeMap: Record<string, string> = {
      "id": "string",
      "text": "string", 
      "number": "number",
      "boolean": "boolean",
      "dateTime": "Date",
      "enum": "enum"
    }
    return typeMap[type] || "unknown"
  }

  private inferCardinality(relationType: string): RelationInfo["cardinality"] {
    if (relationType === "hasOne") return "one-to-one"
    if (relationType === "hasMany") return "one-to-many"
    if (relationType === "belongsTo") return "many-to-one"
    if (relationType === "manyToMany") return "many-to-many"
    return "one-to-one" // fallback
  }

  private extractRoutePath(filePath: string, projectRoot: string): string {
    const relativePath = path.relative(projectRoot, filePath)
    const apiPart = relativePath.split("api/admin/")[1]
    if (!apiPart) return ""
    
    return "/" + apiPart
      .replace("/route.ts", "")
      .replace(/\[(\w+)\]/g, ":$1")
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.log(`
🔍 Module Spec Generator

Usage:
  node generate-module-specs.js <module-name>
  node generate-module-specs.js all

Examples:
  node generate-module-specs.js partner
  node generate-module-specs.js design
  node generate-module-specs.js all

This tool generates comprehensive specifications for custom modules including:
- Structured data model analysis
- API route documentation  
- Workflow identification
- Business process generation using LLM
- HTML reports for human consumption

Outputs saved to: specs/ directory
    `.trim())
    process.exit(1)
  }

  const generator = new ModuleSpecGenerator()
  const moduleName = args[0]

  if (moduleName === "all") {
    // Generate for all custom modules
    const modulesDir = path.join(process.cwd(), "src/modules")
    const modules = await fs.readdir(modulesDir)
    
    console.log(`🚀 Generating specs for all modules...`)
    for (const module of modules) {
      try {
        const spec = await generator.generateModuleSpec(module)
        await generator.saveModuleSpec(spec)
        await generator.generateHTMLReport(spec)
      } catch (error) {
        console.error(`❌ Failed to generate spec for ${module}:`, error)
      }
    }
    
    console.log("✅ All module specs generated successfully!")
    console.log("📂 Check specs/ directory for JSON files")
    console.log("📊 Check specs/reports/ directory for HTML reports")
    
  } else {
    // Generate for specific module
    console.log(`🚀 Generating spec for: ${moduleName}`)
    const spec = await generator.generateModuleSpec(moduleName)
    await generator.saveModuleSpec(spec)
    await generator.generateHTMLReport(spec)
    
    console.log("✅ Module spec generated successfully!")
    console.log(`📂 JSON: specs/${moduleName.toLowerCase()}-spec.json`)
    console.log(`📊 Report: specs/reports/${moduleName.toLowerCase()}-report.html`)
  }
}

if (require.main === module) {
  main().catch(console.error)
}