import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "../pages/AdminPage.tsx";
import { galleries } from "../lib/manifest.ts";

const gallery = galleries[0];
const real = gallery.sections.filter((s) => s.id !== "favorites");
const photos = real.flatMap((s) => s.photos);

/** A config.json standing in for the file on disk, in the shape the app reads. */
function diskConfig() {
  const captions: Record<string, Record<string, unknown>> = {};
  for (const p of photos) {
    (captions[p.kind] ??= {})[p.name] =
      p.title || p.favorite
        ? {
            ...(p.title ? { title: p.title } : {}),
            ...(p.caption ? { caption: p.caption } : {}),
            ...(p.favorite ? { favorite: true } : {}),
          }
        : p.caption;
  }
  return {
    sections: gallery.sections.map((s) => ({ id: s.id, label: s.label })),
    captions,
  };
}

let disk: ReturnType<typeof diskConfig>;
let posts: Array<{ url: string; body: string }>;
let saveOk: boolean;

beforeEach(() => {
  disk = diskConfig();
  posts = [];
  saveOk = true;

  vi.stubGlobal("fetch", (url: string, opts?: RequestInit) => {
    if (opts?.method === "POST") {
      posts.push({ url, body: String(opts.body) });
      // A real server would have written the file; keep disk in step.
      if (saveOk) disk = JSON.parse(String(opts.body));
      return Promise.resolve({
        ok: saveOk,
        status: saveOk ? 200 : 400,
        json: () =>
          Promise.resolve(
            saveOk ? { ok: true, entries: photos.length } : { ok: false, error: "nope" },
          ),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(disk))),
    } as Response);
  });
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:stub", revokeObjectURL() {} });
});

afterEach(() => vi.unstubAllGlobals());

async function show() {
  const view = render(
    <MemoryRouter initialEntries={[`/admin/${gallery.slug}`]}>
      <Routes>
        <Route path="/admin/:slug" element={<AdminPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.querySelectorAll(".Row").length).toBe(photos.length));
  return view;
}

const row = (kind: string, name: string) =>
  document.querySelector<HTMLElement>(`.Row[data-type="${kind}"][data-name="${name}"]`)!;
const field = (r: HTMLElement, sel: string) => r.querySelector<HTMLInputElement>(sel)!;
const save = () => screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement;

describe("admin structure", () => {
  it("renders a row per photo, favorites excluded", async () => {
    await show();
    expect(document.querySelectorAll(".Row")).toHaveLength(photos.length);
    expect(document.querySelectorAll(".Group")).toHaveLength(real.length);
  });

  it("groups in config section order", async () => {
    await show();
    const onPage = [...document.querySelectorAll(".Group-name")].map((el) => el.textContent);
    expect(onPage).toEqual(real.map((s) => s.label));
  });

  it("gives every row a thumbnail and all three fields", async () => {
    await show();
    for (const r of document.querySelectorAll<HTMLElement>(".Row")) {
      expect(r.querySelector(".Row-thumb")).toBeTruthy();
      expect(r.querySelector(".f-title")).toBeTruthy();
      expect(r.querySelector(".f-caption")).toBeTruthy();
      expect(r.querySelector(".f-fav")).toBeTruthy();
    }
  });

  it("starts clean, with Save disabled", async () => {
    await show();
    expect(save().disabled).toBe(true);
    expect(document.querySelectorAll(".Row.is-changed")).toHaveLength(0);
  });

  it("loads what is on disk, not the build-time copy", async () => {
    const edited = photos[0];
    disk.captions[edited.kind][edited.name] = { title: "Edited on disk" };
    await show();
    await waitFor(() =>
      expect(field(row(edited.kind, edited.name), ".f-title").value).toBe("Edited on disk"),
    );
    // Hydrating is not an edit.
    expect(save().disabled).toBe(true);
  });
});

describe("editing and saving", () => {
  const target = photos[0];

  it("marks a changed row and enables Save", async () => {
    await show();
    fireEvent.change(field(row(target.kind, target.name), ".f-title"), {
      target: { value: "A new title" },
    });
    await waitFor(() => expect(save().disabled).toBe(false));
    expect(row(target.kind, target.name).classList.contains("is-changed")).toBe(true);
    expect(save().textContent).toContain("(1)");
  });

  it("writes the three serialized forms", async () => {
    await show();
    const r = row(target.kind, target.name);
    fireEvent.change(field(r, ".f-title"), { target: { value: "" } });
    fireEvent.change(field(r, ".f-caption"), { target: { value: "Just a caption." } });
    if (field(r, ".f-fav").checked) fireEvent.click(field(r, ".f-fav"));

    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(posts).toHaveLength(1));

    const sent = JSON.parse(posts[0].body);
    // Caption only -> a bare string.
    expect(sent.captions[target.kind][target.name]).toBe("Just a caption.");
  });

  it("carries the section order through a save untouched", async () => {
    await show();
    fireEvent.change(field(row(target.kind, target.name), ".f-title"), {
      target: { value: "Anything" },
    });
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(posts).toHaveLength(1));

    const sent = JSON.parse(posts[0].body);
    // The form only owns captions; everything else rides along unchanged.
    expect(sent.sections).toEqual(disk.sections);
    expect(sent.captions[target.kind][target.name].title).toBe("Anything");
  });

  it("posts to the gallery's own endpoint and ends with a newline", async () => {
    await show();
    fireEvent.change(field(row(target.kind, target.name), ".f-title"), {
      target: { value: "x" },
    });
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toContain(`api/config/${gallery.slug}`);
    expect(posts[0].body.endsWith("\n")).toBe(true);
  });

  it("rebases after a save, so nothing stays marked unsaved", async () => {
    await show();
    fireEvent.change(field(row(target.kind, target.name), ".f-title"), {
      target: { value: "Saved title" },
    });
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved/)).toBeTruthy());
    await waitFor(() => expect(save().disabled).toBe(true));
    expect(document.querySelectorAll(".Row.is-changed")).toHaveLength(0);
  });

  it("will not post when there is nothing to save", async () => {
    await show();
    fireEvent.click(save());
    await new Promise((r) => setTimeout(r, 10));
    expect(posts).toHaveLength(0);
  });

  it("blocks the first save when the file changed underneath, then obeys", async () => {
    await show();
    fireEvent.change(field(row(target.kind, target.name), ".f-title"), {
      target: { value: "Mine" },
    });
    await waitFor(() => expect(save().disabled).toBe(false));

    // Someone edits config.json in an editor meanwhile.
    const other = photos[1];
    disk.captions[other.kind][other.name] = { title: "Theirs" };

    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/changed on disk/)).toBeTruthy());
    expect(posts).toHaveLength(0);

    fireEvent.click(save());
    await waitFor(() => expect(posts).toHaveLength(1));
  });

  it("falls back to a download when the write is refused", async () => {
    await show();
    saveOk = false;
    fireEvent.change(field(row(target.kind, target.name), ".f-title"), {
      target: { value: "Doomed" },
    });
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/downloaded instead/)).toBeTruthy());
    // The edit is still pending, so nothing is lost.
    expect(save().disabled).toBe(false);
  });

  it("counts favorites live as they are toggled", async () => {
    await show();
    const before = Number(document.querySelector(".Status b:nth-of-type(2)")!.textContent);
    const box = field(row(target.kind, target.name), ".f-fav");
    fireEvent.click(box);
    await waitFor(() => {
      const after = Number(document.querySelector(".Status b:nth-of-type(2)")!.textContent);
      expect(after).toBe(box.checked ? before + 1 : before - 1);
    });
  });
});
