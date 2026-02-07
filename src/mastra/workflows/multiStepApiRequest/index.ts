// @ts-nocheck
/**
 * Multi-Step API Request Workflow with Human-in-the-Loop
 * 
 * Handles complex API requests that require disambiguation or ID resolution.
 * 
 * Example: "Show me analytics for cicilabel.com"
 * 1. Detects that request needs website ID but has domain name
 * 2. Queries websites by domain
 * 3. Presents options to user (SUSPEND)
 * 4. Waits for user confirmation
 * 5. Executes final API with confirmed ID (RESUME)
 */

import { createWorkflow, createStep } from "@mastra/core/workflows"
import { z } from "@medusajs/framework/zod"

// Input/Output schemas
export const MultiStepApiRequestInput = z.object({
    message: z.string(),
    threadId: z.string().optional(),
    context: z.record(z.any()).optional(),
})

export const MultiStepApiRequestOutput = z.object({
    result: z.any().optional(),
    meta: z.record(z.any()).optional(),
    needsDisambiguation: z.boolean(),
    suspended: z.boolean().optional(),
    error: z.string().optional(),
})

// Helper to get backend URL
function getBackendUrl(): string {
    return process.env.MEDUSA_BACKEND_URL || process.env.URL || "http://localhost:9000"
}

// Step 1: Detect if request needs multi-step handling (GENERAL-PURPOSE)
const detectMultiStepIntent = createStep({
    id: "detect-multi-step",
    inputSchema: z.object({
        message: z.string(),
        context: z.record(z.any()).optional(),
    }),
    outputSchema: z.object({
        needsDisambiguation: z.boolean(),
        intent: z.enum(["list", "search", "detail"]).optional(), // NEW: Intent type
        resource: z.string().optional(),
        identifier: z.string().optional(),
        targetEndpoint: z.string().optional(),
        targetMethod: z.string().optional(),
        searchField: z.string().optional(),
        linkQueryKey: z.string().optional(),
        context: z.record(z.any()).optional(),
    }),
    execute: async ({ inputData }) => {
        const message = inputData.message

        const normalizeIdentifier = (raw: string): string => {
            let s = String(raw || "").trim()
            // strip surrounding quotes
            s = s.replace(/^['"`]+|['"`]+$/g, "").trim()
            // common prefixes users type
            s = s
                .replace(/^customer\s+name\s*[:=-]?\s*/i, "")
                .replace(/^customer\s+(?:named|called)\s+/i, "")
                .replace(/^customer\s*[:=-]?\s*/i, "")
                .replace(/^client\s*[:=-]?\s*/i, "")
                .replace(/^name\b\s*[:=-]?\s*/i, "")
                .replace(/^email\b\s*[:=-]?\s*/i, "")
                .trim()
            // remove accidental trailing punctuation
            s = s.replace(/[\s,;:.]+$/g, "").trim()
            return s
        }

        try {
            console.log("[multiStep] detect start", { message: String(message || "").slice(0, 240) })
        } catch { }

        // Orders by customer name (HITL-friendly): supports phrases like
        // "orders for Sarah", "fetch all the orders for Saransh Sharma", "get orders of sarah"
        const msgLower = String(message || "").toLowerCase()
        if (msgLower.includes("order")) {
            const m = message.match(/\borders?\b[\s\S]*\b(?:for|of)\b\s+(.+?)\s*$/i)
            const identifier = normalizeIdentifier(String(m?.[1] || ""))
            if (identifier) {
                const out = {
                    needsDisambiguation: true,
                    intent: "detail",
                    resource: "customers",
                    identifier,
                    targetEndpoint: "/admin/orders",
                    targetMethod: "GET",
                    searchField: "email",
                    linkQueryKey: "customer_id",
                    context: inputData.context,
                }
                try {
                    console.log("[multiStep] detect end", {
                        needsDisambiguation: out.needsDisambiguation,
                        resource: out.resource,
                        identifier: out.identifier,
                        targetEndpoint: out.targetEndpoint,
                        linkQueryKey: out.linkQueryKey,
                    })
                } catch { }
                return out
            }
        }

        // Quick check: if message contains an ID pattern, skip disambiguation
        if (/\b0[0-9A-Z]{4,}\b/.test(message)) {
            const out = { needsDisambiguation: false }
            try {
                console.log("[multiStep] detect end", out)
            } catch { }
            return out
        }

        // NEW: List intent patterns - "show me all X", "list X", "get all X"
        const listPatterns = [
            /(?:show|list|get|fetch|display)\s+(?:me\s+)?(?:all|my)?\s*(.+?)s?$/i,
            /(?:what|which)\s+(.+?)s?\s+(?:do i have|are there|exist)/i,
            /(?:view|see)\s+(?:all|my)?\s*(.+?)s?$/i,
        ]

        for (const pattern of listPatterns) {
            const match = message.match(pattern)
            if (match) {
                const resourceName = match[1].trim()
                const detectedResource = detectResourceFromName(resourceName)

                if (detectedResource) {
                    return {
                        needsDisambiguation: true,
                        intent: "list",
                        resource: detectedResource,
                        identifier: "", // No specific identifier for list
                        targetEndpoint: `/admin/${detectedResource}`,
                        targetMethod: "GET",
                        searchField: getSearchField(detectedResource),
                        context: inputData.context,
                    }
                }
            }
        }

        // Search intent patterns - "find X named Y", "get X called Y"
        const searchPattern = /(find|search|get|show)\s+(.+?)\s+(?:named|called|with|matching)\s+(.+?)$/i
        const searchMatch = message.match(searchPattern)

        if (searchMatch) {
            const resourceName = searchMatch[2].trim()
            const identifier = searchMatch[3].trim()
            const detectedResource = detectResourceFromName(resourceName)

            if (detectedResource) {
                return {
                    needsDisambiguation: true,
                    intent: "search",
                    resource: detectedResource,
                    identifier,
                    targetEndpoint: `/admin/${detectedResource}`,
                    targetMethod: "GET",
                    searchField: getSearchField(detectedResource),
                    context: inputData.context,
                }
            }
        }

        // Detail intent patterns - "analytics for X", "orders for X"
        const actionPattern = /(analytics|orders|details?|info(?:rmation)?|data) (?:for|of|from) (.+?)(?:\s+(?:website|customer|person|product|design))?$/i
        const actionMatch = message.match(actionPattern)

        if (actionMatch) {
            const identifier = actionMatch[2].trim()
            const action = actionMatch[1].toLowerCase()

            // Detect resource from context
            const detectedResource = detectResourceFromContext(message)

            if (detectedResource) {
                let targetEndpoint = `/admin/${detectedResource}/{id}`

                // Add sub-resource based on action
                if (action === "analytics") {
                    targetEndpoint = `/admin/${detectedResource}/{id}/analytics`
                } else if (action === "orders") {
                    targetEndpoint = `/admin/${detectedResource}/{id}/orders`
                }

                return {
                    needsDisambiguation: true,
                    intent: "detail",
                    resource: detectedResource,
                    identifier,
                    targetEndpoint,
                    targetMethod: "GET",
                    searchField: getSearchField(detectedResource),
                    context: inputData.context,
                }
            }
        }

        const out = { needsDisambiguation: false }
        try {
            console.log("[multiStep] detect end", out)
        } catch { }
        return out
    }
})

// Helper: Detect resource from name
function detectResourceFromName(name: string): string | undefined {
    const normalized = name.toLowerCase().replace(/s$/, "") // Remove trailing 's'

    const resourceMap: Record<string, string> = {
        website: "websites",
        site: "websites",
        domain: "websites",
        customer: "customers",
        client: "customers",
        person: "persons",
        people: "persons",
        contact: "persons",
        product: "products",
        item: "products",
        design: "designs",
        pattern: "designs",
        template: "designs",
        order: "orders",
        inventory: "inventory-items",
        stock: "inventory-items",
    }

    return resourceMap[normalized]
}

// Helper: Detect resource from context
function detectResourceFromContext(message: string): string | undefined {
    const msg = message.toLowerCase()

    if (msg.includes("website") || msg.includes("site") || msg.includes("domain")) return "websites"
    if (msg.includes("customer") || msg.includes("client")) return "customers"
    if (msg.includes("person") || msg.includes("people")) return "persons"
    if (msg.includes("product") || msg.includes("item")) return "products"
    if (msg.includes("design") || msg.includes("pattern")) return "designs"
    if (msg.includes("order")) return "orders"
    if (msg.includes("inventory") || msg.includes("stock")) return "inventory-items"

    return undefined
}

// Helper: Get search field for resource
function getSearchField(resource: string): string {
    const fieldMap: Record<string, string> = {
        websites: "domain",
        customers: "email",
        persons: "name",
        products: "title",
        designs: "name",
        orders: "display_id",
        "inventory-items": "sku",
    }

    return fieldMap[resource] || "name"
}


// Step 2: Query for matches (GENERAL-PURPOSE)
const queryForMatches = createStep({
    id: "query-matches",
    inputSchema: z.object({
        needsDisambiguation: z.boolean().optional(),
        resource: z.string(),
        identifier: z.string(),
        searchField: z.string().optional(),
        intent: z.enum(["list", "search", "detail"]).optional(),
        context: z.record(z.any()).optional(),
    }),
    outputSchema: z.object({
        matches: z.array(z.object({
            id: z.string(),
            display: z.string(),
            metadata: z.record(z.any()),
        })),
        totalCount: z.number().optional(),
    }),
    execute: async ({ inputData }) => {
        const { needsDisambiguation, resource, identifier, searchField, intent } = inputData

        if (needsDisambiguation === false) {
            return { matches: [], totalCount: 0 }
        }

        // Map resource to API endpoint and display field
        const resourceConfig: Record<string, { endpoint: string; displayField: string }> = {
            websites: { endpoint: "/admin/websites", displayField: "domain" },
            customers: { endpoint: "/admin/customers", displayField: "email" },
            persons: { endpoint: "/admin/persons", displayField: "name" },
            products: { endpoint: "/admin/products", displayField: "title" },
            designs: { endpoint: "/admin/designs", displayField: "name" },
            orders: { endpoint: "/admin/orders", displayField: "display_id" },
            inventory: { endpoint: "/admin/inventory-items", displayField: "sku" },
        }

        const config = resourceConfig[resource]
        if (!config) {
            console.warn(`[multiStep] Unknown resource: ${resource}`)
            return { matches: [], totalCount: 0 }
        }

        try {
            // Build query URL
            let url = `${getBackendUrl()}${config.endpoint}`

            // For list intent, just add limit
            if (intent === "list") {
                url += `?limit=5`
            } else {
                // For search/detail, add search query
                url += `?q=${encodeURIComponent(identifier)}`
            }

            console.log(`[multiStep] Querying (${intent}): ${url}`)

            const authHeaders = ((inputData as any)?.context as any)?.auth_headers || {}
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            }
            if (authHeaders?.authorization) headers["Authorization"] = String(authHeaders.authorization)
            if (authHeaders?.cookie) headers["Cookie"] = String(authHeaders.cookie)

            const response = await fetch(url, { headers })

            if (!response.ok) {
                console.warn(`[multiStep] Query failed: ${response.status}`)
                return { matches: [], totalCount: 0 }
            }

            const data = await response.json()
            const items = data[resource] || data.data || []
            const totalCount = data.count || items.length

            // Use searchField if provided, otherwise use default displayField
            const displayField = searchField || config.displayField

            // Format matches for display
            const matches = items.slice(0, 5).map((item: any) => ({
                id: item.id,
                display: item[displayField] || item.name || item.title || item.email || item.id,
                metadata: item,
            }))

            console.log(`[multiStep] Found ${matches.length} matches (total: ${totalCount})`)
            return { matches, totalCount }
        } catch (error) {
            console.error(`[multiStep] Query error:`, error)
            return { matches: [], totalCount: 0 }
        }
    }
})

// Step 3: Confirm selection (HITL - Human-in-the-Loop)
const confirmSelection = createStep({
    id: "confirm-selection",
    inputSchema: z.object({
        needsDisambiguation: z.boolean().optional(),
        matches: z.array(z.object({
            id: z.string(),
            display: z.string(),
            metadata: z.record(z.any()),
        })),
        resource: z.string(),
        intent: z.enum(["list", "search", "detail"]).optional(),
        totalCount: z.number().optional(),
    }),
    outputSchema: z.object({
        selectedId: z.string(),
        action: z.string().optional(), // "view-all" or "select"
        selectedDisplay: z.string().optional(),
        selectedMetadata: z.record(z.any()).optional(),
        context: z.record(z.any()).optional(),
    }),
    resumeSchema: z.object({
        selectedId: z.string(),
        confirmed: z.boolean(),
        action: z.string().optional(),
        selectedDisplay: z.string().optional(),
        selectedMetadata: z.record(z.any()).optional(),
        context: z.record(z.any()).optional(),
    }),
    suspendSchema: z.object({
        reason: z.string(),
        options: z.array(z.object({
            id: z.string(),
            display: z.string(),
        })),
        actions: z.array(z.object({
            id: z.string(),
            label: z.string(),
        })).optional(),
        totalCount: z.number().optional(),
    }),
    execute: async ({ inputData, resumeData, suspend }) => {
        const { needsDisambiguation, matches, resource, intent, totalCount } = inputData

        if (needsDisambiguation === false) {
            return { selectedId: "" }
        }

        // If already confirmed via resume, return selected ID
        if (resumeData?.confirmed) {
            const found = matches.find((m) => m.id === resumeData.selectedId)
            return {
                selectedId: resumeData.selectedId,
                action: resumeData.action,
                selectedDisplay: resumeData.selectedDisplay || found?.display,
                selectedMetadata: resumeData.selectedMetadata || found?.metadata,
                context: (resumeData as any)?.context,
            }
        }

        // If no matches found, return empty selection (caller can surface error)
        if (matches.length === 0) {
            return { selectedId: "" }
        }

        // If exactly one match and not a list intent, auto-confirm
        if (matches.length === 1 && intent !== "list") {
            console.log(`[multiStep] Auto-confirming single match: ${matches[0].display}`)
            return {
                selectedId: matches[0].id,
                selectedDisplay: matches[0].display,
                selectedMetadata: matches[0].metadata,
            }
        }

        // Multiple matches or list intent - suspend and ask user to select
        console.log(`[multiStep] Suspending for user selection (${matches.length} matches, intent: ${intent})`)

        // Build reason message
        const resourceLabel = resource || "items"
        let reason = ""
        if (intent === "list") {
            reason = totalCount && totalCount > matches.length
                ? `Showing ${matches.length} of ${totalCount} ${resourceLabel}. Select one to view details:`
                : `Found ${matches.length} ${resourceLabel}. Select one to view details:`
        } else {
            reason = `Found ${matches.length} ${resourceLabel}. Please select one:`
        }

        // Build actions for list intent
        const actions = intent === "list" && totalCount && totalCount > matches.length
            ? [{ id: "view-all", label: `View all ${totalCount} ${resourceLabel}` }]
            : undefined

        return await suspend({
            reason,
            options: matches.map(m => ({ id: m.id, display: m.display })),
            actions,
            totalCount,
        })
    }
})

// Step 4: Execute final API call
const executeFinalApi = createStep({
    id: "execute-final-api",
    inputSchema: z.object({
        needsDisambiguation: z.boolean().optional(),
        targetEndpoint: z.string(),
        targetMethod: z.string(),
        selectedId: z.string(),
        linkQueryKey: z.string().optional(),
        context: z.record(z.any()).optional(),
        selectedDisplay: z.string().optional(),
        selectedMetadata: z.record(z.any()).optional(),
    }),
    outputSchema: z.object({
        needsDisambiguation: z.boolean().optional(),
        result: z.any().optional(),
        meta: z.record(z.any()).optional(),
        error: z.string().optional(),
    }),
    execute: async ({ inputData }) => {
        let targetEndpoint = (inputData as any)?.targetEndpoint
        const targetMethod = String((inputData as any)?.targetMethod || "GET")
        const selectedId = String((inputData as any)?.selectedId || "")
        let linkQueryKey = (inputData as any)?.linkQueryKey

        if (inputData.needsDisambiguation === false) {
            return { needsDisambiguation: false, result: undefined }
        }

        // Fallback inference (HITL customer -> orders) if detect output wasn't available during resume.
        if ((!targetEndpoint || typeof targetEndpoint !== "string" || targetEndpoint.trim() === "") && /^cus_/.test(selectedId)) {
            targetEndpoint = "/admin/orders"
            if (!linkQueryKey) linkQueryKey = "customer_id"
        }

        if (!targetEndpoint || typeof targetEndpoint !== "string") {
            return {
                needsDisambiguation: true,
                result: undefined,
                meta: {
                    selectedId,
                    selectedDisplay: inputData.selectedDisplay,
                    selectedMetadata: inputData.selectedMetadata,
                    targetEndpoint,
                    targetMethod,
                    linkQueryKey,
                },
                error: "Missing target endpoint",
            }
        }

        if (!selectedId) {
            return {
                needsDisambiguation: true,
                result: undefined,
                meta: {
                    selectedId,
                    selectedDisplay: inputData.selectedDisplay,
                    selectedMetadata: inputData.selectedMetadata,
                    targetEndpoint,
                    targetMethod,
                    linkQueryKey,
                },
                error: "No matches found",
            }
        }

        // Replace {id} placeholder with actual ID (if present)
        const finalPath = targetEndpoint.includes("{id}")
            ? targetEndpoint.replace("{id}", selectedId)
            : targetEndpoint
        const urlObj = new URL(`${getBackendUrl()}${finalPath}`)

        // If this step was triggered by a selection meant to become a query param (e.g. customer_id)
        if (linkQueryKey && targetMethod.toUpperCase() === "GET") {
            urlObj.searchParams.set(String(linkQueryKey), String(selectedId))
        }
        const url = urlObj.toString()

        try {
            console.log(`[multiStep] Executing final API: ${targetMethod} ${finalPath}`)

            const authHeaders = ((inputData as any)?.context as any)?.auth_headers || {}
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            }
            if (authHeaders?.authorization) headers["Authorization"] = String(authHeaders.authorization)
            if (authHeaders?.cookie) headers["Cookie"] = String(authHeaders.cookie)

            const response = await fetch(url, {
                method: targetMethod,
                headers,
            })

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`)
            }

            const result = await response.json()
            return {
                needsDisambiguation: true,
                result,
                meta: {
                    selectedId,
                    selectedDisplay: inputData.selectedDisplay,
                    selectedMetadata: inputData.selectedMetadata,
                    targetEndpoint,
                    targetMethod,
                    linkQueryKey,
                },
            }
        } catch (error) {
            console.error(`[multiStep] Execution error:`, error)
            throw error
        }
    }
})

const finalizeOutput = createStep({
    id: "finalize-output",
    inputSchema: z.object({
        needsDisambiguation: z.boolean(),
        result: z.any().optional(),
        meta: z.record(z.any()).optional(),
        error: z.string().optional(),
    }),
    outputSchema: MultiStepApiRequestOutput,
    execute: async ({ inputData }) => {
        return {
            needsDisambiguation: inputData.needsDisambiguation,
            result: inputData.result,
            meta: inputData.meta,
            error: inputData.error,
        }
    },
})

const unwrapStepOutput = (val: any) => (val as any)?.output ?? val

// Compose workflow with conditional branching
export const multiStepApiRequestWorkflow = createWorkflow({
    id: "multi-step-api-request",
    inputSchema: MultiStepApiRequestInput,
    outputSchema: MultiStepApiRequestOutput,
})
    .then(detectMultiStepIntent, {
        message: ({ inputData }) => inputData.message,
        context: ({ inputData }) => (inputData as any).context,
    })
    .then(queryForMatches, {
        needsDisambiguation: ({ ["detect-multi-step"]: detect }: any) => unwrapStepOutput(detect)?.needsDisambiguation,
        resource: ({ ["detect-multi-step"]: detect }: any) => String(unwrapStepOutput(detect)?.resource || ""),
        identifier: ({ ["detect-multi-step"]: detect }: any) => String(unwrapStepOutput(detect)?.identifier || ""),
        searchField: ({ ["detect-multi-step"]: detect }: any) => unwrapStepOutput(detect)?.searchField,
        intent: ({ ["detect-multi-step"]: detect }: any) => unwrapStepOutput(detect)?.intent,
        context: ({ inputData, ["detect-multi-step"]: detect }: any) =>
            unwrapStepOutput(detect as any)?.context ?? (inputData as any)?.context,
    })
    .then(confirmSelection, {
        needsDisambiguation: ({ ["detect-multi-step"]: detect }: any) => unwrapStepOutput(detect)?.needsDisambiguation,
        matches: ({ ["query-matches"]: q }: any) => unwrapStepOutput(q)?.matches,
        resource: ({ ["detect-multi-step"]: detect }: any) => String(unwrapStepOutput(detect)?.resource || ""),
        intent: ({ ["detect-multi-step"]: detect }: any) => unwrapStepOutput(detect)?.intent,
        totalCount: ({ ["query-matches"]: q }: any) => unwrapStepOutput(q)?.totalCount,
    })
    .then(executeFinalApi, {
        needsDisambiguation: ({ ["detect-multi-step"]: detect }: any) => unwrapStepOutput(detect)?.needsDisambiguation,
        targetEndpoint: ({ ["detect-multi-step"]: detect }: any) => String(unwrapStepOutput(detect)?.targetEndpoint || ""),
        targetMethod: ({ ["detect-multi-step"]: detect }: any) => String(unwrapStepOutput(detect)?.targetMethod || "GET"),
        selectedId: ({ ["confirm-selection"]: c }: any) => String(unwrapStepOutput(c)?.selectedId || ""),
        linkQueryKey: ({ ["detect-multi-step"]: detect }: any) => unwrapStepOutput(detect as any)?.linkQueryKey,
        context: ({ inputData, ["detect-multi-step"]: detect, ["confirm-selection"]: c }: any) =>
            unwrapStepOutput(c as any)?.context ?? unwrapStepOutput(detect as any)?.context ?? (inputData as any)?.context,
        selectedDisplay: ({ ["confirm-selection"]: c }: any) => unwrapStepOutput(c as any)?.selectedDisplay,
        selectedMetadata: ({ ["confirm-selection"]: c }: any) => unwrapStepOutput(c as any)?.selectedMetadata,
    })
    .then(finalizeOutput, {
        needsDisambiguation: ({ ["detect-multi-step"]: detect }: any) => Boolean(unwrapStepOutput(detect)?.needsDisambiguation),
        result: ({ ["execute-final-api"]: ex }: any) => unwrapStepOutput(ex as any)?.result,
        meta: ({ ["execute-final-api"]: ex }: any) => unwrapStepOutput(ex as any)?.meta,
        error: ({ ["execute-final-api"]: ex }: any) => unwrapStepOutput(ex as any)?.error,
    })
    .commit()
