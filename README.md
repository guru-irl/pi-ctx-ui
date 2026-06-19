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

This extension must be installed as a **local extension** (auto-discovered from
`~/.pi/agent/extensions/`), not as a pi package. In pi, package extensions can't
override another package's tools, but local extensions outrank packages — which
is how this cleanly replaces context-mode's `ctx_*` renderers.

```bash
git clone https://github.com/guru-irl/pi-ctx-ui ~/.pi/agent/extensions/pi-ctx-ui
```

pi auto-discovers `~/.pi/agent/extensions/*/index.ts` and hot-reloads it with
`/reload`. Update later with:

```bash
git -C ~/.pi/agent/extensions/pi-ctx-ui pull
```

> Do **not** `pi install git:…/pi-ctx-ui` — installed as a package it loads with
> package precedence and silently fails to override context-mode's tools.

## How it works (and why it's safe)

It reuses context-mode's **own** hardened MCP bridge (`bootstrapMCPTools`): it
spins up that bridge with a recording proxy to capture the exact tool defs
(name, schema, and an `execute` already bound to context-mode's MCP client),
then re-registers each one with nicer `renderCall`/`renderResult`. Execution,
schema, transport, the fork-bomb depth guard, retries and respawn are all
context-mode's code — this extension only restyles.

- As a local extension it outranks the context-mode package, so its `ctx_*`
  registrations win deterministically.
- If context-mode isn't installed, its bridge module can't be resolved, or
  anything throws, the extension **degrades silently** and context-mode's own
  tool UI stays active.
- In nested/subagent bridges (`CONTEXT_MODE_BRIDGE_DEPTH > 0`) it does nothing —
  `ctx_*` tools aren't bridged there anyway.

## Configuration

The call row for command tools (`ctx_execute`, `ctx_execute_file`,
`ctx_batch_execute`) shows the **actual command/code lines** beneath the row,
with a dim `│` gutter, so you can read what's running instead of a `N lines`
summary:

```
ctx_execute shell
│ echo one
│ echo two
│ echo three
│ … (+7 more lines)
```

| Env var | Default | Effect |
| --- | --- | --- |
| `CTX_UI_CMD_LINES` | `10` | Max command lines shown on the call row. `0` disables the block (falls back to a compact `N lines` summary). |
| `CTX_UI_CMD_WIDTH` | `120` | Per-line width before each line is clipped with an ellipsis. |

Lines beyond the cap collapse into a `… (+N more lines)` marker.

## Requirements

- pi with the `context-mode` package installed (the `ctx_*` tools come from it).

## License

MIT © guru-irl
