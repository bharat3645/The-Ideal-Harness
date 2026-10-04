# Setup for Gemini (Antigravity)

Gemini (when running via the Antigravity IDE or similar MCP-compatible clients) supports The Ideal Harness via its **Tier-2** capability.

### 1. Build the Harness
Since the harness provides standalone MCP servers for each of its modules, you first need to build it from source:

```bash
# Clone the repository
git clone https://github.com/bharat3645/The-Ideal-Harness
cd The-Ideal-Harness

# Install dependencies and build
corepack pnpm install
corepack pnpm build
```

### 2. Configure MCP Servers
Gemini relies on an `mcp_config.json` file to discover external tools. Create an `.agents/mcp_config.json` file in your workspace root with the following content (adjust the paths to match where you cloned the repo):

```json
{
  "mcpServers": {
    "ideal-harness-guard": {
      "command": "node",
      "args": ["/absolute/path/to/The-Ideal-Harness/dist/guard/cli/index.js", "mcp"]
    },
    "ideal-harness-compress": {
      "command": "node",
      "args": ["/absolute/path/to/The-Ideal-Harness/dist/compress/cli/index.js", "mcp"]
    },
    "ideal-harness-memory": {
      "command": "node",
      "args": ["/absolute/path/to/The-Ideal-Harness/dist/memory/cli/index.js", "mcp"]
    },
    "ideal-harness-orchestrate": {
      "command": "node",
      "args": ["/absolute/path/to/The-Ideal-Harness/dist/orchestrate/cli/index.js", "mcp"]
    },
    "ideal-harness-web": {
      "command": "node",
      "args": ["/absolute/path/to/The-Ideal-Harness/dist/web/cli/index.js", "mcp"]
    }
  }
}
```

### 3. Usage & Limitations
Once configured, reload your Gemini session. Gemini will now have access to all the primitive tools (`policy_check`, `vet_skill`, `query_graph`, `ledger_add`, etc.). 

**Important Note on Automatic Hooks:**
Unlike Tier 1 (Claude Code), Tier 2 environments do **not** run the safety floor automatically on every tool call. Gemini must proactively call the `policy_check` MCP tool before performing a risky action, or call `redact` to scrub sensitive data. The tools exist and function perfectly, but the invocation is manual.
