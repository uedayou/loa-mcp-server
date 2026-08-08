import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchAddressTool } from "./searchAddress.js";
import { registerGetAddressLocationTool } from "./getAddressLocation.js";
import { registerGetAddressLocationsTool } from "./getAddressLocations.js";
import { registerListChildAddressesTool } from "./listChildAddresses.js";
import { registerListBanchiTool } from "./listBanchi.js";
import { registerReverseGeocodeAddressTool } from "./reverseGeocodeAddress.js";
import { registerListPrefecturesTool } from "./listPrefectures.js";
import { registerSaveAddressLocationsToFileTool } from "./saveAddressLocationsToFile.js";

// Add new tool registrations here as the server grows.
export function registerAllTools(server: McpServer): void {
  registerSearchAddressTool(server);
  registerGetAddressLocationTool(server);
  registerGetAddressLocationsTool(server);
  registerListChildAddressesTool(server);
  registerListBanchiTool(server);
  registerReverseGeocodeAddressTool(server);
  registerListPrefecturesTool(server);
  registerSaveAddressLocationsToFileTool(server);
}
