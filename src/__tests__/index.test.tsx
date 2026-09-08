import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { IndexPage } from "../pages/IndexPage.tsx";
import { galleries, manifest } from "../lib/manifest.ts";

const show = () =>
  render(
    <MemoryRouter>
      <IndexPage />
    </MemoryRouter>,
  );

describe("index page", () => {
  it("renders a card per gallery", () => {
    show();
    expect(document.querySelectorAll(".GalleryCard")).toHaveLength(galleries.length);
  });

  it("links each card at its gallery route", () => {
    show();
    for (const gallery of galleries) {
      expect(screen.getByRole("link", { name: new RegExp(gallery.title) })
        .getAttribute("href")).toBe(`/${gallery.slug}`);
    }
  });

  it("counts photos and sections, excluding favorites", () => {
    show();
    const gallery = galleries[0];
    const real = gallery.sections.filter((s) => s.id !== "favorites").length;
    const meta = document.querySelector(".GalleryCard-meta")!.textContent!;
    expect(meta).toContain(`${gallery.photoCount} photos`);
    expect(meta).toContain(`${real} sections`);
    expect(meta).toContain(gallery.updated);
  });

  it("lists the section labels in config order, without favorites", () => {
    show();
    const gallery = galleries[0];
    const want = gallery.sections.filter((s) => s.id !== "favorites").map((s) => s.label);
    expect(document.querySelector(".GalleryCard-sections")!.textContent).toBe(want.join(" · "));
  });

  it("gives the cover a fixed aspect so cards line up", () => {
    show();
    const cover = document.querySelector(".GalleryCard-cover")!;
    // width/height are presentational hints; the stylesheet overrides both so
    // aspect-ratio can take effect. Both attributes must still be present for
    // the browser to reserve space.
    expect(cover.getAttribute("width")).toBeTruthy();
    expect(cover.getAttribute("height")).toBeTruthy();
    expect(cover.getAttribute("alt")).toBe("");
  });

  it("summarises the whole site", () => {
    show();
    const total = galleries.reduce((n, g) => n + g.photoCount, 0);
    const blurb = document.querySelector(".Masthead p")!.textContent!;
    expect(blurb).toContain(`${total} photos`);
    expect(blurb).toContain(`${galleries.length} galler`);
  });

  it("carries the copyright footer", () => {
    show();
    const footer = document.querySelector("footer.Footer")!;
    expect(footer.textContent).toContain(String(manifest.copyright.year));
    expect(footer.textContent).toContain(manifest.copyright.holder);
  });
});
