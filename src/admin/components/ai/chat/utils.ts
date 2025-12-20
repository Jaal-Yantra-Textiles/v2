export const stableStringify = (value: any): string => {
    try {
        const seen = new WeakSet()
        const sort = (v: any): any => {
            if (v === null || v === undefined) return v
            if (typeof v !== "object") return v
            if (seen.has(v)) return "[Circular]"
            seen.add(v)
            if (Array.isArray(v)) return v.map(sort)
            const out: Record<string, any> = {}
            for (const k of Object.keys(v).sort()) {
                out[k] = sort(v[k])
            }
            return out
        }
        return JSON.stringify(sort(value))
    } catch {
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }
}

/**
 * Safe JSON parser that handles Python-style dictionaries.
 * Converts single quotes to double quotes before parsing.
 * 
 * Examples:
 * - "{'key': 'value'}" -> {"key": "value"}
 * - "{'description': 'this is cicilabel website'}" -> {"description": "this is cicilabel website"}
 */
export const safeJSONParse = (jsonString: string, fallback: any = {}): any => {
    if (!jsonString || jsonString.trim() === '') return fallback

    try {
        // First try direct parse (for valid JSON)
        return JSON.parse(jsonString)
    } catch {
        try {
            // Sanitize Python-style dictionaries:
            // Replace single quotes with double quotes, but preserve quotes inside strings
            let sanitized = jsonString.trim()

            // Simple heuristic: replace ' with " but be careful with apostrophes in values
            // This handles common cases like {'key': 'value'}
            sanitized = sanitized
                .replace(/'/g, '"')  // Replace all single quotes with double quotes

            return JSON.parse(sanitized)
        } catch {
            // If still fails, return fallback
            console.warn('[safeJSONParse] Failed to parse:', jsonString)
            return fallback
        }
    }
}


export const summarizeDataHeuristic = (data: any): string => {
    try {
        if (data == null) return "No data to summarize."
        if (Array.isArray(data)) {
            const n = data.length
            const sample = data.slice(0, 3)
            const keys = sample[0] ? Object.keys(sample[0]).slice(0, 6) : []
            const preview = sample.map((it: any, i: number) => {
                const id = it?.id || it?._id || it?.sku || it?.title || it?.name || `#${i + 1}`
                return typeof id === "string" ? id : JSON.stringify(it).slice(0, 120)
            })
            return [
                `Items: ${n}`,
                keys.length ? `Top keys: ${keys.join(", ")}` : undefined,
                preview.length ? `Examples: ${preview.join(", ")}` : undefined,
            ].filter(Boolean).join("\n")
        }
        if (typeof data === "object") {
            const keys = Object.keys(data)
            const lines: string[] = []
            lines.push(`Object with ${keys.length} keys`)
            const top = keys.slice(0, 8)
            lines.push(`Top keys: ${top.join(", ")}`)
            for (const k of top) {
                const v = (data as any)[k]
                if (Array.isArray(v)) lines.push(`${k}: ${v.length} items`)
            }
            return lines.join("\n")
        }
        return String(data)
    } catch {
        return "(unable to summarize data)"
    }
}

export const uiMessageToText = (content: any): string => {
    if (typeof content === "string") return content
    if (content == null) return ""
    // Mastra uiMessages often come as array parts or structured objects
    if (Array.isArray(content)) {
        const parts = content
            .map((p) => {
                if (typeof p === "string") return p
                if (p && typeof p === "object") {
                    if (typeof (p as any).text === "string") return (p as any).text
                    if (typeof (p as any).content === "string") return (p as any).content
                }
                return ""
            })
            .filter(Boolean)
        if (parts.length) return parts.join("")
    }
    if (typeof content === "object") {
        if (typeof (content as any).text === "string") return (content as any).text
        if (typeof (content as any).content === "string") return (content as any).content
    }
    try {
        return JSON.stringify(content, null, 2)
    } catch {
        return String(content)
    }
}

export const formatApiRequest = (
    method: string,
    path: string,
    body?: any,
    query?: any
): { path: string; init: any } => {
    const upperMethod = method.toUpperCase()
    let finalPath = path
    const init: any = { method: upperMethod }

    // Append query parameters if provided
    if (query && Object.keys(query).length > 0) {
        const params = new URLSearchParams()
        for (const [k, v] of Object.entries(query)) {
            if (v === undefined || v === null) continue
            if (typeof v === "string" && !v.trim()) continue
            if (Array.isArray(v)) {
                for (const item of v) params.append(k, String(item))
            } else if (typeof v === "object") {
                params.set(k, JSON.stringify(v))
            } else {
                params.set(k, String(v))
            }
        }
        const qs = params.toString().replace(/\+/g, "%20")
        if (qs) finalPath = `${finalPath}${finalPath.includes("?") ? "&" : "?"}${qs}`
    }

    // Handle body for non-GET/DELETE requests
    if ((upperMethod === "POST" || upperMethod === "PUT" || upperMethod === "PATCH") && body) {
        init.body = body
    } else if ((upperMethod === "GET" || upperMethod === "DELETE") && body) {
        // If body is present for GET/DELETE, try to convert flat objects to query params (fallback compatibility)
        // but ideally, 'query' argument should be used.
        try {
            if (typeof body === "object" && !Array.isArray(body)) {
                const params = new URLSearchParams()
                for (const [k, v] of Object.entries(body)) {
                    if (v === undefined || v === null) continue
                    // Skip if key already in query
                    if (query && query[k] !== undefined) continue;

                    if (typeof v === "string" && !v.trim()) continue
                    if (Array.isArray(v)) {
                        for (const item of v) params.append(k, String(item))
                    } else if (typeof v === "object") {
                        params.set(k, JSON.stringify(v))
                    } else {
                        params.set(k, String(v))
                    }
                }
                const qs = params.toString().replace(/\+/g, "%20")
                if (qs) finalPath = `${finalPath}${finalPath.includes("?") ? "&" : "?"}${qs}`
            }
        } catch { }
    }

    return { path: finalPath, init }
}
