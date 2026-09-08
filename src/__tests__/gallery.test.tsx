import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { GalleryPage } from "../pages/GalleryPage.tsx";
import { galleries, manifest } from "../lib/manifest.ts";
import { finishAnimations, installAnimate } from "./setup.ts";
import type { Photo } from "../types.ts";

const gallery = galleries[0];
const FAVORITES = "favorites";

function show(slug = gallery.slug) {
  return render(
    <MemoryRouter initialEntries={[`/${slug}`]}>
      <Routes>
        <Route path="/:slug" element={<GalleryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tileFor = (photo: Photo, sectionId: string) =>
  document.querySelector<HTMLElement>(
    `.Section--${sectionId} .Image[data-type="${photo.kind}"][data-name="${photo.name}"]`,
  )!;

const open = async (photo: Photo, sectionId: string) => {
  fireEvent.click(tileFor(photo, sectionId));
  await waitFor(() => expect(document.querySelector(".Lightbox")).toBeTruthy());
  return document.querySelector<HTMLElement>(".Lightbox")!;
};

describe("gallery structure", () => {
  beforeEach(() => show());

  it("renders one section per category, plus favorites", () => {
    expect(document.querySelectorAll(".Section")).toHaveLength(gallery.sections.length);
  });

  it("renders sections in the order config.json lists them", () => {
    const onPage = [...document.querySelectorAll(".Section-title")].map((el) =>
      el.id.replace("sec-", ""),
    );
    expect(onPage).toEqual(gallery.sections.map((s) => s.id));
  });

  it("leads with favorites", () => {
    expect(document.querySelector(".Section-title")!.id).toBe(`sec-${FAVORITES}`);
  });

  it("labels each section from config.json, not the folder name", () => {
    for (const section of gallery.sections) {
      const title = document.getElementById(`sec-${section.id}`)!;
      expect(title.textContent).toContain(section.label);
    }
  });

  it("shows a count per section that matches the tiles in it", () => {
    for (const section of gallery.sections) {
      const el = document.querySelector(`.Section--${section.id}`)!;
      expect(within(el as HTMLElement).getByText(String(section.photos.length))).toBeTruthy();
      expect(el.querySelectorAll(".Image")).toHaveLength(section.photos.length);
    }
  });

  it("counts distinct photos in the header, not tiles", () => {
    const tiles = document.querySelectorAll(".Image").length;
    const distinct = new Set(
      gallery.sections.flatMap((s) => s.photos.map((p) => p.id)),
    ).size;
    expect(screen.getByText(`${gallery.photoCount} photos in ${gallery.categoryCount} categories`))
      .toBeTruthy();
    // Favorites repeats photos, so there are more tiles than photos.
    expect(tiles).toBeGreaterThan(distinct);
    expect(gallery.photoCount).toBe(distinct);
  });

  it("gives every tile the span class its layout depends on", () => {
    for (const tile of document.querySelectorAll(".Image")) {
      expect(tile.className).toMatch(/\bs-\d+-\d+\b/);
    }
  });

  it("sizes every image up front so the grid does not reflow on load", () => {
    for (const img of document.querySelectorAll("img")) {
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("height")).toBeTruthy();
      expect(img.getAttribute("loading")).toBe("lazy");
    }
  });

  it("makes each section collapsible", () => {
    for (const body of document.querySelectorAll(".Section-body")) {
      expect(body.tagName).toBe("DETAILS");
      expect((body as HTMLDetailsElement).open).toBe(true);
    }
  });

  it("points the back link at the index", () => {
    expect(screen.getByRole("link", { name: /Galleries/ }).getAttribute("href")).toBe("/");
  });

  it("carries the copyright footer", () => {
    const footer = document.querySelector("footer.Footer")!;
    expect(footer.textContent).toContain(manifest.copyright.holder);
    expect(footer.textContent).toContain("All rights reserved");
    expect(footer.querySelector(".Footer-terms")!.textContent).toBe(manifest.copyright.terms);
  });
});

describe("lightbox", () => {
  const captioned = gallery.sections
    .find((s) => s.id !== FAVORITES)!
    .photos.find((p) => p.caption)!;

  beforeEach(() => show());

  it("starts closed and unlocked", () => {
    expect(document.querySelector(".Lightbox")).toBeNull();
    expect(document.body.classList.contains("is-locked")).toBe(false);
  });

  it("opens on a tile click and locks scroll", async () => {
    await open(captioned, captioned.kind);
    expect(document.body.classList.contains("is-locked")).toBe(true);
  });

  it("opens on Enter and on Space", async () => {
    for (const key of ["Enter", " "]) {
      fireEvent.keyDown(tileFor(captioned, captioned.kind), { key });
      await waitFor(() => expect(document.querySelector(".Lightbox")).toBeTruthy());
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(document.querySelector(".Lightbox")).toBeNull());
    }
  });

  it("shows the clicked photo, its title and its caption", async () => {
    const box = await open(captioned, captioned.kind);
    expect(box.querySelector(".Face--front img")!.getAttribute("src")).toContain(
      captioned.src.split("/").pop()!,
    );
    expect(box.querySelector(".Back-title")!.textContent).toBe(
      captioned.title || captioned.name,
    );
    expect(box.querySelector(".Back-text")!.textContent).toBe(captioned.caption);
    expect(box.querySelector(".Back-text")!.classList.contains("is-empty")).toBe(false);
  });

  it("names the photo's own category, not the section clicked in", async () => {
    // A favorites tile must still say "Architecture", not "Favorites".
    const favSection = gallery.sections.find((s) => s.id === FAVORITES);
    if (!favSection?.photos.length) return;
    const photo = favSection.photos[0];
    const box = await open(photo, FAVORITES);
    const label = gallery.sections.find((s) => s.id === photo.kind)!.label;
    expect(box.querySelector(".Back-kind")!.textContent).toBe(label);
    expect(box.querySelector(".Back-kind")!.textContent).not.toBe("Favorites");
  });

  it("flips to the back on a second click, and back again", async () => {
    const box = await open(captioned, captioned.kind);
    const card = box.querySelector(".Card")!;
    expect(card.classList.contains("is-flipped")).toBe(false);
    fireEvent.click(card);
    await waitFor(() => expect(card.classList.contains("is-flipped")).toBe(true));
    fireEvent.click(card);
    await waitFor(() => expect(card.classList.contains("is-flipped")).toBe(false));
  });

  it("does not flip when a caption link is clicked", async () => {
    const linked = gallery.sections
      .flatMap((s) => (s.id === FAVORITES ? [] : s.photos))
      .find((p) => /\[[^\]]+\]\(https?:/.test(p.caption));
    if (!linked) return;

    const box = await open(linked, linked.kind);
    const card = box.querySelector(".Card")!;
    fireEvent.click(card); // flip to the back so the link is readable
    await waitFor(() => expect(card.classList.contains("is-flipped")).toBe(true));

    const link = box.querySelector(".Back-text a")!;
    fireEvent.click(link, { bubbles: true });
    // Still on the back: the reader clicked a link, not the card.
    expect(card.classList.contains("is-flipped")).toBe(true);
  });

  it("shows a hint instead of an empty caption", async () => {
    const blank = gallery.sections
      .flatMap((s) => (s.id === FAVORITES ? [] : s.photos))
      .find((p) => !p.caption);
    if (!blank) return;
    const box = await open(blank, blank.kind);
    const text = box.querySelector(".Back-text")!;
    expect(text.textContent).toContain("No notes yet");
    expect(text.classList.contains("is-empty")).toBe(true);
  });

  it("closes on the X, unlocking scroll and resetting the flip", async () => {
    const box = await open(captioned, captioned.kind);
    fireEvent.click(box.querySelector(".Card")!);
    fireEvent.click(box.querySelector(".Lightbox-close")!);
    await waitFor(() => expect(document.querySelector(".Lightbox")).toBeNull());
    expect(document.body.classList.contains("is-locked")).toBe(false);
  });

  it("accepts the legacy Esc key value too", async () => {
    await open(captioned, captioned.kind);
    fireEvent.keyDown(document, { key: "Esc" });
    await waitFor(() => expect(document.querySelector(".Lightbox")).toBeNull());
  });

  it("closes on Escape and on a backdrop click", async () => {
    await open(captioned, captioned.kind);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".Lightbox")).toBeNull());

    const box = await open(captioned, captioned.kind);
    fireEvent.click(box.querySelector(".Lightbox-veil")!);
    await waitFor(() => expect(document.querySelector(".Lightbox")).toBeNull());
  });

  it("leaves no scroll lock behind after opening and closing", async () => {
    await open(captioned, captioned.kind);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.body.classList.contains("is-locked")).toBe(false));
  });
});

describe("lightbox flight", () => {
  const photo = gallery.sections.find((s) => s.id !== FAVORITES)!.photos[0];

  beforeEach(() => {
    installAnimate();
    show();
  });

  it("hides the tile while its photo is in flight, and restores it after", async () => {
    const tile = tileFor(photo, photo.kind);
    fireEvent.click(tile);
    await waitFor(() => expect(tile.style.visibility).toBe("hidden"));

    fireEvent.keyDown(document, { key: "Escape" });
    finishAnimations();
    await waitFor(() => expect(document.querySelector(".Lightbox")).toBeNull());
    expect(tile.style.visibility).toBe("");
  });

  it("clips the wrapper only while flying", async () => {
    fireEvent.click(tileFor(photo, photo.kind));
    await waitFor(() =>
      expect(document.querySelector(".CardWrap")!.classList.contains("is-flying")).toBe(true),
    );
  });

  it("reveals the overlay only once the photo can be painted", async () => {
    fireEvent.click(tileFor(photo, photo.kind));
    const box = document.querySelector<HTMLElement>(".Lightbox")!;
    // Laid out but not painted until decode() resolves.
    expect(box.style.visibility).toBe("hidden");
    await waitFor(() => expect(box.style.visibility).toBe(""));
  });
});
