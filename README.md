### Bruno MCP - Model Context Protocol server for Bruno

Bruno MCP is an [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude, Cursor, and any other MCP-compatible client) work with your [Bruno](https://github.com/usebruno/bruno) API collections.

It exposes your requests, folders, and environments as MCP tools so an agent can discover, inspect, and run them, while your collections stay on your filesystem, right where Bruno keeps them.

> Bruno is an open source, offline-first API client. Collections live as plain text files in a folder, versioned with Git. Bruno MCP brings that same philosophy to AI workflows, your data never leaves your machine.

## Tools

| Tool | Purpose |
|---|---|
| `list_collections` | List registered collections with their name, path, and environments. Read-only. |
| `list_requests` | List the requests in a collection, flattened across folders (relative path + type + method + URL); optional `search` and `method` filters. Deliberately shallow, so it stays fast on large collections. Read-only. |
| `get_request` | Read one request's full definition from disk: headers, params, body, auth, scripts, tests, assertions, variables, docs, settings. Reads only, sends nothing. Read-only. |
| `execute_request` | Execute one request via `bru run`; returns status, request and response headers, the response body in full, assertions, and test results. Takes `collectionPath`, `requestPath`, optional `environment` and `variables` overrides. |
| `run_collection` | Run a whole collection, or a subset of requests/folders (`requests`), via `bru run`; supports `iterations`, a CSV/JSON `dataFile`, `parallel`, `bail`, and `timeoutSeconds` (default 600). Returns a pass/fail summary and a per-request roll-up (outcome, status, response time, failed assertions/tests); headers and bodies are left out. |
| `list_environments` | List a collection's environments with their variable count and whether they contain secrets. Read-only. |
| `get_environment` | Read one environment's variables (name, value, enabled, secret). Secret values come back as `<redacted>`. Read-only. |

A collection is addressed by its **path**, not by an id: pass the `path` from `list_collections` as `collectionPath` to the other tools. If you already know where a collection lives, you can pass it directly without listing first. A request is addressed by its `relativePath` within the collection (e.g. `users/get-user.bru`).

### What ends up in tool output

`execute_request` returns what the Bruno CLI reports, carrying only the CLI's own masking:

- **Request** headers whose name is known to carry credentials (`Authorization`, `Cookie`, `X-Api-Key`, `X-Auth-Token`, …) are masked; a `Bearer`/`Basic` scheme is kept, the value is not.
- Values the run knows to be secrets (`vars:secret` in the selected environment, values from `.env`) are scrubbed everywhere they appear, including URLs and bodies.

Everything else comes back as-is, including **response headers**: a `Set-Cookie` carrying a live session is returned in full. So are response bodies, URL query values, and request headers outside that name list. Treat the result as potentially containing live credentials, and the same for anything `get_request` reads out of a `.bru` file.

`get_environment` replaces the value of every variable marked secret with `<redacted>`. Non-secret values are returned as stored on disk, so a credential kept in a plain variable is returned as-is.

`run_collection` leaves headers and bodies out, but failed assertion/test messages, per-request errors, and `diagnostics` carry only the CLI masking above, so an assertion on a response value can echo that value back.

Response bodies are not truncated by this server. Every MCP client applies its own ceiling, so a second cap here would only lose bodies the client would have accepted.

## Setup

Build first. Clients spawn the compiled entry (`dist/index.js`) directly, so it must exist before you configure a client; rebuild after source changes or use `npm run watch`:

```bash
npm install
npm run build
```

Get the absolute path to the compiled entry and use it wherever a client config asks for the server command:

```bash
echo "$(pwd)/dist/index.js"
```

### Claude Code

```bash
claude mcp add bruno -- node /abs/path/to/dist/index.js
# optional: pin a collection
claude mcp add bruno -- node /abs/path/to/dist/index.js --collection /path/to/collection
```

Verify with `claude mcp list`, then open a new session.

### Cursor / Claude Desktop

Add to `~/.cursor/mcp.json` (Cursor) or `~/Library/Application Support/Claude/claude_desktop_config.json` (Claude Desktop, macOS):

```json
{
  "mcpServers": {
    "bruno": {
      "command": "node",
      "args": ["/abs/path/to/dist/index.js", "--collection", "/path/to/collection"]
    }
  }
}
```

Reload Cursor (or toggle the server in Settings > MCP). Fully quit Claude Desktop (⌘Q) and reopen. Drop the `--collection` args to rely on auto-discovery.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node /abs/path/to/dist/index.js
```

## Collection discovery

At startup the server resolves which collections to expose. Sources, first non-empty wins:

1. **Explicit flags**: `--collection` / `--workspace` (both repeatable; a workspace expands to its member collections).
2. **CWD walk-up**: looks for `bruno.json` / `opencollection.yml` / `workspace.yml` walking up from the working directory the client spawned the server in.
3. **Bruno desktop preferences** *(on by default; `--no-auto-discovery` to disable)*: `lastOpenedWorkspaces`, `lastOpenedCollections`, and the default workspace from `preferences.json`:
   - macOS: `~/Library/Application Support/bruno/preferences.json`
   - Windows: `%APPDATA%/bruno/preferences.json`
   - Linux: `~/.config/bruno/preferences.json`

## Options

Options are passed as CLI flags when the client spawns the server (see the setup snippets above).

```
Usage: bruno-mcp [--collection <path>] [--workspace <path>]
                 [--no-cwd-discovery] [--no-auto-discovery] [--verbose]
```

| Flag | Description |
|---|---|
| `--collection <path>`, `-c` | Bruno collection directory. Repeatable. |
| `--workspace <path>`, `-w` | Bruno workspace directory. Repeatable; expands to member collections. |
| `--no-cwd-discovery` | Disable the CWD walk-up step. |
| `--no-auto-discovery` | Disable the Bruno desktop preferences fallback. |
| `--verbose` | Log debug info to stderr. |
| `--help`, `-h` | Show help. |

## Links

- [Bruno](https://github.com/usebruno/bruno)
- [Bruno docs](https://docs.usebruno.com)
- [Bruno CLI](https://docs.usebruno.com/bru-cli/overview)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Website](https://www.usebruno.com) · [Discord](https://discord.com/invite/KgcZUncpjq) · [X](https://twitter.com/use_bruno)

## License

MIT
