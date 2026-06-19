/**
 * pi-ctx-ui — nicer per-command tool UI for context-mode's `ctx_*` tools.
 *
 * context-mode bridges its MCP tools into pi but gives them a minimal renderer
 * (the call row shows only the bold tool name; the result shows just the first
 * output line). This extension layers a richer, per-command renderer on top —
 * showing the meaningful arguments for each ctx tool (queries, path, language,
 * command labels, URLs, source, scope) and a clearer result line.
 *
 * How it works (and why it's safe):
 * - It reuses context-mode's OWN hardened MCP bridge (`bootstrapMCPTools`) via a
 *   proxy `pi` that intercepts `registerTool` and swaps in nicer renderCall/
 *   renderResult. Execution, schema, transport, the fork-bomb depth guard,
 *   retries and respawn are all context-mode's code — we only restyle.
 * - Registration happens in `before_agent_start`, after context-mode's bridge
 *   has settled, so this override wins (last registration wins in pi).
 * - If context-mode isn't installed, the bridge module can't be resolved, or
 *   anything throws, we degrade silently and context-mode's own tools remain.
 * - In nested/subagent bridges (CONTEXT_MODE_BRIDGE_DEPTH > 0) we do nothing —
 *   ctx_* tools aren't bridged there anyway.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const clip = (s: unknown, n = 72): string => {
	const t = String(s ?? "").replace(/\s+/g, " ").trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const verb = (name: string): string =>
	name === "ctx_search"
		? "searching"
		: name === "ctx_index" || name === "ctx_fetch_and_index"
			? "indexing"
			: name === "ctx_execute" || name === "ctx_execute_file" || name === "ctx_batch_execute"
				? "running"
				: "working";

function summarize(name: string, a: any, theme: any): string {
	const dim = (s: string) => theme.fg("dim", s);
	const acc = (s: string) => theme.fg("accent", s);
	const mut = (s: string) => theme.fg("muted", s);
	a = a ?? {};
	try {
		switch (name) {
			case "ctx_execute": {
				const lines = String(a.code ?? "").split("\n").length;
				return mut(a.language || "code") + (a.background ? dim(" bg") : "") + dim(`  ${lines} line${lines === 1 ? "" : "s"}`);
			}
			case "ctx_execute_file":
				return acc(clip(a.path, 48)) + (a.language ? mut(` [${a.language}]`) : "");
			case "ctx_batch_execute": {
				const cmds = Array.isArray(a.commands) ? a.commands : [];
				const labels = cmds.map((c: any) => c?.label).filter(Boolean).slice(0, 4).join(", ");
				const q = Array.isArray(a.queries) ? a.queries.length : 0;
				return (
					mut(`${cmds.length} cmd${cmds.length === 1 ? "" : "s"}`) +
					(labels ? dim(`  ${clip(labels, 48)}`) : "") +
					(q ? dim(`  +${q}q`) : "")
				);
			}
			case "ctx_fetch_and_index": {
				const reqs = Array.isArray(a.requests) ? a.requests : a.url ? [{ url: a.url }] : [];
				const first = reqs[0]?.url ?? a.url ?? "";
				return acc(clip(first, 46)) + (reqs.length > 1 ? dim(`  +${reqs.length - 1} more`) : "");
			}
			case "ctx_search": {
				const qs = Array.isArray(a.queries) ? a.queries : a.queries ? [a.queries] : [];
				const shown = qs.slice(0, 3).map((q: string) => acc(`"${clip(q, 32)}"`)).join(" ");
				return shown + (qs.length > 3 ? dim(` +${qs.length - 3}`) : "") + (a.source ? dim(`  src:${a.source}`) : "");
			}
			case "ctx_index":
				return (a.source ? acc(String(a.source)) : mut("index")) + dim(`  ${a.path ? clip(a.path, 40) : "inline"}`);
			case "ctx_purge":
				return mut(`scope:${a.scope || (a.sessionId ? "session" : "?")}`);
			default:
				return "";
		}
	} catch {
		return "";
	}
}

function renderCall(name: string, args: any, theme: any) {
	const title = theme.fg("toolTitle", theme.bold(name));
	const detail = summarize(name, args, theme);
	return new Text(detail ? `${title} ${detail}` : title, 0, 0);
}

function renderResult(name: string, result: any, options: any, theme: any) {
	const { expanded, isPartial } = options ?? {};
	if (isPartial) return new Text(theme.fg("warning", `${verb(name)}…`), 0, 0);
	const out = (result?.content ?? [])
		.filter((c: any) => c?.type === "text" && typeof c.text === "string")
		.map((c: any) => c.text)
		.join("\n");
	const isErr = Boolean(result?.isError || result?.details?.error);
	if (expanded) return new Text(theme.fg(isErr ? "error" : "toolOutput", out || ""), 0, 0);
	const first = out.split(/\r?\n/).find((l: string) => l.trim().length > 0)?.trim();
	const status = first && first.length <= 200 ? first : `${name} done`;
	const icon = isErr ? theme.fg("error", "✗ ") : theme.fg("success", "✓ ");
	return new Text(icon + theme.fg(isErr ? "error" : "toolOutput", clip(status, 180)), 0, 0);
}

/** Locate context-mode's install dir robustly (pi package dir, then global). */
function resolveContextModeRoot(): string | null {
	const candidates: string[] = [];
	try {
		candidates.push(join(getAgentDir(), "npm", "node_modules", "context-mode"));
	} catch {
		/* ignore */
	}
	try {
		const req = createRequire(import.meta.url);
		candidates.push(resolve(dirname(req.resolve("context-mode")), "..", "..", ".."));
	} catch {
		/* ignore */
	}
	try {
		const groot = execFileSync("npm", ["root", "-g"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
		if (groot) candidates.push(join(groot, "context-mode"));
	} catch {
		/* ignore */
	}
	for (const root of candidates) {
		if (
			root &&
			existsSync(join(root, "server.bundle.mjs")) &&
			existsSync(join(root, "build", "adapters", "pi", "mcp-bridge.js"))
		) {
			return root;
		}
	}
	return null;
}

export default function (pi: ExtensionAPI) {
	let readiness: Promise<void> | null = null;
	let bridge: { defs: any[]; shutdown?: () => void } | null = null;

	function applyOverrides(): void {
		if (!bridge) return;
		for (const def of bridge.defs) {
			const name = def.name as string;
			// Reuse context-mode's exact tool def (name, schema, execute → its MCP
			// client); only swap in our nicer renderers.
			pi.registerTool({
				...def,
				renderCall: (args: any, theme: any) => renderCall(name, args, theme),
				renderResult: (res: any, opts: any, theme: any) => renderResult(name, res, opts, theme),
			});
		}
	}

	async function ensureBridge(): Promise<boolean> {
		// Skip nested/subagent bridges — ctx_* tools aren't bridged at depth > 0.
		const depth = Number.parseInt(process.env.CONTEXT_MODE_BRIDGE_DEPTH ?? "0", 10);
		if (Number.isFinite(depth) && depth > 0) return false;

		const root = resolveContextModeRoot();
		if (!root) return false;
		const serverBundle = join(root, "server.bundle.mjs");
		const bridgePath = join(root, "build", "adapters", "pi", "mcp-bridge.js");

		const { bootstrapMCPTools } = await import(pathToFileURL(bridgePath).href);
		if (typeof bootstrapMCPTools !== "function") return false;

		// Spin up our own (hardened, context-mode-provided) bridge, but capture the
		// tool defs it would register instead of registering them — we re-register
		// them ourselves, later, with our renderers, so our version wins. Each def
		// already carries a working execute() bound to the bridge's MCP client.
		const recorded: any[] = [];
		const recPi = new Proxy(pi, {
			get(target, prop, receiver) {
				if (prop === "registerTool") return (def: any) => recorded.push(def);
				const value = Reflect.get(target as any, prop, receiver);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const handle = await bootstrapMCPTools(recPi as any, serverBundle);
		const defs = recorded.filter((d) => d && typeof d.name === "string" && typeof d.execute === "function");
		if (defs.length === 0) return false;
		bridge = { defs, shutdown: handle?.shutdown };
		return true;
	}

	async function ready(): Promise<void> {
		const ok = await ensureBridge();
		if (!ok || !bridge) return;
		// Local extensions outrank packages in pi's tool registry, so registering the
		// same ctx_* names here replaces context-mode's package registrations (and a
		// package can't clobber a local extension back). One application is enough.
		applyOverrides();
	}

	pi.on("before_agent_start", async () => {
		if (!readiness) {
			readiness = ready().catch((err) => {
				process.stderr.write(
					`[pi-ctx-ui] disabled (${err instanceof Error ? err.message : String(err)}); ` +
						`context-mode's own tool UI remains active.\n`,
				);
			});
		}
		await readiness;
	});

	pi.on("session_shutdown", () => {
		try {
			bridge?.shutdown?.();
		} catch {
			/* best effort */
		}
	});
}
