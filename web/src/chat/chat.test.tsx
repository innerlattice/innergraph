// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Call, fakeServer, json } from "../testing/fakeServer";
import { App } from "../App";
import type { ChatMessage, PublicChatSettings } from "../api";
import { ViewRail } from "../components/ViewRail";
import { ChatRail, ago } from "./ChatRail";
import { ChatView, footerFor } from "./ChatView";
import { BudgetNotice, Composer, ContextMeter, FullNotice, SelectionChips } from "./Composer";
import { MessageBoundary } from "./Message";
import { SettingsDialog, linkPoll } from "./SettingsDialog";
import { ToolCard } from "./ToolCard";
import { budgetLevel } from "../../../src/core/budget";
import { describeTool, errorText, friendlyError, isFullError, isSilent, latestTokens, marksFor, recordedEntry, repliesTo, markedRuns, textOf } from "./parts";

vi.mock("../components/GraphCanvas", () => ({ GraphCanvas: () => <div data-testid="graph-canvas" /> }));

const TEXT = "Today I froze in the meeting. The shame made it worse.";
const user = (text = TEXT, id = "u1"): ChatMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const tool = (name: string, state: string, extra: object = {}) => ({ type: `tool-${name}`, toolCallId: `${name}-${state}`, state, ...extra });
const added = {
  session: "s9",
  items: [
    { id: "n7", kind: "node", label: "Freezing", evidence: [], quotes: ["I froze in the meeting"] },
    { id: "n8", kind: "node", label: "Shame", evidence: [], quotes: ["The shame", "not in the text"] },
  ],
  dropped: ["x"],
  merged: [{ id: "a", into: "n8", reason: "same" }],
};
const reply = (parts: unknown[], metadata?: object): ChatMessage => ({ id: "a1", role: "assistant", parts: parts as ChatMessage["parts"], metadata });
const SETTINGS: PublicChatSettings = { provider: "local", model: "gemma", baseUrl: "http://127.0.0.1:11434/v1", contextWindow: 32_000, hasKey: false, hosted: false };

/** The UI message stream the server sends for a turn. */
function sse(chunks: object[]): Response {
  const body = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
}

const TURN = [
  { type: "start", messageId: "a1" },
  { type: "start-step" },
  { type: "tool-input-available", toolCallId: "c0", toolName: "search_graph", input: { query: "froze" } },
  { type: "tool-output-available", toolCallId: "c0", output: [] },
  { type: "tool-input-available", toolCallId: "c1", toolName: "record_entry", input: {} },
  { type: "tool-output-available", toolCallId: "c1", output: { entry: "h1", title: "The meeting" } },
  { type: "tool-input-available", toolCallId: "c2", toolName: "add_to_graph", input: { entry: "h1" } },
  { type: "tool-output-available", toolCallId: "c2", output: added },
  { type: "finish-step" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "I added **Freezing**. Does that fit?" },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
  { type: "finish", finishReason: "stop", messageMetadata: { contextTokens: 24_000, contextWindow: 32_000 } },
];

let calls: Call[];
let routes: Record<string, () => Response>;

beforeEach(() => {
  routes = {
    "GET /api/chat/settings": () => json(SETTINGS),
    "GET /api/chats": () =>
      json([
        {
          id: "old",
          title: "Earlier",
          createdAt: "2026-09-20T00:00:00Z",
          updatedAt: new Date().toISOString(),
          contextTokens: 10,
          budget: { contextTokens: 10, contextWindow: 32_000, level: "ok" },
        },
      ]),
    "GET /api/chats/old": () =>
      json({ chat: { id: "old", title: "Earlier", messages: [user("Earlier words", "u0")] }, budget: { contextTokens: 10, contextWindow: 32_000, level: "ok" } }),
    "POST /api/chat": () => sse(TURN),
    "GET /api/selection": () => json({ ids: ["n7"], at: "1", items: [{ id: "n7", kind: "node", type: "part", label: "Freezing", status: "active", confirmed: false }] }),
    "PUT /api/selection": () => json({ ids: [], at: "2", items: [] }),
    "GET /api/view": () =>
      json({
        nodes: { n7: { id: "n7", type: "part", label: "Freezing", status: "active", confirmed: false, attributes: {}, evidence: [], staleEvidence: 0 } },
        edges: {},
        counts: { active: 1, removed: 0 },
        position: "p",
      }),
    "POST /api/undo-session": () => json({ session: "u", summary: { retired: 1, restored: 0, changed: 0 } }),
  };
  calls = fakeServer((call) => routes[`${call.method} ${call.path}`]?.());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reading a conversation", () => {
  it("describes tool calls in plain words", () => {
    expect(describeTool(tool("add_to_graph", "input-streaming"))).toMatchObject({ phase: "running", title: "Adding to your map…", quiet: false });
    const done = describeTool(tool("add_to_graph", "output-available", { output: added }));
    expect(done).toMatchObject({ title: "Added 2 things to your map", session: "s9" });
    expect(done.items.map((i) => i.label)).toEqual(["Freezing", "Shame"]);
    expect(describeTool(tool("add_to_graph", "output-available", { output: added }), { n8: "Me —feels→ Shame" }).items[1].label).toBe("Me —feels→ Shame");
    expect(done.notes).toEqual(["1 thing already on your map, so reused", "1 quote didn't match your words and was left out"]);
    expect(describeTool(tool("amend", "output-available", { output: { session: "s", changed: ["n1"], dropped: ["a", "b"] } }), { n1: "One" }).notes[0]).toContain("were left out");
    expect(describeTool(tool("remove", "output-available", { output: { session: "s", removed: ["n1", "n2"] } }), { n1: "One" }).items).toEqual([
      { id: "n1", label: "One" },
      { id: "n2", label: "an item" },
    ]);
    expect(describeTool(tool("record_entry", "output-available", { output: { entry: "h", title: "" } })).title).toBe("Saved as an entry");
    expect(describeTool(tool("undo", "output-error", { errorText: "No such event" }))).toMatchObject({ phase: "error", title: "Couldn't finish: undoing", error: "No such event" });
    expect(describeTool(tool("search_graph", "input-available"))).toMatchObject({ quiet: true, title: "Searched your map" });
    expect(describeTool(tool("mystery", "output-available")).title).toBe("Looked something up");
    for (const name of ["merge_nodes", "split_node", "merge_duplicates", "restore", "undo_session", "revert", "revise_entry"]) {
      expect(describeTool(tool(name, "output-available", { output: { session: "s" } })).session).toBe("s");
    }
  });

  it("keeps tool errors short", () => {
    expect(friendlyError(undefined)).toBeUndefined();
    expect(friendlyError("AI_InvalidToolInputError: Invalid input")).toContain("incomplete request");
    expect(friendlyError(`${"x".repeat(200)}\nmore`)).toHaveLength(158);
  });

  it("finds the passages later calls quote from the message's entry, pending or written", () => {
    const replies = [
      reply([
        tool("record_entry", "output-available", { output: { entry: "h1", title: "T" } }),
        tool("add_to_graph", "output-available", { input: { entry: "h1" }, output: added }),
        tool("add_to_graph", "input-streaming", { input: { entry: "h1", nodes: [{ label: "Worse", quotes: ["made it worse"] }, { quotes: "half" }, null], edges: "partial" } }),
        tool("add_to_graph", "output-error", { input: { entry: "h1", nodes: [{ quotes: ["Today"] }] } }),
        tool("add_to_graph", "output-available", { input: { entry: "other", nodes: [{ quotes: ["Today"] }] } }),
        tool("add_to_graph", "input-streaming"),
        tool("add_to_graph", "output-available", { input: { entry: "h1" } }),
      ]),
    ];
    expect(recordedEntry(replies)).toBe("h1");
    expect(recordedEntry([])).toBeUndefined();
    expect(marksFor(TEXT, undefined, replies)).toEqual([]);
    const marks = marksFor(TEXT, "h1", replies);
    expect(marks.map((m) => TEXT.slice(m.start, m.end))).toEqual(["I froze in the meeting", "The shame", "made it worse"]);
    expect(marks[2]).toMatchObject({ ids: [], labels: ["Worse"] });
    const parts = markedRuns("abcdef", [
      { start: 1, end: 4, ids: ["x"], labels: ["X"] },
      { start: 2, end: 5, ids: ["y"], labels: [] },
    ]);
    expect(parts.map((p) => [p.text, p.ids.join()])).toEqual([
      ["a", ""],
      ["b", "x"],
      ["cd", "x,y"],
      ["e", "y"],
      ["f", ""],
    ]);
  });

  it("pairs messages with their replies and tracks the budget", () => {
    const messages = [user("a", "1"), reply([], { contextTokens: 5 }), user("b", "2"), reply([{ type: "text", text: "c" }])];
    expect(repliesTo(messages, 0)).toHaveLength(1);
    expect(repliesTo(messages, 2)).toHaveLength(1);
    expect(textOf(messages[3])).toBe("c");
    expect([isSilent(messages[1]), isSilent(messages[3]), isSilent(messages[0]), isSilent(undefined)]).toEqual([true, false, false, false]);
    expect(latestTokens(messages, 1)).toBe(5);
    expect(latestTokens([], 1)).toBe(1);
    expect([budgetLevel(1, 10), budgetLevel(7, 10), budgetLevel(9, 10), budgetLevel(1, 0)]).toEqual(["ok", "warn", "full", "ok"]);
    expect(isFullError(new Error('{"error":"This conversation is full."}'))).toBe(true);
    expect(isFullError(undefined)).toBe(false);
    expect(errorText(new Error('{"error":"Nope"}'))).toBe("Nope");
    expect(errorText(new Error("{}"))).toBe("{}");
    expect(errorText(new Error("plain"))).toBe("plain");
  });
});

describe("tool cards", () => {
  it("show look-ups quietly and changes with their items and Undo", async () => {
    const onSelect = vi.fn();
    const onOpenEntry = vi.fn();
    render(<ToolCard part={tool("search_graph", "input-available")} onSelect={onSelect} onOpenEntry={onOpenEntry} />);
    expect(screen.getByText(/Searched your map/)).toBeTruthy();
    render(<ToolCard part={tool("add_to_graph", "output-available", { output: added })} onSelect={onSelect} onOpenEntry={onOpenEntry} />);
    fireEvent.click(screen.getByText("Freezing"));
    expect(onSelect).toHaveBeenCalledWith(["n7"]);
    fireEvent.click(screen.getByText("Undo"));
    expect(await screen.findByText("Undone")).toBeTruthy();
    expect(calls.at(-1)).toMatchObject({ url: "/api/undo-session", body: { session: "s9" } });
    render(<ToolCard part={tool("record_entry", "output-available", { output: { entry: "h1", title: "Tuesday" } })} onSelect={onSelect} onOpenEntry={onOpenEntry} />);
    fireEvent.click(screen.getByText("Saved as an entry: Tuesday"));
    expect(onOpenEntry).toHaveBeenCalledWith("h1");
    render(<ToolCard part={tool("remove", "input-available")} onSelect={onSelect} onOpenEntry={onOpenEntry} />);
    render(<ToolCard part={tool("amend", "output-error", { errorText: "Bad id" })} onSelect={onSelect} onOpenEntry={onOpenEntry} />);
    expect(screen.getByText("Bad id")).toBeTruthy();
  });

  it("say when Undo fails", async () => {
    routes["POST /api/undo-session"] = () => json({ error: "Already undone" }, 409);
    render(<ToolCard part={tool("remove", "output-available", { output: { session: "s", removed: [] } })} onSelect={vi.fn()} onOpenEntry={vi.fn()} />);
    fireEvent.click(screen.getByText("Undo"));
    expect(await screen.findByText("Already undone")).toBeTruthy();
  });

  it("contain a message that cannot render", () => {
    const Broken = () => {
      throw new Error("bad part");
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <MessageBoundary>
        <Broken />
      </MessageBoundary>,
    );
    expect(screen.getByText("This message couldn't be shown.")).toBeTruthy();
  });
});

describe("the composer", () => {
  it("sends on Enter, keeps Shift+Enter for new lines, and stops a turn", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(<Composer busy={false} footer="Private" share={0.2} onSend={onSend} onStop={onStop} />);
    const box = screen.getByLabelText("Message");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hello");
    rerender(<Composer busy draft="from a suggestion" footer="Private" share={0.8} onSend={onSend} onStop={onStop} />);
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("from a suggestion");
    fireEvent.click(screen.getByLabelText("Stop"));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows the selection, a warning as the conversation fills, and the end", () => {
    const onRemove = vi.fn();
    const onSelect = vi.fn();
    const onClear = vi.fn();
    const items = [
      { id: "a", kind: "node" as const, type: "part", label: "A", status: "active" as const, confirmed: false },
      { id: "b", kind: "node" as const, type: "part", label: "B", status: "active" as const, confirmed: false },
    ];
    const { container } = render(<SelectionChips items={[]} onRemove={onRemove} onSelect={onSelect} onClear={onClear} />);
    expect(container.innerHTML).toBe("");
    render(<SelectionChips items={items} onRemove={onRemove} onSelect={onSelect} onClear={onClear} />);
    fireEvent.click(screen.getByText("A"));
    fireEvent.click(screen.getByLabelText("Unselect B"));
    fireEvent.click(screen.getAllByText("clear")[0]);
    expect([onSelect.mock.calls[0][0], onRemove.mock.calls[0][0], onClear.mock.calls.length]).toEqual([["a"], "b", 1]);
    const many = Array.from({ length: 7 }, (_, i) => ({ ...items[0], id: `m${i}`, label: `M${i}` }));
    render(<SelectionChips items={many} onRemove={onRemove} onSelect={onSelect} onClear={onClear} />);
    expect(screen.queryByText("M5")).toBeNull();
    fireEvent.click(screen.getByText("+3 more"));
    expect(screen.getByText("M6")).toBeTruthy();
    render(<BudgetNotice level="warn" share={0.74} />);
    expect(screen.getByText(/74% of its room/)).toBeTruthy();
    const onNewChat = vi.fn();
    render(<FullNotice onNewChat={onNewChat} />);
    fireEvent.click(screen.getByText("Start a new conversation"));
    expect(onNewChat).toHaveBeenCalled();
    render(<ContextMeter share={1.4} />);
    expect(screen.getByLabelText("140% of this conversation's room used")).toBeTruthy();
    expect(render(<BudgetNotice level="ok" share={0.1} />).container.innerHTML).toBe("");
  });

  it("says where messages go", () => {
    expect(footerFor(undefined)).toBe("");
    expect(footerFor(SETTINGS)).toBe("Private to this device, using gemma");
    expect(footerFor({ ...SETTINGS, provider: "openrouter", hosted: true })).toContain("through OpenRouter");
    expect(footerFor({ ...SETTINGS, hosted: true })).toContain("off this device");
    expect(footerFor({ ...SETTINGS, provider: "chatgpt", hosted: true })).toContain("through your ChatGPT plan");
  });
});

describe("rails and settings", () => {
  it("list, open, rename and delete conversations", () => {
    const handlers = { onOpen: vi.fn(), onNew: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onSettings: vi.fn(), chatOpen: true, onToggleChat: vi.fn() };
    const chat = {
      id: "c",
      title: "Monday",
      createdAt: "",
      updatedAt: new Date().toISOString(),
      contextTokens: 0,
      budget: { contextTokens: 0, contextWindow: 1, level: "full" as const },
    };
    const { rerender } = render(<ChatRail chats={[]} {...handlers} />);
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    rerender(<ChatRail chats={[chat]} active="c" {...handlers} />);
    expect(screen.getByText(/just now \(full\)/)).toBeTruthy();
    fireEvent.click(screen.getByText("Monday"));
    fireEvent.click(screen.getByLabelText("New conversation"));
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByLabelText("Delete Monday"));
    fireEvent.doubleClick(screen.getByText("Monday"));
    const input = screen.getByLabelText("Conversation title");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onRename).toHaveBeenCalledWith("c", "Renamed");
    expect([handlers.onOpen, handlers.onNew, handlers.onSettings, handlers.onDelete].every((f) => f.mock.calls.length === 1)).toBe(true);
  });

  it("say how long ago", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    expect([ago(at(0), now), ago(at(5), now), ago(at(180), now), ago(at(60 * 50), now)]).toEqual(["just now", "5m ago", "3h ago", "2d ago"]);
    expect(ago(at(60 * 24 * 30), now)).toMatch(/Aug/);
  });

  it("switch views from the right rail", () => {
    const onToggle = vi.fn();
    render(<ViewRail active="map" onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: /Map/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Loops/ }));
    expect(onToggle).toHaveBeenCalledWith("loops");
  });

  it("save the provider, model and budget", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    routes["PUT /api/chat/settings"] = () => json({ ...SETTINGS, provider: "openrouter" });
    render(<SettingsDialog settings={SETTINGS} onSaved={onSaved} onClose={onClose} />);
    expect(screen.getByLabelText(/Server address/)).toBeTruthy();
    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.change(screen.getByLabelText(/OpenRouter key/), { target: { value: "sk-or-x" } });
    fireEvent.change(screen.getByLabelText(/Conversation length/), { target: { value: "150000" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.at(-1)?.body).toEqual({ provider: "openrouter", apiKey: "sk-or-x", contextWindow: 150000 });
    routes["PUT /api/chat/settings"] = () => json({ error: "Bad model" }, 400);
    fireEvent.click(screen.getByText("Local model"));
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Bad model")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
    render(<SettingsDialog settings={{ ...SETTINGS, provider: "openrouter", hasKey: true }} onSaved={onSaved} onClose={onClose} />);
    expect(screen.getByText(/A key is saved/)).toBeTruthy();
  });

  it("connect a ChatGPT plan with a code, then pick its model and reasoning", { timeout: 15_000 }, async () => {
    linkPoll.ms = 10;
    const states = [
      { state: "pending", userCode: "ABCD-1234", url: "https://auth.openai.com/codex/device" },
      { state: "connected", plan: "pro", email: "me@example.com" },
    ];
    routes["GET /api/chat/chatgpt"] = () => json({ state: "disconnected" });
    routes["POST /api/chat/chatgpt"] = () => json(states[0]);
    routes["PUT /api/chat/settings"] = () => json({ ...SETTINGS, provider: "chatgpt" });
    const onSaved = vi.fn();
    render(<SettingsDialog settings={SETTINGS} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("ChatGPT plan"));
    fireEvent.click(await screen.findByText("Connect ChatGPT"));
    expect(await screen.findByText("ABCD-1234")).toBeTruthy();
    expect(
      screen
        .getByText(/Open OpenAI/)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("https://auth.openai.com/codex/device");
    fireEvent.click(screen.getByLabelText("Copy code"));
    routes["GET /api/chat/chatgpt"] = () => json(states[1]);
    expect(await screen.findByText(/Connected on the pro plan/, {}, { timeout: 5000 })).toBeTruthy();
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("gpt-6-sol");
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.5" } });
    fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "high" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.at(-1)?.body).toMatchObject({ provider: "chatgpt", model: "gpt-5.5", effort: "high" });
    routes["DELETE /api/chat/chatgpt"] = () => json({ state: "disconnected", error: "Signed out" });
    fireEvent.click(screen.getByText("Disconnect"));
    expect(await screen.findByText("Signed out")).toBeTruthy();
    linkPoll.ms = 2500;
  });

  it("keep a custom plan model and cancel a pending sign-in", async () => {
    routes["GET /api/chat/chatgpt"] = () => json({ state: "pending", userCode: "Z", url: "u" });
    routes["DELETE /api/chat/chatgpt"] = () => json({ error: "offline" }, 500);
    render(<SettingsDialog settings={{ ...SETTINGS, provider: "chatgpt", model: "gpt-custom", effort: "odd" }} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("gpt-custom");
    expect((screen.getByLabelText("Reasoning") as HTMLSelectElement).value).toBe("medium");
    fireEvent.click(await screen.findByText("Cancel", { selector: "button.w-full" }));
    expect(await screen.findByText("offline")).toBeTruthy();
  });
});

const actions = () => ({
  onSelect: vi.fn(),
  onOpenEntry: vi.fn(),
  onNewChat: vi.fn(),
  onOpenSettings: vi.fn(),
  onTurnEnd: vi.fn(),
  onDeselect: vi.fn(),
  onClearSelection: vi.fn(),
});

describe("a conversation", () => {
  it("greets, sends a turn, shows its cards and highlights, and warns as it fills", async () => {
    const handlers = actions();
    render(<ChatView id="new" selection={[]} settings={SETTINGS} {...handlers} />);
    fireEvent.click(await screen.findByText("What's on my map so far?"));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: TEXT } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(await screen.findByText("Added 2 things to your map")).toBeTruthy();
    expect(await screen.findByText(/Does that fit/)).toBeTruthy();
    expect(screen.getByText("Searched your map")).toBeTruthy();
    expect(calls.find((c) => c.url === "/api/chat")?.body).toMatchObject({ id: "new", message: { role: "user", parts: [{ type: "text", text: TEXT }] } });
    fireEvent.click(screen.getByTitle("On your map: Freezing"));
    expect(handlers.onSelect).toHaveBeenCalledWith(["n7"]);
    fireEvent.keyDown(screen.getByTitle("On your map: Shame"), { key: "Enter" });
    expect(handlers.onSelect).toHaveBeenLastCalledWith(["n8"]);
    expect(await screen.findByText(/75% of its room/)).toBeTruthy();
    await waitFor(() => expect(handlers.onTurnEnd).toHaveBeenCalled());
  });

  it("loads an earlier conversation and ends a full one", async () => {
    routes["POST /api/chat"] = () => json({ error: "This conversation is full. Start a new one to keep going." }, 409);
    const handlers = actions();
    render(<ChatView id="old" selection={[]} settings={{ ...SETTINGS, provider: "openrouter", hasKey: false, hosted: true }} {...handlers} />);
    expect(await screen.findByText("Earlier words")).toBeTruthy();
    fireEvent.click(screen.getByText("Open settings"));
    expect(handlers.onOpenSettings).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "more" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
    expect(await screen.findByText("This conversation is full.")).toBeTruthy();
  });

  it("says when a reply had no words", async () => {
    routes["POST /api/chat"] = () => sse([TURN[0], TURN[1], TURN[4], TURN[5], TURN[8], { type: "finish", finishReason: "stop" }]);
    render(<ChatView id="quiet" selection={[]} {...actions()} />);
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(await screen.findByText(/stopped without replying/)).toBeTruthy();
  });

  it("shows other errors in the conversation", async () => {
    routes["POST /api/chat"] = () => json({ error: "Add an OpenRouter key in Settings" }, 400);
    render(<ChatView id="x" selection={[]} {...actions()} />);
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(await screen.findByText("Add an OpenRouter key in Settings")).toBeTruthy();
  });
});

describe("the app shell", () => {
  it("hides the chat from the left rail and never closes both sides", async () => {
    render(<App />);
    const main = await screen.findByRole("main");
    fireEvent.click(screen.getByLabelText("Chat"));
    expect(main.className).toContain("hidden");
    fireEvent.click(screen.getByRole("button", { name: /Map/ }));
    expect(main.className).not.toContain("hidden");
    expect(screen.queryByTestId("graph-canvas")).toBeNull();
    fireEvent.click(screen.getByLabelText("Chat"));
    expect(await screen.findByTestId("graph-canvas")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("New conversation"));
    expect(main.className).not.toContain("hidden");
    fireEvent.click(screen.getByLabelText("Chat"));
    fireEvent.click(await screen.findByText("Earlier"));
    expect(main.className).not.toContain("hidden");
  });

  it("puts the conversation beside a view, and links them", async () => {
    render(<App />);
    expect(await screen.findByText("What's on your mind?")).toBeTruthy();
    expect(await screen.findByText("Earlier")).toBeTruthy();
    expect(screen.getByTestId("graph-canvas")).toBeTruthy();
    expect(await screen.findByLabelText("Unselect Freezing")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Unselect Freezing"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url === "/api/selection")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /Map/ }));
    expect(screen.queryByTestId("graph-canvas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Log/ }));
    fireEvent.click(screen.getByRole("button", { name: /Loops/ }));
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Earlier"));
    expect(await screen.findByText("Earlier words")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("New conversation"));
    expect(await screen.findByText("What's on your mind?")).toBeTruthy();
  });

  it("sends a turn, opens its entry and items, and deletes and renames conversations", async () => {
    routes["DELETE /api/chats/old"] = () => json({ removed: true });
    routes["PATCH /api/chats/old"] = () => json({});
    routes["PUT /api/chat/settings"] = () => json(SETTINGS);
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: TEXT } });
    fireEvent.click(screen.getByLabelText("Send"));
    fireEvent.click(await screen.findByText("Saved as an entry: The meeting"));
    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/entries"))).toBe(true));
    fireEvent.click(screen.getAllByRole("button", { name: "Freezing" })[0]);
    await waitFor(() => expect(screen.getByTestId("graph-canvas")).toBeTruthy());
    fireEvent.click(screen.getByText("Earlier"));
    fireEvent.click(await screen.findByLabelText("Delete Earlier"));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    fireEvent.doubleClick(screen.getByText("Earlier"));
    fireEvent.blur(screen.getByLabelText("Conversation title"), { target: { value: "New name" } });
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(await screen.findByText("Save"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => undefined);
  });
});
