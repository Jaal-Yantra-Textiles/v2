// @ts-nocheck
/**
 * Tool Call Parser
 * 
 * Parses tool calls from LLM output using multiple strategies.
 * Supports JSON (fenced, plain, loose) and XML formats.
 */

export type ToolCall = {
    name: string
    arguments: Record<string, any>
}

export class ToolCallParser {
    /**
     * Parse tool calls from LLM output.
     * Tries multiple strategies in order of reliability:
     * 1. JSON fenced blocks (```json)
     * 2. Plain JSON
     * 3. Loose JSON (extract from text)
     * 4. XML format (<function=...>)
     */
    parse(text: string): ToolCall[] {
        return (
            this.tryJSONFenced(text) ||
            this.tryPlainJSON(text) ||
            this.tryLooseJSON(text) ||
            this.tryXML(text) ||
            []
        )
    }

    /**
     * Strategy 1: Parse JSON fenced blocks
     * Example: ```json\n{"toolCalls": [...]}\n```
     */
    private tryJSONFenced(text: string): ToolCall[] | null {
        const fenceMatch = text.match(/```json[\s\S]*?```/)
        if (!fenceMatch) return null

        const jsonStr = fenceMatch[0].replace(/```json|```/g, '').trim()
        try {
            const parsed = JSON.parse(jsonStr)
            if (parsed && Array.isArray(parsed.toolCalls)) {
                return parsed.toolCalls
            }
        } catch { }
        return null
    }

    /**
     * Strategy 2: Parse plain JSON
     * Example: {"toolCalls": [...]}
     */
    private tryPlainJSON(text: string): ToolCall[] | null {
        try {
            const parsed = JSON.parse(text)
            if (parsed && Array.isArray(parsed.toolCalls)) {
                return parsed.toolCalls
            }
        } catch { }
        return null
    }

    /**
     * Strategy 3: Parse loose JSON (extract from text)
     * Finds first { and last } and tries to parse
     */
    private tryLooseJSON(text: string): ToolCall[] | null {
        const idx = text.indexOf('{')
        if (idx === -1) return null

        const possible = text.slice(idx)
        const last = possible.lastIndexOf('}')
        const objStr = last !== -1 ? possible.slice(0, last + 1) : possible

        try {
            const parsed = JSON.parse(objStr)
            if (parsed && Array.isArray(parsed.toolCalls)) {
                return parsed.toolCalls
            }
        } catch { }
        return null
    }

    /**
     * Strategy 4: Parse XML format
     * Example: <function=admin_api_request><parameter=method>GET</parameter></function>
     */
    private tryXML(text: string): ToolCall[] | null {
        const functionRegex = /<function=([^>]+)>([\s\S]*?)<\/function>/g
        const calls: ToolCall[] = []
        let match

        while ((match = functionRegex.exec(text)) !== null) {
            const funcName = match[1]
            const content = match[2]
            const args: Record<string, any> = {}

            const paramRegex = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g
            let paramMatch
            while ((paramMatch = paramRegex.exec(content)) !== null) {
                args[paramMatch[1]] = paramMatch[2].trim()
            }

            calls.push({ name: funcName, arguments: args })
        }

        return calls.length > 0 ? calls : null
    }
}
