// Seeded conversations for the best-case Vault: each shows the assistant doing something it can do
// (recording an entry, merging, splitting, renaming, removing and restoring, exploring loops and
// roots). Every tool call really runs, through the same tools the in-app chat uses, so the cards,
// their Undo buttons and the map all agree.
import type { ToolSet } from "ai";
import { chatTools } from "../../src/clients/chat.js";
import { modelActor } from "../../src/utilities/chatModel.js";
import type { ModelGateway } from "../../src/utilities/modelGateway.js";
import type { Vault } from "../../src/vault.js";

const ACTOR = modelActor("claude-opus-5.5");

/**
 * Stands in for the model where a tool asks it for judgement (a split sharing out evidence): each
 * numbered line goes to the part whose name its text shares a stem with, else the first.
 */
export const splitGateway: ModelGateway = {
  name: "seed",
  hosted: false,
  async generateJson({ user }) {
    const parts = [...user.matchAll(/\((\d+)\) ([^,\n]+)/g)].map((m) => m[2].trim().slice(0, 5).toLowerCase());
    const owner = (line: string) => Math.max(0, parts.findIndex((stem) => line.toLowerCase().includes(stem)));
    const section = (name: string) => (user.split(`${name}:\n`)[1] ?? "").split(/\n[A-Z]\w+:\n|\nReturn/)[0].split("\n").filter((l) => l.startsWith("["));
    const assign = (lines: string[], i: number) => lines.flatMap((l, k) => (owner(l) === i ? [k] : []));
    return { parts: parts.map((_, i) => ({ evidence: assign(section("Evidence"), i), edges: assign(section("Edges"), i) })) };
  },
};

interface Part {
  type: string;
  [key: string]: unknown;
}

/** One assistant turn, built by running tools and saying things. */
class Turn {
  readonly parts: Part[] = [];
  private readonly tools: ToolSet;

  constructor(vault: Vault, userText: string) {
    this.tools = chatTools(vault, ACTOR, userText);
  }

  async call<T = Record<string, unknown>>(name: string, input: Record<string, unknown>): Promise<T> {
    const toolCallId = `call-${name}-${this.parts.length}`;
    const execute = this.tools[name].execute;
    if (!execute) throw new Error(`${name} cannot run`);
    const output = JSON.parse(JSON.stringify(await execute(input, { toolCallId, messages: [], context: {} })));
    this.parts.push({ type: `tool-${name}`, toolCallId, state: "output-available", input, output });
    return output as T;
  }

  say(text: string): void {
    this.parts.push({ type: "text", text });
  }
}

type Script = (turn: Turn) => Promise<void>;

async function seedChat(vault: Vault, title: string, exchanges: [string, Script][]): Promise<void> {
  const chat = vault.chat.create(undefined, title);
  const messages: unknown[] = [];
  for (const [said, script] of exchanges) {
    const turn = new Turn(vault, said);
    await script(turn);
    messages.push({ id: `u${messages.length}`, role: "user", parts: [{ type: "text", text: said }] });
    messages.push({ id: `a${messages.length}`, role: "assistant", parts: turn.parts });
  }
  vault.chat.save(chat.chat.id, messages, 0);
}

interface Hits {
  hits: { id: string; label: string }[];
}

/** Looks a name up as the assistant would, and returns the id of the hit with that exact label. */
async function find(turn: Turn, query: string, label: string): Promise<string> {
  const { hits } = await turn.call<Hits>("search_graph", { query, limit: 10 });
  const hit = hits.find((h) => h.label === label);
  if (!hit) throw new Error(`search_graph "${query}" did not find ${label}`);
  return hit.id;
}

const JOURNAL = "Couldn't sleep again, doomscrolled until 2am. The part that scrolls was running the show. This morning I woke up exhausted and ashamed of wasting the night.";

const journaling: [string, Script][] = [
  [
    JOURNAL,
    async (turn) => {
      const { entry } = await turn.call<{ entry: string }>("record_entry", { title: "Up until 2am" });
      const scroller = await find(turn, "the scroller", "The Scroller");
      await turn.call("add_to_graph", {
        entry,
        nodes: [
          { ref: "scroller", existing_id: scroller, type: "part", label: "The Scroller", confidence: 0.85, quotes: ["The part that scrolls was running the show"] },
          { ref: "doom", type: "policy", label: "Doomscrolling", attributes: { kind: "avoid" }, confidence: 0.8, quotes: ["doomscrolled until 2am"] },
          { ref: "tired", type: "process_node", label: "Exhausted and ashamed", confidence: 0.7, quotes: ["woke up exhausted", "ashamed of wasting the night"] },
        ],
        edges: [
          { from: "scroller", to: "doom", type: "enacts", confidence: 0.8, quotes: ["The part that scrolls was running the show"] },
          { from: "doom", to: "tired", type: "reinforces", sign: "+", confidence: 0.75, quotes: ["doomscrolled until 2am", "woke up exhausted"] },
        ],
      });
      turn.say("I've saved that as “Up until 2am”. The Scroller was already on your map, so I linked it to a new habit, Doomscrolling, which feeds how exhausted and ashamed you felt this morning. Does that fit?");
    },
  ],
];

/** What the tidying chat took off the map, so it can put it back. */
let removed = "";

const tidying: [string, Script][] = [
  [
    "Doomscrolling and Keep scrolling are the same thing really. Can you merge them?",
    async (turn) => {
      const doom = await find(turn, "doomscrolling", "Doomscrolling");
      const keep = await find(turn, "keep scrolling", "Keep scrolling");
      await turn.call("merge_nodes", { ids: [keep, doom], label: "Keep scrolling" });
      await turn.call("find_duplicates", {});
      await turn.call("merge_duplicates", {});
      turn.say("Done: they're one node now, “Keep scrolling”, with the links and passages of both. That left The Scroller linked to it twice, so I folded those two links together too.");
    },
  ],
  [
    "“Exhausted and ashamed” is two different things.",
    async (turn) => {
      const id = await find(turn, "exhausted and ashamed", "Exhausted and ashamed");
      await turn.call("split_node", { id, parts: ["Exhaustion", "Shame"] });
      turn.say("I've split it into Exhaustion and Shame, and shared the passages out between them.");
    },
  ],
  [
    "Can you call “Protected parts” The Exiles instead?",
    async (turn) => {
      const id = await find(turn, "protected parts", "Protected parts");
      await turn.call("amend", { changes: [{ id, label: "The Exiles" }] });
      turn.say("Renamed to “The Exiles”.");
    },
  ],
  [
    "I don't think “Resist doing” is right, take it off.",
    async (turn) => {
      removed = await find(turn, "resist doing", "Resist doing");
      await turn.call("remove", { ids: [removed], reason: "The person doesn't think it fits" });
      turn.say("Taken off the map. It's kept in history if you change your mind.");
    },
  ],
  [
    "Actually, put it back.",
    async (turn) => {
      await turn.call("recent_changes", { limit: 1 });
      await turn.call("restore", { id: removed });
      turn.say("It's back, as it was.");
    },
  ],
];

const exploring: [string, Script][] = [
  [
    "What loops keep me stuck?",
    async (turn) => {
      await turn.call("find_loops", {});
      turn.say(
        "There are three. Two feed themselves: the Hider, the Dissociator and the Controller each push the next harder, and the Controller and Keep scrolling wind each other up. One settles itself: rumination tightens your chest, a tight chest sends you for a walk, and walking quiets the rumination. Would it help to look at what that walk does that the other two loops are missing?",
      );
    },
  ],
  [
    "Why do I expect people to get annoyed when I ask for things?",
    async (turn) => {
      const id = await find(turn, "people get annoyed when I ask", "If I ask, people get annoyed");
      await turn.call("trace_roots", { id });
      turn.say("It traces back to being laughed at over your homework at seven: from that you took “needing help makes me a burden”, and the expectation grew out of that belief. Does that sound right to you?");
    },
  ],
];

export async function seedChats(vault: Vault): Promise<void> {
  await seedChat(vault, "Up until 2am", journaling);
  await seedChat(vault, "Tidying up the map", tidying);
  await seedChat(vault, "Loops and roots", exploring);
}
