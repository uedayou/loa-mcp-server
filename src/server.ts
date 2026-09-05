import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";
import { loaProfile } from "./profiles/loa/index.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";

// このリポジトリのプロファイルは loa 1つだけ。フォーク側はこの import 行と
// profiles/ の中身を差し替える(design-multi-lod-generalization.md §5.1)。
// 選択機構(LOD_PROFILE / --profile)は作らない。
//
// name / title / description / instructions は loaProfile.server から取る。
// instructions の経緯・限界は CLAUDE.md「サーバー全体のガイダンス」参照。
const profile = loaProfile;

export function createServer(): McpServer {
  // eslint-disable-next-line no-console
  console.error(`Active profile: ${profile.id}`);

  const server = new McpServer(
    {
      name: profile.server.name,
      version: config.serverVersion,
      title: profile.server.title,
      description: profile.server.description,
    },
    { instructions: profile.server.instructions }
  );

  registerAllTools(server, profile);
  registerAllResources(server);

  return server;
}
