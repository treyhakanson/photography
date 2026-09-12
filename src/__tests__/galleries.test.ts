/**
 * Gallery discovery: every *.json in the config directory is one gallery, and
 * the filename is its slug. Exercised against real directories in a temp dir,
 * because the whole point is filesystem behaviour.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadGalleries,
  orphanedCaptions,
  pickCover,
} from "../../scripts/galleries.ts";
import type { SiteConfig } from "../types.ts";

let root: string;
const site = { configDir: "./config" } as SiteConfig;

/** Write a gallery config file; `body` may be an object or raw text. */
function put(name: string, body: unknown) {
  writeFileSync(
    join(root, "config", name),
    typeof body === "string" ? body : JSON.stringify(body),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "galleries-"));
  mkdirSync(join(root, "config"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("discovery", () => {
  it("treats each json file as a gallery, slugged by filename", () => {
    put("tokyo-kyoto-2025.json", { title: "Tokyo & Kyoto 2025" });
    put("edinburgh-london-2026.json", { title: "Edinburgh & London 2026" });

    const found = loadGalleries(root, site);
    expect(found.map((g) => g.slug).sort()).toEqual([
      "edinburgh-london-2026",
      "tokyo-kyoto-2025",
    ]);
  });

  it("picks up a gallery added later with no other change", () => {
    put("one.json", { title: "One" });
    expect(loadGalleries(root, site)).toHaveLength(1);
    put("two.json", { title: "Two" });
    expect(loadGalleries(root, site)).toHaveLength(2);
  });

  it("defaults the photo folders to the slug", () => {
    put("kyoto.json", {});
    const [g] = loadGalleries(root, site);
    expect(g.media).toBe("./media/kyoto");
    expect(g.raw).toBe("./raw_media/kyoto");
  });

  it("lets a config override the photo folders", () => {
    put("edinburgh-london-2026.json", {
      media: "./media/uk-2026",
      raw: "./raw_media/uk-2026",
    });
    const [g] = loadGalleries(root, site);
    expect(g.media).toBe("./media/uk-2026");
    expect(g.raw).toBe("./raw_media/uk-2026");
  });

  it("falls back to the slug when no title is given", () => {
    put("kyoto.json", {});
    expect(loadGalleries(root, site)[0].title).toBe("kyoto");
  });

  it("points at the file it came from", () => {
    put("kyoto.json", {});
    expect(loadGalleries(root, site)[0].configPath).toBe(
      join(root, "config", "kyoto.json"),
    );
  });

  it("ignores dotfiles and anything that is not json", () => {
    put("real.json", {});
    put(".hidden.json", {});
    writeFileSync(join(root, "config", "notes.md"), "# nope");
    writeFileSync(join(root, "config", "config.json.bak"), "{}");
    expect(loadGalleries(root, site).map((g) => g.slug)).toEqual(["real"]);
  });
});

describe("ordering", () => {
  it("puts the newest date first", () => {
    put("old.json", { date: "2023-04" });
    put("new.json", { date: "2026-08" });
    put("mid.json", { date: "2025-11" });
    expect(loadGalleries(root, site).map((g) => g.slug)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("sorts undated galleries last, by slug", () => {
    put("b-undated.json", {});
    put("a-undated.json", {});
    put("dated.json", { date: "2020-01" });
    expect(loadGalleries(root, site).map((g) => g.slug)).toEqual([
      "dated",
      "a-undated",
      "b-undated",
    ]);
  });

  it("breaks date ties by slug, so the order never depends on the filesystem", () => {
    put("zebra.json", { date: "2025-11" });
    put("apple.json", { date: "2025-11" });
    expect(loadGalleries(root, site).map((g) => g.slug)).toEqual([
      "apple",
      "zebra",
    ]);
  });
});

describe("bad input", () => {
  it("names the offending file when the JSON is broken", () => {
    put("broken.json", "{ not json");
    expect(() => loadGalleries(root, site)).toThrow(/broken\.json/);
  });

  it("rejects a config that is not an object", () => {
    put("array.json", "[]");
    expect(() => loadGalleries(root, site)).toThrow(/array\.json/);
  });

  it("complains when the directory is missing", () => {
    rmSync(join(root, "config"), { recursive: true });
    expect(() => loadGalleries(root, site)).toThrow(/config directory/);
  });

  it("complains when the directory holds no galleries", () => {
    expect(() => loadGalleries(root, site)).toThrow(/no gallery config files/);
  });
});

describe("cover selection", () => {
  const photo = (id: string, favorite = false) => ({ id, favorite });
  const photos = [
    photo("arch/bank"),
    photo("nature/lily", true),
    photo("temple/daibutsu", true),
  ];

  it("uses the named photo when the config specifies one", () => {
    const { photo: chosen, missing } = pickCover(photos, "temple/daibutsu");
    expect(chosen?.id).toBe("temple/daibutsu");
    expect(missing).toBe(false);
  });

  it("lets an explicit cover beat a favorite that comes earlier", () => {
    // nature/lily is favorited and earlier in the list, so this only passes if
    // the explicit choice really wins.
    expect(pickCover(photos, "arch/bank").photo?.id).toBe("arch/bank");
  });

  it("falls back to the first favorite when no cover is set", () => {
    const { photo: chosen, missing } = pickCover(photos, "");
    expect(chosen?.id).toBe("nature/lily");
    expect(missing).toBe(false);
  });

  it("falls back to the first photo when nothing is favorited", () => {
    const plain = [photo("arch/bank"), photo("arch/nook")];
    expect(pickCover(plain, "").photo?.id).toBe("arch/bank");
  });

  it("reports a cover that matches nothing, and still returns a usable photo", () => {
    const { photo: chosen, missing } = pickCover(photos, "temple/typo");
    expect(missing).toBe(true);
    expect(chosen?.id).toBe("nature/lily");
  });

  it("copes with a gallery that has no photos at all", () => {
    expect(pickCover([], "").photo).toBeUndefined();
    expect(pickCover([], "some/thing").photo).toBeUndefined();
  });

  it("reads cover out of the config file, defaulting to blank", () => {
    put("with.json", { cover: "temple/daibutsu" });
    put("without.json", {});
    const found = Object.fromEntries(
      loadGalleries(root, site).map((g) => [g.slug, g.cover]),
    );
    expect(found.with).toBe("temple/daibutsu");
    expect(found.without).toBe("");
  });
});

describe("orphaned captions", () => {
  const present = new Set(["temple/Rain-Temple", "elem/Flute-Pimp"]);

  it("drops an empty entry whose photo is gone", () => {
    const { drop, keep } = orphanedCaptions(present, {
      temple: { "Rain-Temple": "", "Rain-Template": "" },
    });
    expect(drop).toEqual([["temple", "Rain-Template"]]);
    expect(keep).toEqual([]);
  });

  it("keeps a written caption whose photo is gone, and says so", () => {
    // A rename is indistinguishable from a delete here, so anything the author
    // typed has to survive.
    const { drop, keep } = orphanedCaptions(present, {
      temple: { "Rain-Template": "The rain temple, at dusk." },
    });
    expect(drop).toEqual([]);
    expect(keep).toEqual(["temple/Rain-Template"]);
  });

  it("keeps an orphan that only carries a title or a favorite flag", () => {
    const { drop, keep } = orphanedCaptions(present, {
      temple: { Titled: { title: "Something" }, Starred: { favorite: true } },
    });
    expect(drop).toEqual([]);
    expect(keep.sort()).toEqual(["temple/Starred", "temple/Titled"]);
  });

  it("treats a whitespace-only caption as empty", () => {
    const { drop } = orphanedCaptions(present, { temple: { Blank: "   " } });
    expect(drop).toEqual([["temple", "Blank"]]);
  });

  it("treats an object with only blank fields as empty", () => {
    const { drop } = orphanedCaptions(present, {
      temple: { Blank: { title: "", caption: "", favorite: false } },
    });
    expect(drop).toEqual([["temple", "Blank"]]);
  });

  it("never touches an entry whose photo is still there", () => {
    const { drop, keep } = orphanedCaptions(present, {
      temple: { "Rain-Temple": "" },
      elem: { "Flute-Pimp": "" },
    });
    expect(drop).toEqual([]);
    expect(keep).toEqual([]);
  });

  it("reports orphans across every category", () => {
    const { drop } = orphanedCaptions(present, {
      temple: { Gone: "" },
      colors: { AlsoGone: "" },
    });
    expect(drop.sort()).toEqual([
      ["colors", "AlsoGone"],
      ["temple", "Gone"],
    ]);
  });
});
