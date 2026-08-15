import { MedusaService } from "@medusajs/framework/utils"
import McpAccessScope from "./models/mcp-access-scope"

/**
 * Per-token MCP scopes (#1306 Track C). See the model for the ladder and why a
 * row can only ever restrict.
 */
class McpAccessService extends MedusaService({
  McpAccessScope,
}) {
  /**
   * The scope row for one principal, or null. Called on every admin write by a
   * machine principal and on every MCP request, so it stays a single indexed
   * lookup on the unique (principal_type, principal_id) pair.
   */
  async getScope(
    principalType: string,
    principalId: string
  ): Promise<any | null> {
    const rows = await this.listMcpAccessScopes({
      principal_type: principalType,
      principal_id: principalId,
    })
    return rows?.[0] ?? null
  }

  /**
   * Create or replace the single row for a principal. Idempotent per principal
   * — re-scoping a credential is one call, not delete-then-create, so there is
   * no window in which it briefly has the process ceiling instead.
   */
  async setScope(input: {
    principal_type: string
    principal_id: string
    level: string
    label?: string | null
    note?: string | null
  }): Promise<any> {
    const existing = await this.getScope(
      input.principal_type,
      input.principal_id
    )

    if (existing) {
      const [updated] = await this.updateMcpAccessScopes([
        {
          id: existing.id,
          level: input.level,
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      ])
      return updated
    }

    const [created] = await this.createMcpAccessScopes([
      {
        principal_type: input.principal_type,
        principal_id: input.principal_id,
        level: input.level,
        label: input.label ?? null,
        note: input.note ?? null,
      },
    ])
    return created
  }
}

export default McpAccessService
