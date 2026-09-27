import { describe, expect, it } from "vitest";
import { bump, changes, prepend, section, stampVersion } from "../scripts/ship.js";

describe("shipping a version", () => {
  it("bumps semver", () => {
    expect([bump("0.2.9", "patch"), bump("0.2.9", "minor"), bump("0.2.9", "major")]).toEqual(["0.2.10", "0.3.0", "1.0.0"]);
  });

  it("lists every commit since the last version but the release commits", () => {
    expect(changes(["Maps fold", "Release v0.2.0", "", "Loops glow"])).toEqual(["Maps fold", "Loops glow"]);
  });

  it("puts the new version at the top of the changelog", () => {
    const entry = section("0.3.0", "2026-10-01", ["Loops glow"]);
    expect(entry).toBe("## 0.3.0 — 2026-10-01\n\n- Loops glow\n");
    expect(prepend("# Changelog\n\nIntro.\n\n## 0.2.0 — x\n\n- old\n", entry)).toBe("# Changelog\n\nIntro.\n\n## 0.3.0 — 2026-10-01\n\n- Loops glow\n\n## 0.2.0 — x\n\n- old\n");
    expect(prepend("# Changelog\n", entry)).toBe(`# Changelog\n\n${entry}`);
  });

  it("stamps the version wherever the README marks it", () => {
    expect(stampVersion("v<!-- version -->0.1.0<!-- /version --> and <!-- version --><!-- /version -->", "0.2.0")).toBe(
      "v<!-- version -->0.2.0<!-- /version --> and <!-- version -->0.2.0<!-- /version -->",
    );
  });
});
