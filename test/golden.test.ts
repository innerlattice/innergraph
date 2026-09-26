// Golden decompositions of the real fixtures (experiments/best-case). They pin down what a
// good decomposition looks like, so interpretation pipelines can be compared against them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestVault, makeVault } from "./helpers.js";

const EXPERIMENT = join(import.meta.dirname, "..", "experiments", "best-case");
const FIXTURES = join(import.meta.dirname, "fixtures");

function ingestGolden(t: TestVault, file: string) {
  const plan = JSON.parse(readFileSync(join(EXPERIMENT, file), "utf8"));
  const { entry } = t.vault.ingest.addEntry({ content: readFileSync(join(FIXTURES, plan.fixture), "utf8") }, { interpret: false });
  const result = t.vault.ingest.propose("agent:golden", entry, plan);
  return { plan, result };
}

function labelOf(t: TestVault, id: string): string {
  return t.vault.explore.graph().nodes[id].label;
}

let t: TestVault;
beforeEach(() => {
  t = makeVault();
});
afterEach(() => t.cleanup());

describe("golden decompositions", () => {
  it.each(["entry-1-scrolling.json", "entry-2-controller-hider.json"])("%s cites only text that exists in the Entry", (file) => {
    const { plan, result } = ingestGolden(t, file);
    expect(result.dropped).toEqual([]);
    expect(Object.keys(t.vault.explore.graph().nodes)).toHaveLength(plan.nodes.length);
    expect(Object.keys(t.vault.explore.graph().edges)).toHaveLength(plan.edges.length);
  });

  it("entry 2 yields a reinforcing loop through the Controller and the Hider", () => {
    ingestGolden(t, "entry-2-controller-hider.json");
    const loops = t.vault.explore.findLoops();
    expect(loops).toHaveLength(1);
    expect(loops[0].polarity).toBe("reinforcing");
    expect(loops[0].nodes.map((id) => labelOf(t, id))).toEqual(expect.arrayContaining(["The Controller", "The Hider", "The Dissociator"]));
  });
});
