import { Module } from "@medusajs/framework/utils"
import McpAccessService from "./service"

export const MCP_ACCESS_MODULE = "mcp_access"

export default Module(MCP_ACCESS_MODULE, {
  service: McpAccessService,
})
