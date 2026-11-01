// Protocol output goes to stdout; diagnostics and errors go to stderr only.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as types from "@modelcontextprotocol/sdk/types.js";
const token = process.env.DISPATCH_TOKEN;
if (!token) {
  console.error(
    "Set DISPATCH_TOKEN to your scoped agent key or personal team key.",
  );
  process.exit(1);
}
let url;
try {
  url = new URL(process.env.DISPATCH_MCP_URL || "http://127.0.0.1:3080/mcp");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error();
  if (
    url.protocol === "http:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error();
} catch {
  console.error("Use an HTTPS MCP URL, or HTTP on loopback.");
  process.exit(1);
}
const remote = new Client(
  { name: "agent-team-stdio", version: "0.3.0" },
  { capabilities: {} },
);
let server,
  closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await remote.close().catch(() => {});
  await server?.close().catch(() => {});
}
try {
  await remote.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: "Bearer " + token } },
    }),
  );
  const capabilities = remote.getServerCapabilities();
  server = new Server(
    { name: "agent-team-stdio", version: "0.3.0" },
    {
      capabilities: {
        tools: capabilities?.tools || {},
        resources: capabilities?.resources || {},
        prompts: capabilities?.prompts || {},
      },
    },
  );
  for (const [schema, method] of [
    [types.ListToolsRequestSchema, "listTools"],
    [types.CallToolRequestSchema, "callTool"],
    [types.ListResourcesRequestSchema, "listResources"],
    [types.ListResourceTemplatesRequestSchema, "listResourceTemplates"],
    [types.ReadResourceRequestSchema, "readResource"],
    [types.SubscribeRequestSchema, "subscribeResource"],
    [types.UnsubscribeRequestSchema, "unsubscribeResource"],
    [types.ListPromptsRequestSchema, "listPrompts"],
    [types.GetPromptRequestSchema, "getPrompt"],
  ])
    server.setRequestHandler(schema, (request) =>
      remote[method](request.params || {}),
    );
  remote.setNotificationHandler(
    types.ResourceUpdatedNotificationSchema,
    (event) => server.sendResourceUpdated(event.params),
  );
  remote.setNotificationHandler(
    types.ResourceListChangedNotificationSchema,
    () => server.sendResourceListChanged(),
  );
  remote.setNotificationHandler(types.ToolListChangedNotificationSchema, () =>
    server.sendToolListChanged(),
  );
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    void close();
  };
  await server.connect(transport);
  process.on("SIGINT", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
  });
} catch {
  console.error(
    "Dispatch MCP connection failed. Check the URL, server and credential permissions.",
  );
  await close();
  process.exitCode = 1;
}
