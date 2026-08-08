import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config.js";

// Template resource: a static/computed resource exposed to the client.
// Swap this for something dynamic (a file, a cached API response, etc.)
// as the server's real use case takes shape.
export function registerExampleResource(server: McpServer): void {
  server.registerResource(
    "server-info",
    "config://server-info",
    {
      title: "Server info",
      description: "Basic runtime info about this MCP server instance",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              name: config.serverName,
              version: config.serverVersion,
              addressLodBaseUrl: config.addressLod.baseUrl,
            },
            null,
            2
          ),
        },
      ],
    })
  );
}
