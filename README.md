# pi-ctx-ui

Nicer per-command tool UI for [context-mode](https://www.npmjs.com/package/context-mode)'s `ctx_*` tools in [pi](https://github.com/earendil-works/pi-mono).

context-mode bridges its MCP tools into pi but renders them minimally — the call row shows only the bold tool name, and the result shows just the first output line. This extension layers a richer, per-command renderer on top so each `ctx_*` call shows the arguments that matter:

| Tool | Call row shows |
|---|---|
| `ctx_search` | the queries + `src:<source>` |
| `ctx_execute` | language + line count (+ `bg`) |
| `ctx_execute_file` | path + `[language]` |
| `ctx_batch_execute` | command count + labels + query count |
| `ctx_fetch_and_index` | first URL + `+N more` |
| `ctx_index` | source + path/`inline` |
| `ctx_purge` | scope |

Results render with a `✓`/`✗` status line and full output when expanded.

## Install

```bash
pi install git:github.com/guru-irl/pi-ctx-ui
```

Install it **after** context-mode so it loads later and its renderers win.

## How it works (and why it's safe)

It reuses context-mode's **own** hardened MCP bridge (`bootstrapMCPTools`) through a proxy `pi` that intercepts `registerTool` and swaps in nicer `renderCall`/`renderResult`. Execution, schema, transport, the fork-bomb depth guard, retries and respawn are all context-mode's code — this extension only restyles.

- Registration happens in `before_agent_start`, after context-mode's bridge settles, so the override wins (last registration wins in pi).
- If context-mode isn't installed, its bridge module can't be resolved, or anything throws, the extension **degrades silently** and context-mode's own tool UI stays active.
- In nested/subagent bridges (`CONTEXT_MODE_BRIDGE_DEPTH > 0`) it does nothing — `ctx_*` tools aren't bridged there anyway.

## Requirements

- pi with the `context-mode` package installed (the `ctx_*` tools come from it).

## License

MIT © guru-irl
