import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

// IMPORTANT: never write to stdout here — the stdio transport uses stdout
// exclusively for MCP protocol messages. Use console.error (stderr) for logs.
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("loa-mcp-server: connected via stdio");
}

main().catch((error) => {
  console.error("loa-mcp-server: fatal error", error);
  process.exit(1);
});
