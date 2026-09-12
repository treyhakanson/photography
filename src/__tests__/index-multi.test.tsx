/**
 * The index renders one card per gallery in the manifest, whatever is in it.
 * The manifest is built by scanning config/, so this is the app-side half of
 * "a gallery appears by dropping in a config file".
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Gallery, Photo } from "../types.ts";

function photo(kind: string, name: string): Photo {
  return {
    id: `${kind}/${name}`, kind, name,
    src: `media/g/${kind}/${name}.jpg`, alt: name,
    width: 1200, height: 800, cols: 4, rows: 3,
    title: "", caption: "", favorite: false,
  };
}

function gallery(slug: string, title: string, updated: string, n: number): Gallery {
  const photos = Array.from({ length: n }, (_, i) => photo("arch", `p${i}`));
  return {
    slug, title, updated,
    photoCount: n, categoryCount: 1,
    cover: photos[0],
    sections: [
      { id: "favorites", label: "Favorites", photos: photos.slice(0, 1) },
      { id: "arch", label: "Architecture", photos },
    ],
  };
}

const two = [
  gallery("tokyo-kyoto-2025", "Tokyo & Kyoto 2025", "2025-11-02", 3),
  gallery("edinburgh-london-2026", "Edinburgh & London 2026", "2026-09-07", 54),
];

vi.mock("../lib/manifest.ts", () => ({
  manifest: {
    siteTitle: "Galleries",
    copyright: { holder: "Trey Hakanson", year: 2026, terms: "Personal viewing only." },
    galleries: two,
  },
  galleries: two,
  asset: (src: string) => `/photography/${src}`,
}));

const { IndexPage } = await import("../pages/IndexPage.tsx");

const show = () =>
  render(
    <MemoryRouter>
      <IndexPage />
    </MemoryRouter>,
  );

describe("index with several galleries", () => {
  it("renders one card per gallery", () => {
    show();
    expect(document.querySelectorAll(".GalleryCard")).toHaveLength(2);
  });

  it("keeps the manifest's order, rather than re-sorting", () => {
    // Ordering is decided once, during discovery, so the page must not
    // second-guess it.
    show();
    const titles = [...document.querySelectorAll(".GalleryCard-title")].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(two.map((g) => g.title));
  });

  it("links each card at its own slug", () => {
    show();
    for (const g of two) {
      expect(
        screen.getByRole("link", { name: new RegExp(g.title) }).getAttribute("href"),
      ).toBe(`/${g.slug}`);
    }
  });

  it("counts each gallery separately, and the site in total", () => {
    show();
    const metas = [...document.querySelectorAll(".GalleryCard-meta")].map(
      (el) => el.textContent ?? "",
    );
    expect(metas[0]).toContain("3 photos");
    expect(metas[1]).toContain("54 photos");
    expect(document.querySelector(".Masthead p")!.textContent).toContain("2 galleries");
    expect(document.querySelector(".Masthead p")!.textContent).toContain("57 photos");
  });
});
