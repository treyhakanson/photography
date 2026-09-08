/**
 * Every stylesheet is loaded on every route, so a class name shared between two
 * pages means one page silently restyles the other. (The generator this site
 * grew out of emitted a separate document per page, where that was safe.)
 *
 * `.Gallery` did exactly that once: the index page's card rule (background,
 * border, overflow) landed on the gallery page's <main>. This pins the
 * invariant so it cannot come back.
 */
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { GalleryPage } from "../pages/GalleryPage.tsx";
import { IndexPage } from "../pages/IndexPage.tsx";
import { galleries } from "../lib/manifest.ts";

/** Classes defined in base.css and deliberately used by every page. */
const SHARED = new Set(["Footer", "Footer-terms", "Backlink"]);

function classesIn(container: HTMLElement): Set<string> {
  const out = new Set<string>();
  for (const el of container.querySelectorAll<HTMLElement>("*")) {
    for (const name of el.classList) out.add(name);
  }
  return out;
}

/**
 * `pattern` is the route pattern and `entry` the URL visited. They differ for
 * any page reading a param: rendering GalleryPage at a literal path leaves
 * useParams().slug undefined and quietly falls through to NotFound.
 */
function classesOf(
  ui: React.ReactElement,
  pattern: string,
  entry: string = pattern,
): Set<string> {
  const { container, unmount } = render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={pattern} element={ui} />
      </Routes>
    </MemoryRouter>,
  );
  const found = classesIn(container);
  unmount();
  return found;
}

describe("stylesheets do not collide across routes", () => {
  it("shares no class between the index and a gallery beyond the base ones", () => {
    const index = classesOf(<IndexPage />, "/");
    const gallery = classesOf(<GalleryPage />, "/:slug", `/${galleries[0].slug}`);

    const overlap = [...index].filter((c) => gallery.has(c) && !SHARED.has(c));
    expect(overlap).toEqual([]);
  });

  it("keeps the index card and the gallery's main region distinctly named", () => {
    // The specific regression: both were called "Gallery".
    const index = classesOf(<IndexPage />, "/");
    const gallery = classesOf(<GalleryPage />, "/:slug", `/${galleries[0].slug}`);
    expect(index.has("GalleryCard")).toBe(true);
    expect(index.has("Gallery")).toBe(false);
    expect(gallery.has("Gallery")).toBe(true);
    expect(gallery.has("GalleryCard")).toBe(false);
  });

  it("still actually uses the base components it shares", () => {
    // Guards the test above from passing vacuously if the footer disappeared.
    const gallery = classesOf(<GalleryPage />, "/:slug", `/${galleries[0].slug}`);
    expect(gallery.has("Footer")).toBe(true);
  });
});
