import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loaProfile } from "./index.js";
import { registerSearchAddressTool } from "./tools/searchAddress.js";
import { registerGetAddressLocationTool } from "./tools/getAddressLocation.js";
import { registerGetAddressLocationsTool } from "./tools/getAddressLocations.js";
import { registerListChildAddressesTool } from "./tools/listChildAddresses.js";
import { registerListBanchiTool } from "./tools/listBanchi.js";
import { registerReverseGeocodeAddressTool } from "./tools/reverseGeocodeAddress.js";
import { registerListPrefecturesTool } from "./tools/listPrefectures.js";
import { registerSaveAddressLocationsToFileTool } from "./tools/saveAddressLocationsToFile.js";
import { registerGetAddressAreasTool } from "./tools/getAddressAreas.js";

// このリポジトリのプロファイルは loa 1つだけなので、capability 分岐はせず
// 住所LOD が持つ Tool をそのままフラットに列挙する(design-tools-layer-generalization.md §3)。
// フォーク先は profiles/<id>/registerTools.ts に自分の Tool 列を書く。
export function registerLoaTools(server: McpServer): void {
  registerSearchAddressTool(server, loaProfile);
  registerGetAddressLocationTool(server, loaProfile);
  registerGetAddressLocationsTool(server, loaProfile);
  registerSaveAddressLocationsToFileTool(server, loaProfile);
  registerListChildAddressesTool(server, loaProfile);
  registerListBanchiTool(server, loaProfile);
  registerReverseGeocodeAddressTool(server, loaProfile);
  registerListPrefecturesTool(server, loaProfile);
  registerGetAddressAreasTool(server, loaProfile);
}
