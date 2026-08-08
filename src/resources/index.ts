import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExampleResource } from "./exampleResource.js";

// Add new resource registrations here as the server grows.
export function registerAllResources(server: McpServer): void {
  registerExampleResource(server);
}
