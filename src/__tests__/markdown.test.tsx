import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderCaption } from "../lib/markdown.tsx";

const show = (raw: string) => {
  const { container } = render(<p>{renderCaption(raw)}</p>);
  return container.querySelector("p")!;
};

describe("caption markdown", () => {
  it("leaves plain text alone", () => {
    const el = show("Just a caption, with (parens) and [brackets].");
    expect(el.textContent).toBe("Just a caption, with (parens) and [brackets].");
    expect(el.querySelectorAll("a")).toHaveLength(0);
  });

  it("turns [text](url) into a link opening in a new tab", () => {
    const el = show("See [David Hume](https://example.com/hume) for more.");
    const a = el.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/hume");
    expect(a.textContent).toBe("David Hume");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(el.textContent).toBe("See David Hume for more.");
  });

  it("keeps the prose around several links", () => {
    const el = show("[one](https://a.example) then [two](https://b.example) end");
    expect(el.querySelectorAll("a")).toHaveLength(2);
    expect(el.textContent).toBe("one then two end");
  });

  it("allows mailto and relative links", () => {
    expect(show("[mail](mailto:a@b.example)").querySelector("a")).toBeTruthy();
    expect(show("[rel](../elsewhere)").querySelector("a")).toBeTruthy();
    expect(show("[anchor](#top)").querySelector("a")).toBeTruthy();
  });

  it("refuses javascript: and data: and leaves the source visible", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>"]) {
      const el = show(`click [here](${bad}) now`);
      expect(el.querySelectorAll("a")).toHaveLength(0);
      expect(el.textContent).toContain("[here]");
    }
  });

  it("renders markup in a caption as literal text", () => {
    const el = show("Not markup: <script>alert(1)</script> & <b>bold</b>.");
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toContain("<script>alert(1)</script>");
  });

  it("cannot be fooled into injecting through the link text", () => {
    const el = show('[<img src=x onerror=alert(1)>](https://ok.example)');
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("a")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("leaves malformed syntax as written", () => {
    expect(show("[no closing paren](https://x.example").querySelectorAll("a")).toHaveLength(0);
    expect(show("[](https://x.example)").querySelectorAll("a")).toHaveLength(0);
  });

  it("is not stateful across calls", () => {
    // A module-level regex with /g carries lastIndex; reusing it without a
    // reset would make every other call silently skip the first match.
    const once = show("[a](https://a.example)").querySelectorAll("a").length;
    const twice = show("[a](https://a.example)").querySelectorAll("a").length;
    expect([once, twice]).toEqual([1, 1]);
  });
});

describe("rendered into the card back", () => {
  it("keeps newlines, as pre-wrap depends on them surviving", () => {
    render(<p className="Back-text">{renderCaption("line one\nline two")}</p>);
    expect(screen.getByText(/line one/).textContent).toContain("\n");
  });
});
