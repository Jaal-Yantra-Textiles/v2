import { Module } from "@medusajs/framework/utils"
import McpOauthService from "./service"

export const MCP_OAUTH_MODULE = "mcp_oauth"

export default Module(MCP_OAUTH_MODULE, {
  service: McpOauthService,
})
