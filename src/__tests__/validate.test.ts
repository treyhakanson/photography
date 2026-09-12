import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../../plugins/index.ts";

const good = {
  sections: ["favorites", { id: "arch", label: "Architecture" }],
  captions: { arch: { bank: "", wes: { title: "T", favorite: true } } },
};

describe("config validation (the dev write endpoint's gate)", () => {
  it("accepts a well-formed config", () => {
    expect(validate(good)).toBe("");
  });

  it("accepts unknown top-level keys", () => {
    // The editor writes back whatever it read; rejecting a hand-added field
    // would make the file unsaveable.
    expect(validate({ ...good, theme: "dark" })).toBe("");
  });

  it("accepts every real gallery config", () => {
    const files = readdirSync("config").filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const live = JSON.parse(readFileSync(join("config", file), "utf8"));
      expect(validate(live), file).toBe("");
    }
  });

  it("requires captions", () => {
    expect(validate({ sections: [] })).toContain("captions");
  });

  it("rejects a non-object top level", () => {
    expect(validate([])).not.toBe("");
    expect(validate("nope")).not.toBe("");
    expect(validate(null)).not.toBe("");
  });

  it("rejects a sections value that is not an array", () => {
    // A bare string would otherwise iterate per character.
    expect(validate({ sections: "arch", captions: {} })).toContain("array");
    expect(validate({ sections: {}, captions: {} })).toContain("array");
  });

  it("requires every section to carry a non-empty id", () => {
    expect(validate({ sections: [{ label: "x" }], captions: {} })).toContain("id");
    expect(validate({ sections: [{ id: "" }], captions: {} })).toContain("id");
  });

  it("rejects unknown fields on a section and on an entry", () => {
    expect(validate({ sections: [{ id: "a", color: "red" }], captions: {} }))
      .toContain("unknown");
    expect(validate({ captions: { arch: { bank: { note: "x" } } } })).toContain("unknown");
  });

  it("rejects a caption bucket that is not an object", () => {
    expect(validate({ captions: { arch: [] } })).not.toBe("");
    expect(validate({ captions: { arch: { bank: 42 } } })).not.toBe("");
  });
});
