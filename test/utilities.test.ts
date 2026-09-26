import { describe, expect, it } from "vitest";
import { byteOffset, newId, newKey, sha256, utf8 } from "../src/utilities/crypto.js";
import { components, elementaryCycles, hasPath, reachable, shortestPath } from "../src/utilities/graphAlgo.js";
import { HlcClock, decodeHlc, encodeHlc, hlcAtTime, hlcToDate } from "../src/utilities/hlc.js";
import { JobQueue } from "../src/utilities/jobQueue.js";
import { OllamaGateway, ScriptedGateway, isLocalUrl } from "../src/utilities/modelGateway.js";

describe("HLC", () => {
  it("encodes to a lexically ordered string and decodes back", () => {
    const hlc = encodeHlc({ wall: 1700000000000, counter: 3, device: "dev.a" });
    expect(decodeHlc(hlc)).toEqual({ wall: 1700000000000, counter: 3, device: "dev.a" });
    expect(hlcToDate(hlc).getTime()).toBe(1700000000000);
    expect(encodeHlc({ wall: 9, counter: 0, device: "z" }) < encodeHlc({ wall: 10, counter: 0, device: "a" })).toBe(true);
  });

  it("stays monotonic when the wall clock stalls or goes backwards", () => {
    const times = [100, 100, 50, 200];
    const clock = new HlcClock("d", () => times.shift() as number);
    const ticks = [clock.tick(), clock.tick(), clock.tick(), clock.tick()];
    expect([...ticks].sort()).toEqual(ticks);
    expect(decodeHlc(ticks[2])).toEqual({ wall: 100, counter: 2, device: "d" });
    expect(decodeHlc(ticks[3]).counter).toBe(0);
  });

  it("advances past remote timestamps", () => {
    const clock = new HlcClock("d", () => 10, encodeHlc({ wall: 5, counter: 0, device: "d" }));
    clock.receive(encodeHlc({ wall: 500, counter: 7, device: "other" }));
    expect(decodeHlc(clock.tick())).toEqual({ wall: 500, counter: 8, device: "d" });
    clock.receive(encodeHlc({ wall: 1, counter: 0, device: "old" }));
    expect(decodeHlc(clock.tick()).wall).toBe(500);
  });

  it("bounds every event at an instant", () => {
    expect(encodeHlc({ wall: 100, counter: 5, device: "x" }) < hlcAtTime(100)).toBe(true);
    expect(hlcAtTime(100) < encodeHlc({ wall: 101, counter: 0, device: "x" })).toBe(true);
  });
});

describe("crypto", () => {
  it("hashes, generates ids and keys, and measures byte offsets", () => {
    expect(sha256(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(newId()).toMatch(/^[0-9A-Z]{26}$/);
    expect(newKey()).toMatch(/^[0-9a-f]{64}$/);
    expect(byteOffset("héllo", 2)).toBe(3);
  });
});

describe("graph algorithms", () => {
  const arcs = [
    { id: "ab", from: "a", to: "b" },
    { id: "bc", from: "b", to: "c" },
    { id: "ca", from: "c", to: "a" },
    { id: "cd", from: "c", to: "d" },
    { id: "dd", from: "d", to: "d" },
  ];

  it("computes reachability in both directions", () => {
    expect(reachable(arcs, "d")).toEqual(new Set(["d"]));
    expect(reachable(arcs, "d", "in")).toEqual(new Set(["a", "b", "c", "d"]));
    expect(hasPath(arcs, "a", "d")).toBe(true);
    expect(hasPath(arcs, "d", "a")).toBe(false);
  });

  it("finds shortest paths", () => {
    expect(shortestPath(arcs, "a", "d")).toEqual(["a", "b", "c", "d"]);
    expect(shortestPath(arcs, "d", "a")).toBeNull();
  });

  it("enumerates each elementary cycle once", () => {
    const cycles = elementaryCycles(arcs).map((c) => c.map((a) => a.id));
    expect(cycles).toEqual([["ab", "bc", "ca"], ["dd"]]);
    expect(elementaryCycles(arcs, 1)).toHaveLength(1);
  });

  it("groups connected components", () => {
    expect(components([{ id: "1", from: "x", to: "y" }, { id: "2", from: "z", to: "y" }, { id: "3", from: "p", to: "q" }])).toEqual([
      ["x", "y", "z"],
      ["p", "q"],
    ]);
  });
});

describe("JobQueue", () => {
  it("runs jobs in order and records failures", async () => {
    const queue = new JobQueue();
    const order: string[] = [];
    queue.enqueue("1", "a", async () => void order.push("a"));
    queue.enqueue("2", "b", async () => {
      throw new Error("boom");
    });
    queue.enqueue("3", "c", async () => {
      throw "plain";
    });
    await queue.idle();
    expect(order).toEqual(["a"]);
    expect(queue.get("2")).toMatchObject({ state: "failed", error: "boom" });
    expect(queue.get("3")?.error).toBe("plain");
    expect(queue.list()).toHaveLength(3);
  });
});

describe("ModelGateway", () => {
  it("knows which URLs stay on this device", () => {
    expect(isLocalUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalUrl("http://model.localhost")).toBe(true);
    expect(isLocalUrl("https://api.example.com")).toBe(false);
  });

  it("calls the Ollama chat endpoint with a JSON schema", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ message: { content: '{"ok":true}' } }));
    }) as typeof fetch;
    const gateway = new OllamaGateway({ model: "m", fetchImpl });
    expect(gateway.hosted).toBe(false);
    expect(await gateway.generateJson({ system: "s", user: "u", schema: { type: "object" } })).toEqual({ ok: true });
    expect(calls[0].url).toBe("http://127.0.0.1:11434/api/chat");
    expect(calls[0].body).toMatchObject({ model: "m", format: { type: "object" }, stream: false });
  });

  it("surfaces runtime errors and empty replies", async () => {
    const failing = new OllamaGateway({ baseUrl: "https://hosted.example", fetchImpl: (async () => new Response("", { status: 500 })) as typeof fetch });
    expect(failing.hosted).toBe(true);
    await expect(failing.generateJson({ system: "", user: "", schema: {} })).rejects.toThrow("500");
    const empty = new OllamaGateway({ fetchImpl: (async () => new Response("{}")) as typeof fetch });
    expect(await empty.generateJson({ system: "", user: "", schema: {} })).toEqual({});
  });

  it("replays scripted responses", async () => {
    const gateway = new ScriptedGateway([{ a: 1 }]);
    expect(await gateway.generateJson({ system: "", user: "q", schema: {} })).toEqual({ a: 1 });
    expect(gateway.requests[0].user).toBe("q");
    await expect(gateway.generateJson({ system: "", user: "", schema: {} })).rejects.toThrow();
  });
});
