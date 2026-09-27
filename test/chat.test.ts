import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatInstructions, chatTools, contextTokensOf, estimateTokens, messageText, repairInput, respondToChat } from "../src/clients/chat.js";
import { withoutNulls } from "../src/clients/tools.js";
import { createApp } from "../src/clients/http.js";
import { budgetLevel } from "../src/core/budget.js";
import { ChatFullError, titleFrom } from "../src/managers/chatManager.js";
import { ChatModelError, chatModel, modelActor } from "../src/utilities/chatModel.js";
import { type TestVault, makeVault } from "./helpers.js";

const TEXT = "Today I froze in the meeting. The shame made me freeze even more.";
const userMessage = (text = TEXT) => ({ id: "u1", role: "user" as const, parts: [{ type: "text" as const, text }] });
const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});
const finish = (reason: "stop" | "tool-calls", input = 100, output = 20) => ({ type: "finish" as const, finishReason: { unified: reason, raw: undefined }, usage: usage(input, output) });
const toolCall = (id: string, toolName: string, input: object) => ({ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) });
const text = (words: string) => [{ type: "text-start" as const, id: "t" }, { type: "text-delta" as const, id: "t", delta: words }, { type: "text-end" as const, id: "t" }];

/** A scripted model: each call streams the next list of chunks. */
function scripted(steps: ((call: number) => unknown[])[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const chunks = steps[Math.min(call, steps.length - 1)](call);
      call++;
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
}

let t: TestVault;
beforeEach(() => {
  t = makeVault();
});
afterEach(() => t.cleanup());

describe("conversations", () => {
  it("are created, listed, named from the first message, renamed and removed", () => {
    const { chat } = t.vault.chat.create();
    expect(t.vault.chat.list().map((c) => c.id)).toEqual([chat.id]);
    t.vault.chat.save(chat.id, [userMessage(`${"x".repeat(40)} and then quite a lot more words follow here`)], 10);
    const title = t.vault.chat.get(chat.id).chat.title;
    expect(title).toMatch(/^x{40} and then quite a …$|^x{40} and then quite a\S*…$/);
    expect(title.length).toBeLessThanOrEqual(61);
    t.vault.chat.save(chat.id, [userMessage("other")], 12);
    expect(t.vault.chat.get(chat.id).chat.title).toMatch(/^x+/);
    expect(t.vault.chat.rename(chat.id, "  Mine ").chat.title).toBe("Mine");
    expect(t.vault.chat.rename(chat.id, " ").chat.title).toBe("Mine");
    expect(t.vault.chat.remove(chat.id)).toEqual({ removed: true });
    expect(() => t.vault.chat.get(chat.id)).toThrow("not found");
    expect(t.vault.chat.open("fresh").chat.title).toBe("New conversation");
  });

  it("warn as they fill up and end when nearly full", () => {
    expect([budgetLevel(10, 100), budgetLevel(70, 100), budgetLevel(90, 100)]).toEqual(["ok", "warn", "full"]);
    const { chat } = t.vault.chat.create("c");
    t.vault.chat.save("c", [], 31_000);
    expect(t.vault.chat.list()[0].budget).toEqual({ contextTokens: 31_000, contextWindow: 32_000, level: "full" });
    expect(() => t.vault.chat.assertRoom(t.vault.chat.get(chat.id).chat)).toThrow(ChatFullError);
    expect(titleFrom([{ role: "assistant", parts: [] }])).toBeUndefined();
    expect(titleFrom([{ role: "user", parts: [{ type: "file" }] }])).toBeUndefined();
  });
});

describe("chat settings", () => {
  it("default to a local model, switch to OpenRouter with a key, and never return the key", () => {
    expect(t.vault.chat.publicSettings()).toMatchObject({ provider: "local", model: "gemma4:latest", hasKey: false, hosted: false });
    const openrouter = t.vault.chat.updateSettings({ provider: "openrouter", apiKey: "sk-or-test" });
    expect(openrouter).toMatchObject({ provider: "openrouter", model: "anthropic/claude-sonnet-5", contextWindow: 200_000, hasKey: true, hosted: true });
    expect(openrouter).not.toHaveProperty("apiKey");
    expect(t.vault.chat.updateSettings({ model: "openai/gpt-5.6-sol", model2: "" } as never).model).toBe("openai/gpt-5.6-sol");
    expect(t.vault.chat.updateSettings({ provider: "local", baseUrl: "http://10.0.0.2:1234/v1" })).toMatchObject({ model: "gemma4:latest", hosted: true, hasKey: true });
  });

  it("pick up OPENROUTER_API_KEY from the environment", async () => {
    const { openVault } = await import("../src/vault.js");
    const v = openVault({ dir: t.dir, key: "a".repeat(64), env: { OPENROUTER_API_KEY: "k" }, embedder: null, reranker: null });
    expect(v.chat.publicSettings()).toMatchObject({ provider: "openrouter", hasKey: true });
    v.close();
  });

  it("build a model for each provider", () => {
    expect(chatModel({ provider: "local", model: "m", baseUrl: "http://127.0.0.1:1/v1" }, "i")).toMatchObject({ instructions: "i" });
    expect(chatModel({ provider: "openrouter", model: "m", apiKey: "k", baseUrl: "" }, "i")).toMatchObject({ instructions: "i" });
    expect(() => chatModel({ provider: "openrouter", model: "m", baseUrl: "" }, "i")).toThrow(ChatModelError);
    expect(modelActor("anthropic/claude-sonnet-5")).toBe("model:claude-sonnet-5");
  });
});

describe("chat turns", () => {
  it("builds instructions with the selection and tools without add_entry", () => {
    expect(chatInstructions([], "SKILL")).toContain("SKILL");
    expect(chatInstructions([{ id: "n1", kind: "node", type: "part", label: "The Hider", status: "active", confirmed: false }])).toContain("- The Hider (node part, id n1)");
    const tools = chatTools(t.vault, "model:x", "hello");
    expect(Object.keys(tools)).toContain("record_entry");
    expect(Object.keys(tools)).not.toContain("add_entry");
    expect(messageText({ id: "a", role: "user", parts: [{ type: "text", text: "a" }, { type: "step-start" }, { type: "text", text: "b" }] })).toBe("ab");
    expect(contextTokensOf(undefined, 5)).toBe(5);
    expect(contextTokensOf({ inputTokens: undefined, outputTokens: undefined } as never, 5)).toBe(5);
  });

  it("records the person's message, adds to the graph, and stores the turn", async () => {
    const entryId = () => t.vault.explore.entries()[0].id;
    const model = scripted([
      () => [toolCall("c1", "record_entry", { title: "The meeting" }), finish("tool-calls")],
      () => [
        toolCall("c2", "add_to_graph", {
          entry: entryId(),
          nodes: [{ ref: "f", type: "process_node", label: "Freezing", confidence: 0.8, quotes: ["I froze in the meeting"] }],
        }),
        finish("tool-calls"),
      ],
      () => [...text("I added Freezing. Does that fit?"), finish("stop", 1500, 40)],
    ]);
    const response = await respondToChat(t.vault, { id: "chat1", message: userMessage() }, model);
    const stream = await response.text();
    expect(stream).toContain('"toolName":"add_to_graph"');
    expect(stream).toContain('"contextTokens":1540');

    const { chat, budget } = t.vault.chat.get("chat1");
    expect(chat.title).toBe(`${TEXT.slice(0, 60).replace(/\s+\S*$/, "")}…`);
    expect(chat.messages).toHaveLength(2);
    expect(budget).toMatchObject({ contextTokens: 1540, level: "ok" });
    expect(t.vault.explore.entries()[0]).toMatchObject({ title: "The meeting" });
    expect(t.vault.explore.entry(entryId()).text).toBe(TEXT);
    const freezing = Object.values(t.vault.explore.graph().nodes).find((n) => n.label === "Freezing");
    expect(freezing?.assertedBy).toBe("model:gemma4:latest");
  });

  it("refuses a turn in a full conversation, over HTTP too", async () => {
    t.vault.chat.save("full", [], 31_500);
    await expect(respondToChat(t.vault, { id: "full", message: userMessage() }, scripted([() => []]))).rejects.toThrow(ChatFullError);
    const app = createApp(t.vault);
    const res = await app.request("/api/chat", { method: "POST", body: JSON.stringify({ id: "full", message: userMessage() }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("full");
  });
});

describe("tool input from small models", () => {
  it("is repaired when a list comes as a string or a field as null", () => {
    expect(repairInput('{"nodes":[{"quotes":"I froze","existing_id":null}],"ids":["a"]}')).toBe('{"nodes":[{"quotes":["I froze"]}],"ids":["a"]}');
    expect(repairInput('{"nodes":[{"quotes":["ok"]}]}')).toBeUndefined();
    expect(repairInput("not json")).toBeUndefined();
    expect(withoutNulls({ a: null, b: [{ c: null, d: 1 }], e: "x" })).toEqual({ b: [{ d: 1 }], e: "x" });
    expect(estimateTokens("abcd".repeat(10))).toBeGreaterThanOrEqual(10);
  });

  it("is repaired during a turn so the call goes through", async () => {
    const entryId = () => t.vault.explore.entries()[0].id;
    const model = scripted([
      () => [toolCall("c1", "record_entry", {}), finish("tool-calls")],
      () => [toolCall("c2", "add_to_graph", { entry: entryId(), nodes: [{ ref: "f", existing_id: null, type: "process_node", label: "Freezing", confidence: 0.8, quotes: "I froze in the meeting" }] }), finish("tool-calls")],
      () => [...text("Done."), finish("stop")],
    ]);
    await (await respondToChat(t.vault, { id: "r", message: userMessage() }, model)).text();
    expect(Object.values(t.vault.explore.graph().nodes).map((n) => n.label)).toContain("Freezing");
  });
});

describe("chat HTTP routes", () => {
  it("manage conversations and settings", async () => {
    const app = createApp(t.vault);
    const call = async (path: string, method = "GET", payload?: unknown) => {
      const res = await app.request(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload), headers: { "content-type": "application/json" } });
      return { status: res.status, json: await res.json() };
    };
    const created = (await call("/api/chats", "POST", {})).json.chat;
    expect((await call("/api/chats")).json).toHaveLength(1);
    expect((await call(`/api/chats/${created.id}`)).json.budget.level).toBe("ok");
    expect((await call(`/api/chats/${created.id}`, "PATCH", { title: "Named" })).json.chat.title).toBe("Named");
    expect((await call(`/api/chats/${created.id}`, "PATCH", {})).json.chat.title).toBe("Named");
    expect((await call(`/api/chats/${created.id}`, "DELETE")).json).toEqual({ removed: true });
    expect((await call("/api/chat/settings")).json.provider).toBe("local");
    expect((await call("/api/chat/settings", "PUT", { model: "qwen3.6" })).json.model).toBe("qwen3.6");
  });
});
