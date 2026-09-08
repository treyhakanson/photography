import { describe, expect, it } from "vitest";
import {
  TIERS, fillRate, narrow, place, roundHalfEven, spans,
} from "../../scripts/layout.ts";

describe("roundHalfEven", () => {
  it("breaks ties to even, like Python's round()", () => {
    // The reason this exists: Math.round(4.5) is 5, Python's round(4.5) is 4,
    // and narrow() lands on exact halves.
    expect(roundHalfEven(4.5)).toBe(4);
    expect(roundHalfEven(7.5)).toBe(8);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
  });
  it("rounds normally away from ties", () => {
    expect(roundHalfEven(4.4)).toBe(4);
    expect(roundHalfEven(4.6)).toBe(5);
  });
});

describe("spans", () => {
  it("puts a 4:3 photo on exactly span 4 / span 3", () => {
    expect(spans(4 / 3, 12, 2, 5)).toEqual([4, 3]);
  });
  it("keeps a square from being dwarfed by a widescreen", () => {
    const [sc, sr] = spans(1, 12, 2, 5);
    const [wc, wr] = spans(16 / 9, 12, 2, 5);
    // The point of normalizing on area: the two cover comparable ground rather
    // than the square shrinking to a fraction of the widescreen. The max-span
    // clamp keeps it from being exact, so assert the property, not a number.
    const ratio = (wc * wr) / (sc * sr);
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(2);
  });
  it("clamps to the span limits", () => {
    expect(spans(100, 12, 2, 5)[0]).toBe(5);
    expect(spans(0.01, 12, 2, 5)[0]).toBe(2);
  });
});

describe("narrow", () => {
  it("refits everything to a half row or a full one", () => {
    for (let c = 2; c <= 5; c++) {
      for (let r = 2; r <= 5; r++) {
        expect([3, 6]).toContain(narrow([c, r], 6)[0]);
      }
    }
  });
  it("never collapses a row span to zero", () => {
    expect(narrow([5, 1], 6)[1]).toBeGreaterThanOrEqual(1);
  });
});

describe("place", () => {
  it("fills a row exactly with no waste", () => {
    const { rows, filled } = place([[6, 1], [6, 1]], 12);
    expect(rows).toBe(1);
    expect(filled).toBe(12);
  });
  it("backfills a hole with a later item, like dense flow", () => {
    // A 3-wide leaves 9 columns; the 9-wide cannot fit beside it, but the
    // 9-wide placed first would leave a 3 pocket the later tile slots into.
    expect(fillRate([[9, 1], [3, 1]], 12)).toBe(1);
  });
  it("reports the holes an unfillable order leaves", () => {
    expect(fillRate([[5, 1], [5, 1]], 12)).toBeLessThan(1);
  });
  it("clamps a span wider than the grid", () => {
    expect(() => place([[12, 1]], 6)).not.toThrow();
    expect(place([[12, 1]], 6).filled).toBe(6);
  });
});

describe("TIERS", () => {
  it("descends by viewport width so the first match wins", () => {
    const widths = TIERS.map(([w]) => w);
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
  });
});
