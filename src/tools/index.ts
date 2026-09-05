import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../core/profile.js";
import { registerSearchAddressTool } from "./searchAddress.js";
import { registerGetAddressLocationTool } from "./getAddressLocation.js";
import { registerGetAddressLocationsTool } from "./getAddressLocations.js";
import { registerListChildAddressesTool } from "./listChildAddresses.js";
import { registerListBanchiTool } from "./listBanchi.js";
import { registerReverseGeocodeAddressTool } from "./reverseGeocodeAddress.js";
import { registerListPrefecturesTool } from "./listPrefectures.js";
import { registerSaveAddressLocationsToFileTool } from "./saveAddressLocationsToFile.js";
import { registerGetAddressAreasTool } from "./getAddressAreas.js";

// capabilities に応じて登録する Tool を決める(design §6)。
// フェーズ3の途中: 各 registerXxxTool はまだ profile 引数を取らず、name/description を
// 自前で持っている。以降のコミットで profile.toolText 駆動に順次書き換える。
// search / reverse_geocode は最終的に profiles/loa/tools/ へ移す(ownedTools)。
export function registerAllTools(server: McpServer, profile: DatasetProfile): void {
  const c = profile.capabilities;

  if (c.dereferenceGeometry) registerGetAddressLocationTool(server, profile);
  if (c.dereferenceGeometry && c.batch) {
    registerGetAddressLocationsTool(server, profile);
    registerSaveAddressLocationsToFileTool(server, profile);
  }
  if (c.hierarchy) registerListChildAddressesTool(server, profile);
  if (c.subParts) registerListBanchiTool(server, profile);
  if (c.area) registerGetAddressAreasTool(server, profile);

  // staticLists(loa は list_prefectures のみ)。registerListPrefecturesTool が
  // profile.staticLists をループして登録する。
  if ((profile.staticLists ?? []).length > 0) registerListPrefecturesTool(server, profile);

  // プロファイル所有 Tool。フェーズ3で profiles/loa/tools/ へ移設して
  // profile.ownedTools.search / .geohashNearby 経由にする。
  if (c.search) {
    if (profile.ownedTools?.search) profile.ownedTools.search(server, profile);
    else registerSearchAddressTool(server, profile);
  }
  if (c.geohashNearby) {
    if (profile.ownedTools?.geohashNearby) profile.ownedTools.geohashNearby(server, profile);
    else registerReverseGeocodeAddressTool(server, profile);
  }
  for (const register of profile.ownedTools?.extra ?? []) register(server, profile);
}
