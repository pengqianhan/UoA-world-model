import { describe, expect, it } from "vitest";
import { describe as describeReply, parseArgs, toCommand } from "../scripts/walker/cli.ts";
import { TOOLS, callTool, handle, type Deps } from "../scripts/walker/mcp.ts";

describe("the walker's command line", () => {
  it("splits a command, its words and its flags", () => {
    expect(parseArgs(["walk", "General", "Library", "--speed", "6", "--as", "Kea", "--json"])).toEqual({
      cmd: "walk",
      words: ["General", "Library"],
      flags: { speed: "6", as: "Kea", json: true },
    });
    expect(parseArgs([]).cmd).toBe("help");
    expect(parseArgs(["see", "--view=eyes"]).flags.view).toBe("eyes");
  });

  it("turns each command into what the page runs", () => {
    expect(toCommand(parseArgs(["walk", "303-G23"]))).toEqual({ name: "walk", args: { name: undefined, to: "303-G23", speed: undefined } });
    expect(toCommand(parseArgs(["turn", "-90"]))).toEqual({ name: "turn", args: { name: undefined, by: -90 } });
    expect(toCommand(parseArgs(["turn", "north-east"]))).toEqual({ name: "turn", args: { name: undefined, face: "north-east" } });
    expect(toCommand(parseArgs(["say", "Kia", "ora", "--as", "Tui"]))).toEqual({ name: "say", args: { name: "Tui", text: "Kia ora" } });
    expect(toCommand(parseArgs(["outfit", '{"base":"witch","top":"#112233"}']))!.args.outfit).toEqual({ base: "witch", top: "#112233" });
    expect(toCommand(parseArgs(["spawn", "Kea", "--near", "109"]))).toEqual({ name: "spawn", args: { name: "Kea", near: "109", outfit: undefined } });
    expect(toCommand(parseArgs(["dance"]))).toBeUndefined();
  });

  it("answers in a sentence, and says what another walker said is theirs", () => {
    expect(describeReply("walk", { arrived: true, to: "109 General Library", metres: 60, seconds: 15, look: { summary: "Walker is out of doors." } })).toBe(
      "Arrived at 109 General Library after 60 m (15 s).\nWalker is out of doors.",
    );
    expect(describeReply("listen", { heard: [{ from: "Kea", text: "Hello", secondsAgo: 3 }] })).toBe('Kea (3 s ago, another walker): "Hello"');
    expect(describeReply("look", { error: "There is no walker called \"X\"." })).toMatch(/^Could not:/);
  });
});

describe("the walker's MCP server", () => {
  const calls: [string, Record<string, unknown>][] = [];
  const deps: Deps = {
    command: async (name, args) => {
      calls.push([name, args]);
      if (name === "walk") return { arrived: true, look: { summary: "Beside 109." } };
      if (name === "say") return { error: "text: something to say." };
      return { ok: true };
    },
    see: async () => ({ file: ".walker/shots/v.png", jpeg: "AAAA" }),
    stop: async () => true,
  };

  it("agrees a protocol version and offers tools", async () => {
    const init = await handle(deps, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    expect(init).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "campus-walker" } } });
    expect(await handle(deps, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    const list = (await handle(deps, { jsonrpc: "2.0", id: 2, method: "tools/list" })) as { result: { tools: { name: string; inputSchema: unknown }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain("walker_walk");
    for (const t of list.result.tools) expect(t.inputSchema).toMatchObject({ type: "object" });
    expect(TOOLS.length).toBe(list.result.tools.length);
  });

  it("runs a tool and returns text, an error as isError, and a picture as an image", async () => {
    const walked = (await callTool(deps, "walker_walk", { to: "109" })) as { content: { type: string; text: string }[] };
    expect(calls.at(-1)).toEqual(["walk", { to: "109" }]);
    expect(walked.content[0]!.text.startsWith("Beside 109.")).toBe(true);
    expect(await callTool(deps, "walker_say", { text: "" })).toEqual({ content: [{ type: "text", text: "text: something to say." }], isError: true });
    const seen = (await callTool(deps, "walker_see", { view: "eyes" })) as { content: { type: string; mimeType?: string }[] };
    expect(seen.content[0]).toMatchObject({ type: "image", mimeType: "image/jpeg", data: "AAAA" });
  });

  it("refuses an unknown method with a JSON-RPC error", async () => {
    expect(await handle(deps, { jsonrpc: "2.0", id: 9, method: "resources/list" })).toEqual({ jsonrpc: "2.0", id: 9, error: { code: -32601, message: "Method not found: resources/list" } });
  });
});
