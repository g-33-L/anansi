import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const apiKey = process.env.ANANSI_API_KEY;
const baseUrl = process.env.ANANSI_BASE_URL;

if (!apiKey) {
  console.error("Error: ANANSI_API_KEY environment variable is required.");
  console.error("Usage: ANANSI_API_KEY=ans_... npm start");
  process.exit(1);
}

const env = {
  ...process.env,
  ANANSI_API_KEY: apiKey,
};

if (baseUrl) {
  env.ANANSI_BASE_URL = baseUrl;
}

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "anansi-mcp"],
  env,
});

const client = new Client(
  {
    name: "anansi-mcp-example-client",
    version: "1.0.0",
  },
  {
    capabilities: {},
  }
);

console.log("Connecting to anansi-mcp server over stdio...");
await client.connect(transport);
console.log("Connected successfully.\n");

console.log("Listing available MCP tools:");
const toolsResponse = await client.listTools();
for (const tool of toolsResponse.tools) {
  console.log(`- ${tool.name}: ${tool.description}`);
}

const testUserId = "dev-user-1";

console.log(`\nExecuting 'remember' tool for user: ${testUserId}...`);
const rememberResult = await client.callTool({
  name: "remember",
  arguments: {
    userId: testUserId,
    content: "User prefers TypeScript and strict typing for all API contracts.",
    sourceType: "note",
  },
});

console.log("Response from 'remember':");
for (const item of rememberResult.content) {
  if (item.type === "text") {
    console.log(item.text);
  }
}

console.log(`\nExecuting 'recall' tool for user: ${testUserId}...`);
const recallResult = await client.callTool({
  name: "recall",
  arguments: {
    userId: testUserId,
    query: "What language and typing preferences were specified?",
  },
});

console.log("Response from 'recall':");
for (const item of recallResult.content) {
  if (item.type === "text") {
    console.log(item.text);
  }
}

await client.close();
console.log("\nClient closed successfully.");
